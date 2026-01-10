import { Injectable, BadRequestException, NotFoundException, ConflictException, Logger, Inject } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types, ClientSession } from 'mongoose';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import Redlock, { Lock } from 'redlock';
import { Auction, AuctionDocument, AuctionStatus, Bid, BidDocument, BidStatus, User, UserDocument } from '@/schemas';
import { UsersService } from '@/modules/users';
import { EventsGateway } from '@/modules/events';
import { REDLOCK, REDIS_CLIENT } from '@/modules/redis';
import { CreateAuctionDto, PlaceBidDto } from './dto';
import { isTransientTransactionError, isDuplicateKeyError, isPopulatedUser, LeaderboardEntry } from '@/common';

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 30;

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

  async create(dto: CreateAuctionDto, userId: string): Promise<AuctionDocument> {
    const totalRoundItems = dto.rounds.reduce((sum, r) => sum + r.itemsCount, 0);
    if (totalRoundItems !== dto.totalItems) {
      throw new BadRequestException('Sum of items in rounds must equal totalItems');
    }

    if (dto.totalItems <= 0) {
      throw new BadRequestException('Total items must be positive');
    }

    if (dto.rounds.some(r => r.itemsCount <= 0 || r.durationMinutes <= 0)) {
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
    dto: PlaceBidDto,
  ): Promise<{ bid: BidDocument; auction: AuctionDocument }> {
    if (!Types.ObjectId.isValid(auctionId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid ID format');
    }

    if (dto.amount <= 0 || !Number.isInteger(dto.amount)) {
      throw new BadRequestException('Bid amount must be a positive integer');
    }

    const lockKey = `bid-lock:${userId}:${auctionId}`;
    const cooldownKey = `bid-cooldown:${userId}:${auctionId}`;
    let lock: Lock;

    try {
      lock = await this.redlock.acquire([lockKey], 10000);
    } catch (error) {
      this.logger.debug('Failed to acquire lock', { lockKey, error });
      throw new ConflictException('Another bid request is being processed. Please wait and try again.');
    }

    try {
      const cooldownExists = await this.redis.exists(cooldownKey);
      if (cooldownExists) {
        throw new ConflictException('Please wait before placing another bid.');
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
              { amount: dto.amount, lastProcessedAt: now, $inc: { __v: 1 } },
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
          }

          this.eventsGateway.emitAntiSnipingExtension(auctionUpdated, currentRound.extensionsCount + 1);
        }

        this.eventsGateway.emitNewBid(auction._id.toString(), {
          amount: bid.amount,
          timestamp: bid.updatedAt || bid.createdAt,
          isIncrease: !isNewBid,
        });

        return { bid, auction: auctionUpdated };
      });

      await this.redis.set(cooldownKey, '1', 'PX', 1000);
      return result;
    } finally {
      await lock.release();
    }
  }

  async completeRound(auctionId: string): Promise<AuctionDocument | null> {
    return this.withTransaction(async (session) => {
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

      return finalAuction;
    });
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

  async getLeaderboard(auctionId: string): Promise<LeaderboardEntry[]> {
    const auction = await this.findById(auctionId);

    const bids = await this.bidModel
      .find({ auctionId: auction._id, status: { $in: [BidStatus.ACTIVE, BidStatus.WON] } })
      .sort({ amount: -1, createdAt: 1 })
      .populate('userId', 'username isBot')
      .exec();

    const currentRound = auction.rounds[auction.currentRound - 1];
    const itemsInRound = currentRound?.itemsCount || 0;

    let activeRank = 0;
    return bids.map((bid, index) => {
      if (bid.status === BidStatus.ACTIVE) {
        activeRank++;
      }
      const populatedUser = isPopulatedUser(bid.userId) ? bid.userId : null;
      return {
        rank: index + 1,
        amount: bid.amount,
        username: populatedUser?.username || 'Unknown',
        isBot: populatedUser?.isBot || false,
        status: bid.status,
        itemNumber: bid.itemNumber,
        isWinning: bid.status === BidStatus.ACTIVE && activeRank <= itemsInRound,
        createdAt: bid.createdAt,
      };
    });
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
