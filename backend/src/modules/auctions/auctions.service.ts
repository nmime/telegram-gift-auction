import { Injectable, BadRequestException, NotFoundException, ConflictException, Logger, Inject } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types, ClientSession } from 'mongoose';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import Redlock, { Lock } from 'redlock';
import { Auction, AuctionDocument, AuctionStatus, Bid, BidDocument, BidStatus, User, UserDocument } from '@/schemas';
import { UsersService } from '@/modules/users';
import { EventsGateway } from '@/modules/events';
import { NotificationsService } from '@/modules/notifications';
import { REDLOCK, REDIS_CLIENT } from '@/modules/redis';
import { ICreateAuction, IPlaceBid } from './dto';
import { isTransientTransactionError, isDuplicateKeyError, isPopulatedUser, LeaderboardEntry, PastWinnerEntry, LeaderboardResponse, LOCALHOST_IPS } from '@/common';

const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 50;

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectConnection() private connection: Connection,
    private usersService: UsersService,
    private eventsGateway: EventsGateway,
    private notificationsService: NotificationsService,
    @Inject(REDLOCK) private readonly redlock: Redlock,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async withTransaction<T>(
    operation: (session: ClientSession) => Promise<T>,
    retries = MAX_RETRIES,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const session = await this.connection.startSession();

      try {
        session.startTransaction({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        });

        const result = await operation(session);
        await session.commitTransaction();
        return result;
      } catch (error) {
        await session.abortTransaction();
        lastError = error instanceof Error ? error : new Error(String(error));

        if (isTransientTransactionError(error) && attempt < retries) {
          this.logger.warn('Transaction conflict, retrying', { attempt, retries });
          const jitter = randomInt(RETRY_DELAY_MS);
          await this.delay(RETRY_DELAY_MS * attempt + jitter);
          continue;
        }

        throw error;
      } finally {
        await session.endSession();
      }
    }

    throw lastError;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async create(dto: ICreateAuction, userId: string): Promise<AuctionDocument> {
    const totalRoundItems = dto.rounds.reduce((sum: number, r: ICreateAuction['rounds'][0]) => sum + r.itemsCount, 0);
    if (totalRoundItems !== dto.totalItems) {
      throw new BadRequestException('Sum of items in rounds must equal totalItems');
    }

    if (dto.totalItems <= 0) {
      throw new BadRequestException('Total items must be positive');
    }

    if (dto.rounds.some((r: ICreateAuction['rounds'][0]) => r.itemsCount <= 0 || r.durationMinutes <= 0)) {
      throw new BadRequestException('Round items and duration must be positive');
    }

    return this.auctionModel.create({
      title: dto.title,
      description: dto.description,
      totalItems: dto.totalItems,
      roundsConfig: dto.rounds,
      minBidAmount: dto.minBidAmount || 100,
      minBidIncrement: dto.minBidIncrement || 10,
      antiSnipingWindowMinutes: dto.antiSnipingWindowMinutes || 5,
      antiSnipingExtensionMinutes: dto.antiSnipingExtensionMinutes || 5,
      maxExtensions: dto.maxExtensions || 6,
      botsEnabled: dto.botsEnabled ?? true,
      botCount: dto.botCount || 5,
      createdBy: new Types.ObjectId(userId),
      status: AuctionStatus.PENDING,
    });
  }

  async findAll(status?: AuctionStatus): Promise<AuctionDocument[]> {
    const query = status ? { status } : {};
    return this.auctionModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<AuctionDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid auction ID');
    }
    const auction = await this.auctionModel.findById(id);
    if (!auction) {
      throw new NotFoundException('Auction not found');
    }
    return auction;
  }

  async start(id: string): Promise<AuctionDocument> {
    return this.withTransaction(async (session) => {
      const auction = await this.auctionModel.findOneAndUpdate(
        { _id: new Types.ObjectId(id), status: AuctionStatus.PENDING },
        { $inc: { version: 1 } },
        { new: false, session }
      );

      if (!auction) {
        const exists = await this.auctionModel.findById(id).session(session);
        if (!exists) {
          throw new NotFoundException('Auction not found');
        }
        throw new BadRequestException('Auction can only be started from pending status');
      }

      const now = new Date();
      const firstRoundConfig = auction.roundsConfig[0];
      const roundEndTime = new Date(now.getTime() + firstRoundConfig.durationMinutes * 60 * 1000);

      const updatedAuction = await this.auctionModel.findByIdAndUpdate(
        id,
        {
          status: AuctionStatus.ACTIVE,
          startTime: now,
          currentRound: 1,
          rounds: [{
            roundNumber: 1,
            itemsCount: firstRoundConfig.itemsCount,
            startTime: now,
            endTime: roundEndTime,
            extensionsCount: 0,
            completed: false,
            winnerBidIds: [],
          }],
        },
        { new: true, session }
      );

      if (!updatedAuction) {
        throw new ConflictException('Failed to start auction - concurrent modification');
      }

      this.eventsGateway.emitAuctionUpdate(updatedAuction);
      return updatedAuction;
    });
  }

  async placeBid(
    auctionId: string,
    userId: string,
    dto: IPlaceBid,
    clientIp?: string,
  ): Promise<{ bid: BidDocument; auction: AuctionDocument }> {
    if (!Types.ObjectId.isValid(auctionId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid ID format');
    }

    if (dto.amount <= 0 || !Number.isInteger(dto.amount)) {
      throw new BadRequestException('Bid amount must be a positive integer');
    }

    const isLocalhost = clientIp && LOCALHOST_IPS.includes(clientIp);
    const lockKey = `bid-lock:${userId}:${auctionId}`;
    const cooldownKey = `bid-cooldown:${userId}:${auctionId}`;
    let lock: Lock | null = null;

    // Skip lock for localhost (testing)
    if (!isLocalhost) {
      try {
        lock = await this.redlock.acquire([lockKey], 10000);
      } catch (error) {
        this.logger.debug('Failed to acquire lock', { lockKey, error });
        throw new ConflictException('Another bid request is being processed. Please wait and try again.');
      }
    }

    try {
      // Skip cooldown check for localhost
      if (!isLocalhost) {
        const cooldownExists = await this.redis.exists(cooldownKey);
        if (cooldownExists) {
          throw new ConflictException('Please wait before placing another bid.');
        }
      }

      const result = await this.withTransaction(async (session) => {
        const auction = await this.auctionModel.findOneAndUpdate(
          { _id: new Types.ObjectId(auctionId), status: AuctionStatus.ACTIVE },
          { $inc: { version: 1 } },
          { new: true, session }
        );

        if (!auction) {
          const exists = await this.auctionModel.findById(auctionId).session(session);
          if (!exists) {
            throw new NotFoundException('Auction not found');
          }
          throw new BadRequestException('Auction is not active');
        }

        const currentRound = auction.rounds[auction.currentRound - 1];
        if (!currentRound || currentRound.completed) {
          throw new BadRequestException('No active round');
        }

        const now = new Date();
        const BOUNDARY_BUFFER_MS = 100;
        if (now.getTime() > currentRound.endTime!.getTime() - BOUNDARY_BUFFER_MS) {
          throw new BadRequestException('Round has ended or is about to end');
        }

        if (dto.amount < auction.minBidAmount) {
          throw new BadRequestException(`Minimum bid is ${auction.minBidAmount}`);
        }

        const user = await this.userModel.findById(userId).session(session);
        if (!user) {
          throw new NotFoundException('User not found');
        }

        // Capture winning users BEFORE any bid changes
        const itemsInRound = currentRound.itemsCount;
        const winningBidsBefore = await this.bidModel
          .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
          .sort({ amount: -1, createdAt: 1 })
          .limit(itemsInRound)
          .session(session);
        const winningUserIdsBefore = new Set(winningBidsBefore.map(b => b.userId.toString()));

        let lockedBid: BidDocument | null = null;
        let isNewBid = false;
        let originalVersion: number;

        const existingBid = await this.bidModel.findOne({
          auctionId: auction._id,
          userId: new Types.ObjectId(userId),
          status: BidStatus.ACTIVE,
        }).session(session);

        if (existingBid) {
          lockedBid = existingBid;
          originalVersion = existingBid.__v ?? 0;
        } else {
          try {
            const [newBid] = await this.bidModel.create([{
              auctionId: auction._id,
              userId: new Types.ObjectId(userId),
              amount: dto.amount,
              status: BidStatus.ACTIVE,
              lastProcessedAt: now,
            }], { session });
            lockedBid = newBid;
            originalVersion = 0;
            isNewBid = true;
          } catch (error) {
            if (isDuplicateKeyError(error)) {
              throw new ConflictException('Another bid request is being processed. Please wait and try again.');
            }
            throw error;
          }
        }

        let bid: BidDocument;
        let amountToFreeze: number;
        let previousBidAmount = 0;

        if (isNewBid) {
          amountToFreeze = dto.amount;

          if (user.balance < amountToFreeze) {
            await this.bidModel.deleteOne({ _id: lockedBid!._id }).session(session);
            throw new BadRequestException(`Insufficient balance. Need ${amountToFreeze}, have ${user.balance}`);
          }

          const existingAmountBid = await this.bidModel.findOne({
            auctionId: auction._id,
            amount: dto.amount,
            status: BidStatus.ACTIVE,
            _id: { $ne: lockedBid!._id },
          }).session(session);

          if (existingAmountBid) {
            await this.bidModel.deleteOne({ _id: lockedBid!._id }).session(session);
            throw new ConflictException(`Bid amount ${dto.amount} is already taken. Try a different amount.`);
          }

          const frozenResult = await this.userModel.findOneAndUpdate(
            { _id: new Types.ObjectId(userId), balance: { $gte: amountToFreeze }, version: user.version },
            { $inc: { balance: -amountToFreeze, frozenBalance: amountToFreeze, version: 1 } },
            { new: true, session }
          );

          if (!frozenResult) {
            await this.bidModel.deleteOne({ _id: lockedBid!._id }).session(session);
            throw new ConflictException('Failed to freeze balance - concurrent modification or insufficient funds');
          }

          await this.usersService.recordTransaction(
            userId, 'bid_freeze', amountToFreeze,
            user.balance, frozenResult.balance,
            user.frozenBalance, frozenResult.frozenBalance,
            auction._id, lockedBid!._id, session,
          );

          bid = lockedBid!;
        } else {
          previousBidAmount = lockedBid!.amount;

          if (dto.amount <= lockedBid!.amount) {
            throw new BadRequestException(`New bid must be higher than current bid (${lockedBid!.amount})`);
          }

          const increment = dto.amount - lockedBid!.amount;

          if (increment < auction.minBidIncrement) {
            throw new BadRequestException(`Minimum bid increment is ${auction.minBidIncrement}`);
          }

          const conflictingBid = await this.bidModel.findOne({
            auctionId: auction._id,
            amount: dto.amount,
            status: BidStatus.ACTIVE,
            _id: { $ne: lockedBid!._id },
          }).session(session);

          if (conflictingBid) {
            throw new ConflictException(`Bid amount ${dto.amount} is already taken. Try a different amount.`);
          }

          amountToFreeze = increment;

          if (user.balance < amountToFreeze) {
            throw new BadRequestException(`Insufficient balance. Need ${amountToFreeze}, have ${user.balance}`);
          }

          const frozenResult = await this.userModel.findOneAndUpdate(
            { _id: new Types.ObjectId(userId), balance: { $gte: amountToFreeze }, version: user.version },
            { $inc: { balance: -amountToFreeze, frozenBalance: amountToFreeze, version: 1 } },
            { new: true, session }
          );

          if (!frozenResult) {
            throw new ConflictException('Failed to freeze balance - concurrent modification or insufficient funds');
          }

          await this.usersService.recordTransaction(
            userId, 'bid_freeze', amountToFreeze,
            user.balance, frozenResult.balance,
            user.frozenBalance, frozenResult.frozenBalance,
            auction._id, lockedBid!._id, session,
          );

          let updatedBid: BidDocument | null;
          try {
            updatedBid = await this.bidModel.findOneAndUpdate(
              { _id: lockedBid!._id, __v: originalVersion, amount: previousBidAmount },
              { amount: dto.amount, lastProcessedAt: now, outbidNotifiedAt: null, $inc: { __v: 1 } },
              { new: true, session }
            );
          } catch (error) {
            if (isDuplicateKeyError(error)) {
              throw new ConflictException(`Bid amount ${dto.amount} is already taken. Try a different amount.`);
            }
            throw error;
          }

          if (!updatedBid) {
            throw new ConflictException('Bid was modified by another request. Please try again.');
          }

          bid = updatedBid;
        }

        const timeUntilEnd = currentRound.endTime!.getTime() - now.getTime();
        const antiSnipingWindow = auction.antiSnipingWindowMinutes * 60 * 1000;

        let auctionUpdated: AuctionDocument = auction;
        let antiSnipingTriggered = false;
        let antiSnipingNewEndTime: Date | null = null;

        if (timeUntilEnd <= antiSnipingWindow && currentRound.extensionsCount < auction.maxExtensions) {
          const extension = auction.antiSnipingExtensionMinutes * 60 * 1000;
          const newEndTime = new Date(currentRound.endTime!.getTime() + extension);

          const updated = await this.auctionModel.findByIdAndUpdate(
            auctionId,
            {
              $set: { [`rounds.${auction.currentRound - 1}.endTime`]: newEndTime },
              $inc: { [`rounds.${auction.currentRound - 1}.extensionsCount`]: 1 },
            },
            { new: true, session }
          );

          if (updated) {
            auctionUpdated = updated;
            antiSnipingTriggered = true;
            antiSnipingNewEndTime = newEndTime;
          }

          this.eventsGateway.emitAntiSnipingExtension(auctionUpdated, currentRound.extensionsCount + 1);
        }

        this.eventsGateway.emitNewBid(auction._id.toString(), {
          amount: bid.amount,
          timestamp: bid.updatedAt || bid.createdAt,
          isIncrease: !isNewBid,
        });

        // Check if this bid pushed someone out of winning position
        const allActiveBids = await this.bidModel
          .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
          .sort({ amount: -1, createdAt: 1 })
          .session(session);

        // Find users who were winning before but not after
        const winningUserIdsAfter = new Set(
          allActiveBids.slice(0, itemsInRound).map(b => b.userId.toString())
        );

        const outbidUsers: Array<{ bidId: string; userId: string; bidAmount: number }> = [];

        // Only notify users who were in winning position before but not now
        for (const pushedOutUserId of winningUserIdsBefore) {
          if (!winningUserIdsAfter.has(pushedOutUserId) && pushedOutUserId !== userId) {
            const pushedOutBid = allActiveBids.find(b => b.userId.toString() === pushedOutUserId);
            if (pushedOutBid) {
              const pushedOutUser = await this.userModel.findById(pushedOutUserId).session(session);
              if (pushedOutUser && !pushedOutUser.isBot && pushedOutUser.telegramId) {
                outbidUsers.push({
                  bidId: pushedOutBid._id.toString(),
                  userId: pushedOutUserId,
                  bidAmount: pushedOutBid.amount,
                });
              }
            }
          }
        }

        // Collect all bidders for anti-sniping notification (except current user and bots)
        const antiSnipingNotifyUsers: string[] = [];
        if (antiSnipingTriggered) {
          for (const activeBid of allActiveBids) {
            if (activeBid.userId.toString() !== userId) {
              const bidUser = await this.userModel.findById(activeBid.userId).session(session);
              if (bidUser && !bidUser.isBot && bidUser.telegramId) {
                antiSnipingNotifyUsers.push(activeBid.userId.toString());
              }
            }
          }
        }

        return {
          bid,
          auction: auctionUpdated,
          outbidUsers,
          minBidToWin: allActiveBids.length >= itemsInRound
            ? allActiveBids[itemsInRound - 1].amount + auction.minBidIncrement
            : auction.minBidAmount,
          antiSnipingTriggered,
          antiSnipingNewEndTime,
          antiSnipingNotifyUsers: [...new Set(antiSnipingNotifyUsers)], // dedupe
        };
      });

      // Send outbid notifications asynchronously (don't await)
      // Use atomic update to prevent duplicate notifications from concurrent transactions
      if (result.outbidUsers && result.outbidUsers.length > 0) {
        const notifyPromises = result.outbidUsers.map(async ({ bidId, userId: outbidUserId, bidAmount }) => {
          try {
            // Atomically mark the bid as notified - only succeeds if not already notified
            const updated = await this.bidModel.findOneAndUpdate(
              { _id: bidId, outbidNotifiedAt: null },
              { outbidNotifiedAt: new Date() },
              { new: true }
            );
            // Only send notification if we successfully marked it (prevents duplicates)
            if (updated) {
              await this.notificationsService.notifyOutbid(outbidUserId, {
                auctionId: result.auction._id.toString(),
                auctionTitle: result.auction.title,
                yourBid: bidAmount,
                newLeaderBid: result.bid.amount,
                roundNumber: result.auction.currentRound,
                minBidToWin: result.minBidToWin,
              });
            }
          } catch (err) {
            this.logger.warn('Failed to send outbid notification', err);
          }
        });
        Promise.all(notifyPromises);
      }

      // Send anti-sniping notifications asynchronously
      if (result.antiSnipingTriggered && result.antiSnipingNotifyUsers.length > 0) {
        const antiSnipingPromises = result.antiSnipingNotifyUsers.map(notifyUserId =>
          this.notificationsService.notifyAntiSniping(notifyUserId, {
            auctionId: result.auction._id.toString(),
            auctionTitle: result.auction.title,
            roundNumber: result.auction.currentRound,
            newEndTime: result.antiSnipingNewEndTime!,
            extensionMinutes: result.auction.antiSnipingExtensionMinutes,
          }).catch(err => this.logger.warn('Failed to send anti-sniping notification', err))
        );
        Promise.all(antiSnipingPromises);
      }

      // Set cooldown only for non-localhost
      if (!isLocalhost) {
        await this.redis.set(cooldownKey, '1', 'PX', 1000);
      }
      return { bid: result.bid, auction: result.auction };
    } finally {
      if (lock) {
        await lock.release();
      }
    }
  }

  async completeRound(auctionId: string): Promise<AuctionDocument | null> {
    const result = await this.withTransaction(async (session) => {
      const auction = await this.auctionModel.findOneAndUpdate(
        { _id: new Types.ObjectId(auctionId), status: AuctionStatus.ACTIVE },
        { $inc: { version: 1 } },
        { new: true, session }
      );

      if (!auction) {
        return null;
      }

      const currentRound = auction.rounds[auction.currentRound - 1];
      if (!currentRound || currentRound.completed) {
        return null;
      }

      const now = new Date();
      if (now < currentRound.endTime!) {
        return null;
      }

      const activeBids = await this.bidModel
        .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
        .sort({ amount: -1, createdAt: 1 })
        .session(session);

      const winnersCount = Math.min(currentRound.itemsCount, activeBids.length);
      const winningBids = activeBids.slice(0, winnersCount);
      const losingBids = activeBids.slice(winnersCount);

      const previousWinnersCount = auction.rounds
        .slice(0, auction.currentRound - 1)
        .reduce((sum, r) => sum + r.winnerBidIds.length, 0);

      const winnerBidIds: Types.ObjectId[] = [];

      for (let i = 0; i < winningBids.length; i++) {
        const bid = winningBids[i];
        const itemNumber = previousWinnersCount + i + 1;

        const updatedBid = await this.bidModel.findOneAndUpdate(
          { _id: bid._id, status: BidStatus.ACTIVE, __v: bid.__v },
          { status: BidStatus.WON, wonRound: auction.currentRound, itemNumber, $inc: { __v: 1 } },
          { new: true, session }
        );

        if (!updatedBid) {
          this.logger.error('Failed to update winning bid', bid._id);
          throw new ConflictException('Bid state changed during round completion');
        }

        const user = await this.userModel.findById(bid.userId).session(session);
        if (!user) {
          throw new Error(`User not found for bid ${bid._id}`);
        }

        const updatedUser = await this.userModel.findOneAndUpdate(
          { _id: bid.userId, frozenBalance: { $gte: bid.amount } },
          { $inc: { frozenBalance: -bid.amount, version: 1 } },
          { new: true, session }
        );

        if (!updatedUser) {
          throw new Error(`Failed to deduct frozen balance for user ${bid.userId}`);
        }

        await this.usersService.recordTransaction(
          bid.userId.toString(), 'bid_win', bid.amount,
          user.balance, updatedUser.balance,
          user.frozenBalance, updatedUser.frozenBalance,
          auction._id, bid._id, session,
        );

        winnerBidIds.push(bid._id);
      }

      const isLastRound = auction.currentRound >= auction.roundsConfig.length;
      const noMoreBids = losingBids.length === 0;
      const shouldComplete = isLastRound || noMoreBids;

      if (shouldComplete) {
        for (const bid of losingBids) {
          const updatedBid = await this.bidModel.findOneAndUpdate(
            { _id: bid._id, status: BidStatus.ACTIVE, __v: bid.__v },
            { status: BidStatus.REFUNDED, $inc: { __v: 1 } },
            { new: true, session }
          );

          if (!updatedBid) {
            this.logger.error('Failed to refund bid', bid._id);
            throw new ConflictException('Bid state changed during refund');
          }

          const user = await this.userModel.findById(bid.userId).session(session);
          if (!user) {
            throw new Error(`User not found for refund: ${bid.userId}`);
          }

          const updatedUser = await this.userModel.findOneAndUpdate(
            { _id: bid.userId, frozenBalance: { $gte: bid.amount } },
            { $inc: { balance: bid.amount, frozenBalance: -bid.amount, version: 1 } },
            { new: true, session }
          );

          if (!updatedUser) {
            throw new Error(`Failed to refund balance for user ${bid.userId}`);
          }

          await this.usersService.recordTransaction(
            bid.userId.toString(), 'bid_refund', bid.amount,
            user.balance, updatedUser.balance,
            user.frozenBalance, updatedUser.frozenBalance,
            auction._id, bid._id, session,
          );
        }
      }

      await this.auctionModel.updateOne(
        { _id: auction._id },
        {
          $set: {
            [`rounds.${auction.currentRound - 1}.completed`]: true,
            [`rounds.${auction.currentRound - 1}.actualEndTime`]: now,
            [`rounds.${auction.currentRound - 1}.winnerBidIds`]: winnerBidIds,
          },
        },
        { session }
      );

      let finalAuction: AuctionDocument | null;

      if (shouldComplete) {
        finalAuction = await this.auctionModel.findByIdAndUpdate(
          auctionId,
          { $set: { status: AuctionStatus.COMPLETED, endTime: now } },
          { new: true, session }
        );
      } else {
        const nextRoundConfig = auction.roundsConfig[auction.currentRound];
        const nextRoundEndTime = new Date(now.getTime() + nextRoundConfig.durationMinutes * 60 * 1000);

        finalAuction = await this.auctionModel.findByIdAndUpdate(
          auctionId,
          {
            $set: { currentRound: auction.currentRound + 1 },
            $push: {
              rounds: {
                roundNumber: auction.currentRound + 1,
                itemsCount: nextRoundConfig.itemsCount,
                startTime: now,
                endTime: nextRoundEndTime,
                extensionsCount: 0,
                completed: false,
                winnerBidIds: [],
              },
            },
          },
          { new: true, session }
        );
      }

      if (!finalAuction) {
        throw new Error('Failed to update auction state');
      }

      this.eventsGateway.emitRoundComplete(finalAuction, currentRound.roundNumber, winningBids);

      if (finalAuction.status === AuctionStatus.COMPLETED) {
        this.eventsGateway.emitAuctionComplete(finalAuction);
      } else {
        this.eventsGateway.emitRoundStart(finalAuction, finalAuction.currentRound);
      }

      // Collect notification data for after transaction
      const winnerNotifications: Array<{
        userId: string;
        bidAmount: number;
        itemNumber: number;
      }> = [];

      const loserNotifications: Array<{
        userId: string;
        bidAmount: number;
        refunded: boolean;
      }> = [];

      // Collect winner data
      for (let i = 0; i < winningBids.length; i++) {
        const bid = winningBids[i];
        const user = await this.userModel.findById(bid.userId).session(session);
        if (user && !user.isBot && user.telegramId) {
          winnerNotifications.push({
            userId: bid.userId.toString(),
            bidAmount: bid.amount,
            itemNumber: previousWinnersCount + i + 1,
          });
        }
      }

      // Collect loser data (only if refunded, i.e., auction completed or last round)
      if (shouldComplete) {
        for (const bid of losingBids) {
          const user = await this.userModel.findById(bid.userId).session(session);
          if (user && !user.isBot && user.telegramId) {
            loserNotifications.push({
              userId: bid.userId.toString(),
              bidAmount: bid.amount,
              refunded: true,
            });
          }
        }
      }

      // Collect users to notify about new round (losers who are still in the game)
      const newRoundNotifyUsers: string[] = [];
      if (!shouldComplete) {
        for (const bid of losingBids) {
          const user = await this.userModel.findById(bid.userId).session(session);
          if (user && !user.isBot && user.telegramId) {
            newRoundNotifyUsers.push(bid.userId.toString());
          }
        }
      }

      const nextRound = !shouldComplete ? finalAuction.rounds[finalAuction.currentRound - 1] : null;

      return {
        auction: finalAuction,
        roundNumber: currentRound.roundNumber,
        winnerNotifications,
        loserNotifications,
        isCompleted: finalAuction.status === AuctionStatus.COMPLETED,
        newRoundNotifyUsers: [...new Set(newRoundNotifyUsers)],
        nextRound,
      };
    });

    if (!result) {
      return null;
    }

    // Send notifications asynchronously (don't await)
    const { auction: finalAuction, roundNumber, winnerNotifications, loserNotifications, isCompleted, newRoundNotifyUsers, nextRound } = result;

    // Notify winners
    for (const winner of winnerNotifications) {
      this.notificationsService.notifyRoundWin(winner.userId, {
        auctionId: finalAuction._id.toString(),
        auctionTitle: finalAuction.title,
        roundNumber,
        winningBid: winner.bidAmount,
        itemNumber: winner.itemNumber,
      }).catch(err => this.logger.warn('Failed to send win notification', err));
    }

    // Notify losers (refunded)
    for (const loser of loserNotifications) {
      this.notificationsService.notifyRoundLost(loser.userId, {
        auctionId: finalAuction._id.toString(),
        auctionTitle: finalAuction.title,
        roundNumber,
        yourBid: loser.bidAmount,
        refunded: loser.refunded,
      }).catch(err => this.logger.warn('Failed to send loss notification', err));
    }

    // If new round started, notify users with active bids
    if (!isCompleted && newRoundNotifyUsers.length > 0 && nextRound) {
      for (const notifyUserId of newRoundNotifyUsers) {
        this.notificationsService.notifyNewRoundStarted(notifyUserId, {
          auctionId: finalAuction._id.toString(),
          auctionTitle: finalAuction.title,
          roundNumber: finalAuction.currentRound,
          itemsCount: nextRound.itemsCount,
          endTime: nextRound.endTime!,
        }).catch(err => this.logger.warn('Failed to send new round notification', err));
      }
    }

    // If auction completed, send summary to all participants
    if (isCompleted) {
      this.sendAuctionCompleteNotifications(finalAuction._id.toString())
        .catch(err => this.logger.warn('Failed to send auction complete notifications', err));
    }

    return finalAuction;
  }

  private async sendAuctionCompleteNotifications(auctionId: string): Promise<void> {
    const auction = await this.auctionModel.findById(auctionId);
    if (!auction) return;

    // Get all bids for this auction
    const allBids = await this.bidModel.find({ auctionId: auction._id });

    // Group by user
    const userBids = new Map<string, { wins: number; totalSpent: number }>();

    for (const bid of allBids) {
      const userId = bid.userId.toString();
      if (!userBids.has(userId)) {
        userBids.set(userId, { wins: 0, totalSpent: 0 });
      }
      const userData = userBids.get(userId)!;
      if (bid.status === BidStatus.WON) {
        userData.wins++;
        userData.totalSpent += bid.amount;
      }
    }

    // Send notification to each participant
    for (const [userId, { wins, totalSpent }] of userBids) {
      const user = await this.userModel.findById(userId);
      if (user && !user.isBot && user.telegramId) {
        this.notificationsService.notifyAuctionComplete(userId, {
          auctionId: auction._id.toString(),
          auctionTitle: auction.title,
          totalWins: wins,
          totalSpent,
        }).catch(err => this.logger.warn('Failed to send auction complete notification', err));
      }
    }
  }

  async auditFinancialIntegrity(): Promise<{
    isValid: boolean;
    totalBalance: number;
    totalFrozen: number;
    totalWinnings: number;
    discrepancy: number;
    details: string;
  }> {
    const users = await this.userModel.find({});
    const wonBids = await this.bidModel.find({ status: BidStatus.WON });

    const totalBalance = users.reduce((sum, u) => sum + u.balance, 0);
    const totalFrozen = users.reduce((sum, u) => sum + u.frozenBalance, 0);
    const totalWinnings = wonBids.reduce((sum, b) => sum + b.amount, 0);

    const activeBids = await this.bidModel.find({ status: BidStatus.ACTIVE });
    const totalActiveBidAmount = activeBids.reduce((sum, b) => sum + b.amount, 0);

    const frozenMatchesActive = totalFrozen === totalActiveBidAmount;
    const isValid = frozenMatchesActive && totalBalance >= 0 && totalFrozen >= 0;

    return {
      isValid,
      totalBalance,
      totalFrozen,
      totalWinnings,
      discrepancy: frozenMatchesActive ? 0 : totalFrozen - totalActiveBidAmount,
      details: frozenMatchesActive
        ? 'All balances are consistent'
        : `Frozen balance (${totalFrozen}) does not match active bids (${totalActiveBidAmount})`,
    };
  }

  async getLeaderboard(
    auctionId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<LeaderboardResponse> {
    const auction = await this.findById(auctionId);

    // Get total count of active bids
    const totalCount = await this.bidModel.countDocuments({
      auctionId: auction._id,
      status: BidStatus.ACTIVE,
    });

    // Get active bids with pagination
    const bids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
      .sort({ amount: -1, createdAt: 1 })
      .skip(offset)
      .limit(limit)
      .populate('userId', 'username isBot')
      .exec();

    const currentRound = auction.rounds[auction.currentRound - 1];
    const itemsInRound = currentRound?.itemsCount || 0;

    const leaderboard: LeaderboardEntry[] = bids.map((bid, index) => {
      const populatedUser = isPopulatedUser(bid.userId) ? bid.userId : null;
      const actualRank = offset + index + 1;
      return {
        rank: actualRank,
        amount: bid.amount,
        username: populatedUser?.username || 'Unknown',
        isBot: populatedUser?.isBot || false,
        isWinning: actualRank <= itemsInRound,
        createdAt: bid.createdAt,
      };
    });

    // Get past round winners
    const wonBids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.WON })
      .sort({ wonRound: 1, itemNumber: 1 })
      .populate('userId', 'username isBot')
      .exec();

    const pastWinners: PastWinnerEntry[] = wonBids.map((bid) => {
      const populatedUser = isPopulatedUser(bid.userId) ? bid.userId : null;
      return {
        round: bid.wonRound || 0,
        itemNumber: bid.itemNumber || 0,
        amount: bid.amount,
        username: populatedUser?.username || 'Unknown',
        isBot: populatedUser?.isBot || false,
        createdAt: bid.createdAt,
      };
    });

    return {
      leaderboard,
      totalCount,
      pastWinners,
    };
  }

  async getUserBids(auctionId: string, userId: string): Promise<BidDocument[]> {
    return this.bidModel
      .find({
        auctionId: new Types.ObjectId(auctionId),
        userId: new Types.ObjectId(userId),
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getMinWinningBid(auctionId: string): Promise<number | null> {
    const auction = await this.findById(auctionId);

    if (auction.status !== AuctionStatus.ACTIVE) {
      return null;
    }

    const currentRound = auction.rounds[auction.currentRound - 1];
    if (!currentRound || currentRound.completed) {
      return null;
    }

    const activeBids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
      .sort({ amount: -1, createdAt: 1 })
      .limit(currentRound.itemsCount + 1)
      .exec();

    if (activeBids.length < currentRound.itemsCount) {
      return auction.minBidAmount;
    }

    const lastWinningBid = activeBids[currentRound.itemsCount - 1];
    return lastWinningBid.amount + auction.minBidIncrement;
  }

  async getActiveAuctions(): Promise<AuctionDocument[]> {
    return this.auctionModel.find({ status: AuctionStatus.ACTIVE }).exec();
  }
}
