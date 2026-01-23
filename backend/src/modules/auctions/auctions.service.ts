import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
  Inject,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, Types, type ClientSession } from "mongoose";
import { randomInt } from "crypto";
import Redis from "ioredis";
import Redlock, { type Lock } from "redlock";
import {
  Auction,
  AuctionDocument,
  AuctionStatus,
  Bid,
  BidDocument,
  BidStatus,
  User,
  UserDocument,
} from "@/schemas";
import { UsersService } from "@/modules/users";
import { EventsGateway } from "@/modules/events";
import { NotificationsService } from "@/modules/notifications";
import { redlock, redisClient, BidCacheService } from "@/modules/redis";
import { CacheSyncService } from "@/modules/redis/cache-sync.service";
import { TimerService } from "./timer.service";
import type { ICreateAuction, IPlaceBid } from "./dto";
import {
  isTransientTransactionError,
  isDuplicateKeyError,
  isPopulatedUser,
  type LeaderboardEntry,
  type PastWinnerEntry,
  type LeaderboardResponse,
  localhostIps,
} from "@/common";

const maxRetries = 20;
const retryDelayMs = 50;

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
    private timerService: TimerService,
    private bidCacheService: BidCacheService,
    private cacheSyncService: CacheSyncService,
    @Inject(redlock) private readonly redlockInstance: Redlock,
    @Inject(redisClient) private readonly redis: Redis,
  ) {}

  async create(dto: ICreateAuction, userId: string): Promise<AuctionDocument> {
    const totalRoundItems = dto.rounds.reduce(
      (sum: number, r: ICreateAuction["rounds"][0]) => sum + r.itemsCount,
      0,
    );
    if (totalRoundItems !== dto.totalItems) {
      throw new BadRequestException(
        "Sum of items in rounds must equal totalItems",
      );
    }

    if (dto.totalItems <= 0) {
      throw new BadRequestException("Total items must be positive");
    }

    if (
      dto.rounds.some(
        (r: ICreateAuction["rounds"][0]) =>
          r.itemsCount <= 0 || r.durationMinutes <= 0,
      )
    ) {
      throw new BadRequestException(
        "Round items and duration must be positive",
      );
    }

    return await this.auctionModel.create({
      title: dto.title,
      description: dto.description,
      totalItems: dto.totalItems,
      roundsConfig: dto.rounds,
      minBidAmount: dto.minBidAmount ?? 100,
      minBidIncrement: dto.minBidIncrement ?? 10,
      antiSnipingWindowMinutes: dto.antiSnipingWindowMinutes ?? 5,
      antiSnipingExtensionMinutes: dto.antiSnipingExtensionMinutes ?? 5,
      maxExtensions: dto.maxExtensions ?? 6,
      botsEnabled: dto.botsEnabled ?? true,
      botCount: dto.botCount ?? 5,
      createdBy: new Types.ObjectId(userId),
      status: AuctionStatus.PENDING,
    });
  }

  async findAll(status?: AuctionStatus): Promise<AuctionDocument[]> {
    const query = status !== undefined ? { status } : {};
    return await this.auctionModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<AuctionDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException("Invalid auction ID");
    }
    const auction = await this.auctionModel.findById(id);
    if (auction === null) {
      throw new NotFoundException("Auction not found");
    }
    return auction;
  }

  async start(id: string): Promise<AuctionDocument> {
    const result = await this.withTransaction(async (session) => {
      const auction = await this.auctionModel.findOneAndUpdate(
        { _id: new Types.ObjectId(id), status: AuctionStatus.PENDING },
        { $inc: { version: 1 } },
        { new: false, session },
      );

      if (auction === null) {
        const exists = await this.auctionModel.findById(id).session(session);
        if (exists === null) {
          throw new NotFoundException("Auction not found");
        }
        throw new BadRequestException(
          "Auction can only be started from pending status",
        );
      }

      const now = new Date();
      const firstRoundConfig = auction.roundsConfig[0];
      if (firstRoundConfig === undefined) {
        throw new BadRequestException("Auction has no rounds configured");
      }
      const roundEndTime = new Date(
        now.getTime() + firstRoundConfig.durationMinutes * 60 * 1000,
      );

      const updatedAuction = await this.auctionModel.findByIdAndUpdate(
        id,
        {
          status: AuctionStatus.ACTIVE,
          startTime: now,
          currentRound: 1,
          rounds: [
            {
              roundNumber: 1,
              itemsCount: firstRoundConfig.itemsCount,
              startTime: now,
              endTime: roundEndTime,
              extensionsCount: 0,
              completed: false,
              winnerBidIds: [],
            },
          ],
        },
        { new: true, session },
      );

      if (updatedAuction === null) {
        throw new ConflictException(
          "Failed to start auction - concurrent modification",
        );
      }

      this.eventsGateway.emitAuctionUpdate(updatedAuction);

      void this.timerService.startTimer(
        updatedAuction._id.toString(),
        1,
        roundEndTime,
      );

      return updatedAuction;
    });

    this.warmupAuctionCache(id).catch((err: unknown) =>
      this.logger.error(`Failed to warm up cache for auction ${id}`, err),
    );

    return result;
  }

  async placeBid(
    auctionId: string,
    userId: string,
    dto: IPlaceBid,
    clientIp?: string,
  ): Promise<{ bid: BidDocument; auction: AuctionDocument }> {
    if (!Types.ObjectId.isValid(auctionId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException("Invalid ID format");
    }

    if (dto.amount <= 0 || !Number.isInteger(dto.amount)) {
      throw new BadRequestException("Bid amount must be a positive integer");
    }

    const isLocalhost =
      clientIp !== undefined &&
      clientIp !== "" &&
      localhostIps.includes(clientIp);
    const lockKey = `bid-lock:${userId}:${auctionId}`;
    const cooldownKey = `bid-cooldown:${userId}:${auctionId}`;
    let lock: Lock | null = null;

    if (!isLocalhost) {
      try {
        lock = await this.redlockInstance.acquire([lockKey], 10000);
      } catch (error: unknown) {
        this.logger.debug("Failed to acquire lock", { lockKey, error });
        throw new ConflictException(
          "Another bid request is being processed. Please wait and try again.",
        );
      }
    }

    try {
      if (!isLocalhost) {
        const cooldownExists = await this.redis.exists(cooldownKey);
        if (cooldownExists > 0) {
          throw new ConflictException(
            "Please wait before placing another bid.",
          );
        }
      }

      const result = await this.withTransaction(async (session) => {
        const auction = await this.auctionModel.findOneAndUpdate(
          { _id: new Types.ObjectId(auctionId), status: AuctionStatus.ACTIVE },
          { $inc: { version: 1 } },
          { new: true, session },
        );

        if (auction === null) {
          const exists = await this.auctionModel
            .findById(auctionId)
            .session(session);
          if (exists === null) {
            throw new NotFoundException("Auction not found");
          }
          throw new BadRequestException("Auction is not active");
        }

        const currentRound = auction.rounds[auction.currentRound - 1];
        if (currentRound === undefined || currentRound.completed) {
          throw new BadRequestException("No active round");
        }

        const now = new Date();
        const boundaryBufferMs = 100;
        const roundEndTime = currentRound.endTime;
        if (
          roundEndTime !== undefined &&
          now.getTime() > roundEndTime.getTime() - boundaryBufferMs
        ) {
          throw new BadRequestException("Round has ended or is about to end");
        }

        if (dto.amount < auction.minBidAmount) {
          throw new BadRequestException(
            `Minimum bid is ${String(auction.minBidAmount)}`,
          );
        }

        const user = await this.userModel.findById(userId).session(session);
        if (user === null) {
          throw new NotFoundException("User not found");
        }

        const itemsInRound = currentRound.itemsCount;
        const winningBidsBefore = await this.bidModel
          .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
          .sort({ amount: -1, createdAt: 1 })
          .limit(itemsInRound)
          .session(session);
        const winningUserIdsBefore = new Set(
          winningBidsBefore.map((b) => b.userId.toString()),
        );

        let lockedBid: BidDocument | null = null;
        let isNewBid = false;
        let originalVersion: number;

        const existingBid = await this.bidModel
          .findOne({
            auctionId: auction._id,
            userId: new Types.ObjectId(userId),
            status: BidStatus.ACTIVE,
          })
          .session(session);

        if (existingBid !== null) {
          lockedBid = existingBid;
          originalVersion = existingBid.__v;
        } else {
          try {
            const createdBids = await this.bidModel.create(
              [
                {
                  auctionId: auction._id,
                  userId: new Types.ObjectId(userId),
                  amount: dto.amount,
                  status: BidStatus.ACTIVE,
                  lastProcessedAt: now,
                },
              ],
              { session },
            );
            const newBid = createdBids[0];
            if (newBid === undefined) {
              throw new Error("Failed to create bid");
            }
            lockedBid = newBid;
            originalVersion = 0;
            isNewBid = true;
          } catch (error: unknown) {
            if (isDuplicateKeyError(error)) {
              throw new ConflictException(
                "Another bid request is being processed. Please wait and try again.",
              );
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
            await this.bidModel
              .deleteOne({ _id: lockedBid._id })
              .session(session);
            throw new BadRequestException(
              `Insufficient balance. Need ${String(amountToFreeze)}, have ${String(user.balance)}`,
            );
          }

          const existingAmountBid = await this.bidModel
            .findOne({
              auctionId: auction._id,
              amount: dto.amount,
              status: BidStatus.ACTIVE,
              _id: { $ne: lockedBid._id },
            })
            .session(session);

          if (existingAmountBid !== null) {
            await this.bidModel
              .deleteOne({ _id: lockedBid._id })
              .session(session);
            throw new ConflictException(
              `Bid amount ${String(dto.amount)} is already taken. Try a different amount.`,
            );
          }

          const frozenResult = await this.userModel.findOneAndUpdate(
            {
              _id: new Types.ObjectId(userId),
              balance: { $gte: amountToFreeze },
              version: user.version,
            },
            {
              $inc: {
                balance: -amountToFreeze,
                frozenBalance: amountToFreeze,
                version: 1,
              },
            },
            { new: true, session },
          );

          if (frozenResult === null) {
            await this.bidModel
              .deleteOne({ _id: lockedBid._id })
              .session(session);
            throw new ConflictException(
              "Failed to freeze balance - concurrent modification or insufficient funds",
            );
          }

          await this.usersService.recordTransaction(
            userId,
            "bid_freeze",
            amountToFreeze,
            user.balance,
            frozenResult.balance,
            user.frozenBalance,
            frozenResult.frozenBalance,
            auction._id,
            lockedBid._id,
            session,
          );

          bid = lockedBid;
        } else {
          previousBidAmount = lockedBid.amount;

          if (dto.amount <= lockedBid.amount) {
            throw new BadRequestException(
              `New bid must be higher than current bid (${String(lockedBid.amount)})`,
            );
          }

          const increment = dto.amount - lockedBid.amount;

          if (increment < auction.minBidIncrement) {
            throw new BadRequestException(
              `Minimum bid increment is ${String(auction.minBidIncrement)}`,
            );
          }

          const conflictingBid = await this.bidModel
            .findOne({
              auctionId: auction._id,
              amount: dto.amount,
              status: BidStatus.ACTIVE,
              _id: { $ne: lockedBid._id },
            })
            .session(session);

          if (conflictingBid !== null) {
            throw new ConflictException(
              `Bid amount ${String(dto.amount)} is already taken. Try a different amount.`,
            );
          }

          amountToFreeze = increment;

          if (user.balance < amountToFreeze) {
            throw new BadRequestException(
              `Insufficient balance. Need ${String(amountToFreeze)}, have ${String(user.balance)}`,
            );
          }

          const frozenResult = await this.userModel.findOneAndUpdate(
            {
              _id: new Types.ObjectId(userId),
              balance: { $gte: amountToFreeze },
              version: user.version,
            },
            {
              $inc: {
                balance: -amountToFreeze,
                frozenBalance: amountToFreeze,
                version: 1,
              },
            },
            { new: true, session },
          );

          if (frozenResult === null) {
            throw new ConflictException(
              "Failed to freeze balance - concurrent modification or insufficient funds",
            );
          }

          await this.usersService.recordTransaction(
            userId,
            "bid_freeze",
            amountToFreeze,
            user.balance,
            frozenResult.balance,
            user.frozenBalance,
            frozenResult.frozenBalance,
            auction._id,
            lockedBid._id,
            session,
          );

          let updatedBid: BidDocument | null;
          try {
            updatedBid = await this.bidModel.findOneAndUpdate(
              {
                _id: lockedBid._id,
                __v: originalVersion,
                amount: previousBidAmount,
              },
              {
                amount: dto.amount,
                lastProcessedAt: now,
                outbidNotifiedAt: null,
                $inc: { __v: 1 },
              },
              { new: true, session },
            );
          } catch (error: unknown) {
            if (isDuplicateKeyError(error)) {
              throw new ConflictException(
                `Bid amount ${String(dto.amount)} is already taken. Try a different amount.`,
              );
            }
            throw error;
          }

          if (updatedBid === null) {
            throw new ConflictException(
              "Bid was modified by another request. Please try again.",
            );
          }

          bid = updatedBid;
        }

        const timeUntilEnd =
          roundEndTime !== undefined
            ? roundEndTime.getTime() - now.getTime()
            : 0;
        const antiSnipingWindow = auction.antiSnipingWindowMinutes * 60 * 1000;

        let auctionUpdated: AuctionDocument = auction;
        let antiSnipingTriggered = false;
        let antiSnipingNewEndTime: Date | null = null;

        if (
          timeUntilEnd > 0 &&
          timeUntilEnd <= antiSnipingWindow &&
          currentRound.extensionsCount < auction.maxExtensions
        ) {
          const extension = auction.antiSnipingExtensionMinutes * 60 * 1000;
          const currentEndTime =
            roundEndTime !== undefined ? roundEndTime.getTime() : now.getTime();
          const newEndTime = new Date(currentEndTime + extension);

          const updated = await this.auctionModel.findByIdAndUpdate(
            auctionId,
            {
              $set: {
                [`rounds.${String(auction.currentRound - 1)}.endTime`]:
                  newEndTime,
              },
              $inc: {
                [`rounds.${String(auction.currentRound - 1)}.extensionsCount`]: 1,
              },
            },
            { new: true, session },
          );

          if (updated !== null) {
            auctionUpdated = updated;
            antiSnipingTriggered = true;
            antiSnipingNewEndTime = newEndTime;

            this.timerService.updateTimer(auctionId, newEndTime);
          }

          this.eventsGateway.emitAntiSnipingExtension(
            auctionUpdated,
            currentRound.extensionsCount + 1,
          );
        }

        this.eventsGateway.emitNewBid(auction._id.toString(), {
          amount: bid.amount,
          timestamp: bid.updatedAt,
          isIncrease: !isNewBid,
        });

        const allActiveBids = await this.bidModel
          .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
          .sort({ amount: -1, createdAt: 1 })
          .session(session);

        const winningUserIdsAfter = new Set(
          allActiveBids.slice(0, itemsInRound).map((b) => b.userId.toString()),
        );

        const outbidUsers: {
          bidId: string;
          outbidUserId: string;
          bidAmount: number;
        }[] = [];

        for (const pushedOutUserId of winningUserIdsBefore) {
          if (
            !winningUserIdsAfter.has(pushedOutUserId) &&
            pushedOutUserId !== userId
          ) {
            const pushedOutBid = allActiveBids.find(
              (b) => b.userId.toString() === pushedOutUserId,
            );
            if (pushedOutBid !== undefined) {
              const pushedOutUser = await this.userModel
                .findById(pushedOutUserId)
                .session(session);
              if (
                pushedOutUser !== null &&
                !pushedOutUser.isBot &&
                pushedOutUser.telegramId !== undefined
              ) {
                outbidUsers.push({
                  bidId: pushedOutBid._id.toString(),
                  outbidUserId: pushedOutUserId,
                  bidAmount: pushedOutBid.amount,
                });
              }
            }
          }
        }

        const antiSnipingNotifyUsers: string[] = [];
        if (antiSnipingTriggered) {
          for (const activeBid of allActiveBids) {
            if (activeBid.userId.toString() !== userId) {
              const bidUser = await this.userModel
                .findById(activeBid.userId)
                .session(session);
              if (
                bidUser !== null &&
                !bidUser.isBot &&
                bidUser.telegramId !== undefined
              ) {
                antiSnipingNotifyUsers.push(activeBid.userId.toString());
              }
            }
          }
        }

        const lastWinningBid = allActiveBids[itemsInRound - 1];
        return {
          bid,
          auction: auctionUpdated,
          outbidUsers,
          minBidToWin:
            lastWinningBid !== undefined
              ? lastWinningBid.amount + auction.minBidIncrement
              : auction.minBidAmount,
          antiSnipingTriggered,
          antiSnipingNewEndTime,
          antiSnipingNotifyUsers: [...new Set(antiSnipingNotifyUsers)],
        };
      });

      if (result.outbidUsers.length > 0) {
        const notifyPromises = result.outbidUsers.map(
          async ({ bidId, outbidUserId, bidAmount }) => {
            try {
              const updated = await this.bidModel.findOneAndUpdate(
                { _id: bidId, outbidNotifiedAt: null },
                { outbidNotifiedAt: new Date() },
                { new: true },
              );
              if (updated !== null) {
                await this.notificationsService.notifyOutbid(outbidUserId, {
                  auctionId: result.auction._id.toString(),
                  auctionTitle: result.auction.title,
                  yourBid: bidAmount,
                  newLeaderBid: result.bid.amount,
                  roundNumber: result.auction.currentRound,
                  minBidToWin: result.minBidToWin,
                });
              }
            } catch (err: unknown) {
              this.logger.warn("Failed to send outbid notification", err);
            }
          },
        );
        Promise.all(notifyPromises).catch((err: unknown) =>
          this.logger.error("Failed to send outbid notification batch", err),
        );
      }

      if (
        result.antiSnipingTriggered &&
        result.antiSnipingNotifyUsers.length > 0
      ) {
        const roundIndex = result.auction.currentRound - 1;
        const currentRound = result.auction.rounds[roundIndex];
        const newExtensionsCount = currentRound?.extensionsCount ?? 0;

        this.auctionModel
          .findOneAndUpdate(
            {
              _id: result.auction._id,
              [`rounds.${String(roundIndex)}.lastNotifiedExtensionCount`]: {
                $lt: newExtensionsCount,
              },
            },
            {
              $set: {
                [`rounds.${String(roundIndex)}.lastNotifiedExtensionCount`]:
                  newExtensionsCount,
              },
            },
          )
          .then(async (updated) => {
            if (updated !== null) {
              const antiSnipingEndTime = result.antiSnipingNewEndTime;
              if (antiSnipingEndTime === null) {
                return undefined;
              }
              const antiSnipingPromises = result.antiSnipingNotifyUsers.map(
                async (notifyUserId) =>
                  await this.notificationsService
                    .notifyAntiSniping(notifyUserId, {
                      auctionId: result.auction._id.toString(),
                      auctionTitle: result.auction.title,
                      roundNumber: result.auction.currentRound,
                      newEndTime: antiSnipingEndTime,
                      extensionMinutes:
                        result.auction.antiSnipingExtensionMinutes,
                    })
                    .catch((err: unknown) =>
                      this.logger.warn(
                        "Failed to send anti-sniping notification",
                        err,
                      ),
                    ),
              );

              return await Promise.all(antiSnipingPromises);
            }
            return undefined;
          })
          .catch((err: unknown) =>
            this.logger.error(
              "Failed to send anti-sniping notification batch",
              err,
            ),
          );
      }

      if (!isLocalhost) {
        await this.redis.set(cooldownKey, "1", "PX", 1000);
      }
      return { bid: result.bid, auction: result.auction };
    } finally {
      if (lock !== null) {
        await lock.release();
      }
    }
  }

  async completeRound(auctionId: string): Promise<AuctionDocument | null> {
    const result = await this.withTransaction(async (session) => {
      const auction = await this.auctionModel.findOneAndUpdate(
        { _id: new Types.ObjectId(auctionId), status: AuctionStatus.ACTIVE },
        { $inc: { version: 1 } },
        { new: true, session },
      );

      if (auction === null) {
        return null;
      }

      const currentRound = auction.rounds[auction.currentRound - 1];
      if (currentRound === undefined || currentRound.completed) {
        return null;
      }

      const now = new Date();
      const roundEndTime = currentRound.endTime;
      if (roundEndTime !== undefined && now < roundEndTime) {
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
        if (bid === undefined) continue;
        const itemNumber = previousWinnersCount + i + 1;

        const updatedBid = await this.bidModel.findOneAndUpdate(
          { _id: bid._id, status: BidStatus.ACTIVE, __v: bid.__v },
          {
            status: BidStatus.WON,
            wonRound: auction.currentRound,
            itemNumber,
            $inc: { __v: 1 },
          },
          { new: true, session },
        );

        if (updatedBid === null) {
          this.logger.error("Failed to update winning bid", bid._id);
          throw new ConflictException(
            "Bid state changed during round completion",
          );
        }

        const user = await this.userModel.findById(bid.userId).session(session);
        if (user === null) {
          throw new Error(`User not found for bid ${String(bid._id)}`);
        }

        const updatedUser = await this.userModel.findOneAndUpdate(
          { _id: bid.userId, frozenBalance: { $gte: bid.amount } },
          { $inc: { frozenBalance: -bid.amount, version: 1 } },
          { new: true, session },
        );

        if (updatedUser === null) {
          throw new Error(
            `Failed to deduct frozen balance for user ${String(bid.userId)}`,
          );
        }

        await this.usersService.recordTransaction(
          bid.userId.toString(),
          "bid_win",
          bid.amount,
          user.balance,
          updatedUser.balance,
          user.frozenBalance,
          updatedUser.frozenBalance,
          auction._id,
          bid._id,
          session,
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
            { new: true, session },
          );

          if (updatedBid === null) {
            this.logger.error("Failed to refund bid", bid._id);
            throw new ConflictException("Bid state changed during refund");
          }

          const user = await this.userModel
            .findById(bid.userId)
            .session(session);
          if (user === null) {
            throw new Error(`User not found for refund: ${String(bid.userId)}`);
          }

          const updatedUser = await this.userModel.findOneAndUpdate(
            { _id: bid.userId, frozenBalance: { $gte: bid.amount } },
            {
              $inc: {
                balance: bid.amount,
                frozenBalance: -bid.amount,
                version: 1,
              },
            },
            { new: true, session },
          );

          if (updatedUser === null) {
            throw new Error(
              `Failed to refund balance for user ${String(bid.userId)}`,
            );
          }

          await this.usersService.recordTransaction(
            bid.userId.toString(),
            "bid_refund",
            bid.amount,
            user.balance,
            updatedUser.balance,
            user.frozenBalance,
            updatedUser.frozenBalance,
            auction._id,
            bid._id,
            session,
          );
        }
      }

      await this.auctionModel.updateOne(
        { _id: auction._id },
        {
          $set: {
            [`rounds.${String(auction.currentRound - 1)}.completed`]: true,
            [`rounds.${String(auction.currentRound - 1)}.actualEndTime`]: now,
            [`rounds.${String(auction.currentRound - 1)}.winnerBidIds`]:
              winnerBidIds,
          },
        },
        { session },
      );

      let finalAuction: AuctionDocument | null;

      if (shouldComplete) {
        finalAuction = await this.auctionModel.findByIdAndUpdate(
          auctionId,
          { $set: { status: AuctionStatus.COMPLETED, endTime: now } },
          { new: true, session },
        );
      } else {
        const nextRoundConfig = auction.roundsConfig[auction.currentRound];
        if (nextRoundConfig === undefined) {
          throw new Error("Next round config not found");
        }
        const nextRoundEndTime = new Date(
          now.getTime() + nextRoundConfig.durationMinutes * 60 * 1000,
        );

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
          { new: true, session },
        );
      }

      if (finalAuction === null) {
        throw new Error("Failed to update auction state");
      }

      this.eventsGateway.emitRoundComplete(
        finalAuction,
        currentRound.roundNumber,
        winningBids,
      );

      if (finalAuction.status === AuctionStatus.COMPLETED) {
        this.eventsGateway.emitAuctionComplete(finalAuction);
      } else {
        this.eventsGateway.emitRoundStart(
          finalAuction,
          finalAuction.currentRound,
        );
      }

      const winnerNotifications: {
        winnerId: string;
        bidAmount: number;
        itemNumber: number;
      }[] = [];

      const loserNotifications: {
        loserId: string;
        bidAmount: number;
        refunded: boolean;
      }[] = [];

      const allBidUserIds = [
        ...winningBids.map((b) => b.userId),
        ...losingBids.map((b) => b.userId),
      ];
      const uniqueUserIds = [
        ...new Set(allBidUserIds.map((id) => id.toString())),
      ];
      const users = await this.userModel
        .find({ _id: { $in: uniqueUserIds } })
        .session(session);
      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      for (let i = 0; i < winningBids.length; i++) {
        const bid = winningBids[i];
        if (bid === undefined) continue;
        const user = userMap.get(bid.userId.toString());
        if (
          user !== undefined &&
          !user.isBot &&
          user.telegramId !== undefined
        ) {
          winnerNotifications.push({
            winnerId: bid.userId.toString(),
            bidAmount: bid.amount,
            itemNumber: previousWinnersCount + i + 1,
          });
        }
      }

      if (shouldComplete) {
        for (const bid of losingBids) {
          const user = userMap.get(bid.userId.toString());
          if (
            user !== undefined &&
            !user.isBot &&
            user.telegramId !== undefined
          ) {
            loserNotifications.push({
              loserId: bid.userId.toString(),
              bidAmount: bid.amount,
              refunded: true,
            });
          }
        }
      }

      const newRoundNotifyUsers: string[] = [];
      if (!shouldComplete) {
        for (const bid of losingBids) {
          const user = userMap.get(bid.userId.toString());
          if (
            user !== undefined &&
            !user.isBot &&
            user.telegramId !== undefined
          ) {
            newRoundNotifyUsers.push(bid.userId.toString());
          }
        }
      }

      const nextRound = !shouldComplete
        ? finalAuction.rounds[finalAuction.currentRound - 1]
        : null;

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

    if (result === null) {
      return null;
    }

    const {
      auction: finalAuction,
      roundNumber,
      winnerNotifications,
      loserNotifications,
      isCompleted,
      newRoundNotifyUsers,
      nextRound,
    } = result;

    for (const winner of winnerNotifications) {
      this.notificationsService
        .notifyRoundWin(winner.winnerId, {
          auctionId: finalAuction._id.toString(),
          auctionTitle: finalAuction.title,
          roundNumber,
          winningBid: winner.bidAmount,
          itemNumber: winner.itemNumber,
        })
        .catch((err: unknown) =>
          this.logger.warn("Failed to send win notification", err),
        );
    }

    for (const loser of loserNotifications) {
      this.notificationsService
        .notifyRoundLost(loser.loserId, {
          auctionId: finalAuction._id.toString(),
          auctionTitle: finalAuction.title,
          roundNumber,
          yourBid: loser.bidAmount,
          refunded: loser.refunded,
        })
        .catch((err: unknown) =>
          this.logger.warn("Failed to send loss notification", err),
        );
    }

    if (
      !isCompleted &&
      newRoundNotifyUsers.length > 0 &&
      nextRound !== null &&
      nextRound !== undefined
    ) {
      const nextRoundEndTime = nextRound.endTime;
      if (nextRoundEndTime !== undefined) {
        for (const notifyUserId of newRoundNotifyUsers) {
          this.notificationsService
            .notifyNewRoundStarted(notifyUserId, {
              auctionId: finalAuction._id.toString(),
              auctionTitle: finalAuction.title,
              roundNumber: finalAuction.currentRound,
              itemsCount: nextRound.itemsCount,
              endTime: nextRoundEndTime,
            })
            .catch((err: unknown) =>
              this.logger.warn("Failed to send new round notification", err),
            );
        }
      }
    }

    if (isCompleted) {
      this.timerService.stopTimer(finalAuction._id.toString());
    } else if (nextRound !== null && nextRound !== undefined) {
      const nextRoundEndTime = nextRound.endTime;
      if (nextRoundEndTime !== undefined) {
        void this.timerService.startTimer(
          finalAuction._id.toString(),
          finalAuction.currentRound,
          nextRoundEndTime,
        );
      }
    }

    if (isCompleted) {
      this.sendAuctionCompleteNotifications(finalAuction._id.toString()).catch(
        (err: unknown) =>
          this.logger.warn(
            "Failed to send auction complete notifications",
            err,
          ),
      );
    }

    return finalAuction;
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
    const totalActiveBidAmount = activeBids.reduce(
      (sum, b) => sum + b.amount,
      0,
    );

    const frozenMatchesActive = totalFrozen === totalActiveBidAmount;
    const isValid =
      frozenMatchesActive && totalBalance >= 0 && totalFrozen >= 0;

    return {
      isValid,
      totalBalance,
      totalFrozen,
      totalWinnings,
      discrepancy: frozenMatchesActive ? 0 : totalFrozen - totalActiveBidAmount,
      details: frozenMatchesActive
        ? "All balances are consistent"
        : `Frozen balance (${String(totalFrozen)}) does not match active bids (${String(totalActiveBidAmount)})`,
    };
  }

  async getLeaderboard(
    auctionId: string,
    limit = 50,
    offset = 0,
  ): Promise<LeaderboardResponse> {
    const auction = await this.findById(auctionId);

    const totalCount = await this.bidModel.countDocuments({
      auctionId: auction._id,
      status: BidStatus.ACTIVE,
    });

    const bids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
      .sort({ amount: -1, createdAt: 1 })
      .skip(offset)
      .limit(limit)
      .populate("userId", "username isBot")
      .exec();

    const currentRound = auction.rounds[auction.currentRound - 1];
    const itemsInRound = currentRound?.itemsCount ?? 0;

    const leaderboard: LeaderboardEntry[] = bids.map((bid, index) => {
      const populatedUser = isPopulatedUser(bid.userId) ? bid.userId : null;
      const actualRank = offset + index + 1;
      return {
        rank: actualRank,
        amount: bid.amount,
        username: populatedUser?.username ?? "Unknown",
        isBot: populatedUser?.isBot ?? false,
        isWinning: actualRank <= itemsInRound,
        createdAt: bid.createdAt,
      };
    });

    const wonBids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.WON })
      .sort({ wonRound: 1, itemNumber: 1 })
      .populate("userId", "username isBot")
      .exec();

    const pastWinners: PastWinnerEntry[] = wonBids.map((bid) => {
      const populatedUser = isPopulatedUser(bid.userId) ? bid.userId : null;
      return {
        round: bid.wonRound ?? 0,
        itemNumber: bid.itemNumber ?? 0,
        amount: bid.amount,
        username: populatedUser?.username ?? "Unknown",
        isBot: populatedUser?.isBot ?? false,
        createdAt: bid.createdAt,
      };
    });

    return {
      leaderboard,
      totalCount,
      pastWinners,
    };
  }

  async getUserBids(
    auctionId: string,
    targetUserId: string,
  ): Promise<BidDocument[]> {
    return await this.bidModel
      .find({
        auctionId: new Types.ObjectId(auctionId),
        userId: new Types.ObjectId(targetUserId),
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
    if (currentRound === undefined || currentRound.completed) {
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
    if (lastWinningBid === undefined) {
      return auction.minBidAmount;
    }
    return lastWinningBid.amount + auction.minBidIncrement;
  }

  async getActiveAuctions(): Promise<AuctionDocument[]> {
    return await this.auctionModel
      .find({ status: AuctionStatus.ACTIVE })
      .exec();
  }

  async warmupAuctionCache(auctionId: string): Promise<void> {
    const auction = await this.auctionModel.findById(auctionId);
    if (auction === null) {
      throw new NotFoundException("Auction not found");
    }

    this.logger.log(`Warming up cache for auction ${auctionId}`);

    const currentRound = auction.rounds[auction.currentRound - 1];
    await this.bidCacheService.setAuctionMeta(auctionId, {
      minBidAmount: auction.minBidAmount,
      status: auction.status,
      currentRound: auction.currentRound,
      roundEndTime: currentRound?.endTime?.getTime(),
      itemsInRound: currentRound?.itemsCount ?? 1,
      antiSnipingWindowMs: auction.antiSnipingWindowMinutes * 60 * 1000,
      antiSnipingExtensionMs: auction.antiSnipingExtensionMinutes * 60 * 1000,
      maxExtensions: auction.maxExtensions,
    });

    const existingBids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
      .lean();

    if (existingBids.length > 0) {
      await this.bidCacheService.warmupBids(
        auctionId,
        existingBids.map((bid) => ({
          userId: bid.userId.toString(),
          amount: bid.amount,
          createdAt: bid.createdAt,
        })),
      );
    }

    const usersWithBalance = await this.userModel
      .find({ balance: { $gt: 0 } })
      .select("_id balance frozenBalance")
      .lean();

    if (usersWithBalance.length > 0) {
      await this.bidCacheService.warmupBalances(
        auctionId,
        usersWithBalance.map((user) => ({
          id: user._id.toString(),
          balance: user.balance,
          frozenBalance: user.frozenBalance,
        })),
      );
    }

    this.logger.log(
      `Cache warmed up: ${String(existingBids.length)} bids, ${String(usersWithBalance.length)} users`,
    );
  }

  async ensureUserInCache(
    auctionId: string,
    targetUserId: string,
  ): Promise<void> {
    const user = await this.userModel
      .findById(targetUserId)
      .select("balance frozenBalance");
    if (user === null) {
      throw new NotFoundException("User not found");
    }

    await this.bidCacheService.warmupUserBalance(
      auctionId,
      targetUserId,
      user.balance,
      user.frozenBalance,
    );
  }

  async placeBidFast(
    auctionId: string,
    bidderId: string,
    dto: IPlaceBid,
  ): Promise<{
    success: boolean;
    amount?: number;
    previousAmount?: number;
    rank?: number;
    isNewBid?: boolean;
    error?: string;
    auction?: AuctionDocument;
  }> {
    if (
      !Types.ObjectId.isValid(auctionId) ||
      !Types.ObjectId.isValid(bidderId)
    ) {
      return { success: false, error: "Invalid ID format" };
    }

    if (dto.amount <= 0 || !Number.isInteger(dto.amount)) {
      return { success: false, error: "Bid amount must be a positive integer" };
    }

    const result = await this.bidCacheService.placeBidUltraFast(
      auctionId,
      bidderId,
      dto.amount,
    );

    if (result.needsWarmup === true) {
      this.logger.debug(
        `Ultra-fast path unavailable for ${auctionId}/${bidderId}, using standard bid`,
      );
      try {
        const standardResult = await this.placeBid(auctionId, bidderId, dto);
        return {
          success: true,
          amount: standardResult.bid.amount,
          previousAmount: 0,
          isNewBid: true,
          auction: standardResult.auction,
        };
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const newAmount = result.newAmount ?? 0;

    this.eventsGateway.emitNewBid(auctionId, {
      amount: newAmount,
      timestamp: new Date(),
      isIncrease: !(result.isNewBid ?? false),
    });

    const roundEndTime = result.roundEndTime ?? 0;
    if (roundEndTime > 0) {
      const auctionMeta = {
        roundEndTime,
        antiSnipingWindowMs: result.antiSnipingWindowMs ?? 0,
        antiSnipingExtensionMs: result.antiSnipingExtensionMs ?? 0,
        maxExtensions: result.maxExtensions ?? 0,
        itemsInRound: result.itemsInRound ?? 1,
        currentRound: result.currentRound ?? 1,
      };

      this.checkAntiSnipingUltraFast(auctionId, auctionMeta).catch(
        (err: unknown) => this.logger.error("Anti-sniping check failed", err),
      );

      this.checkOutbidNotificationsUltraFast(
        auctionId,
        auctionMeta,
        bidderId,
        newAmount,
      ).catch((err: unknown) =>
        this.logger.error("Outbid notification check failed", err),
      );
    }

    return {
      success: true,
      amount: result.newAmount,
      previousAmount: result.previousAmount,
      rank: result.rank,
      isNewBid: result.isNewBid,
    };
  }

  async syncBeforeRoundComplete(auctionId: string): Promise<void> {
    await this.cacheSyncService.fullSync(auctionId);
  }

  async getLeaderboardFast(
    auctionId: string,
    limit = 50,
    offset = 0,
  ): Promise<{
    entries: {
      oduserId: string;
      amount: number;
      rank: number;
      username: string;
      isBot: boolean;
    }[];
    totalCount: number;
  }> {
    const isWarmed = await this.bidCacheService.isCacheWarmed(auctionId);

    if (!isWarmed) {
      const result = await this.getLeaderboard(auctionId, limit, offset);
      return {
        entries: result.leaderboard.map((entry) => ({
          oduserId: "",
          amount: entry.amount,
          rank: entry.rank,
          username: entry.username,
          isBot: entry.isBot,
        })),
        totalCount: result.totalCount,
      };
    }

    const [topBidders, totalCount] = await Promise.all([
      this.bidCacheService.getTopBidders(auctionId, limit, offset),
      this.bidCacheService.getTotalBidders(auctionId),
    ]);

    const bidderUserIds = topBidders.map((b) => new Types.ObjectId(b.userId));
    const users = await this.userModel
      .find({ _id: { $in: bidderUserIds } })
      .select("username isBot")
      .lean();

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const entries = topBidders.map((bid, index) => {
      const user = userMap.get(bid.userId);
      return {
        oduserId: bid.userId,
        amount: bid.amount,
        rank: offset + index + 1,
        username: user?.username ?? "Unknown",
        isBot: user?.isBot ?? false,
      };
    });

    return { entries, totalCount };
  }

  private async withTransaction<T>(
    operation: (session: ClientSession) => Promise<T>,
    retries = maxRetries,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const session = await this.connection.startSession();

      try {
        session.startTransaction({
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        });

        const result = await operation(session);
        await session.commitTransaction();
        return result;
      } catch (error: unknown) {
        await session.abortTransaction();
        lastError = error instanceof Error ? error : new Error(String(error));

        if (isTransientTransactionError(error) && attempt < retries) {
          this.logger.warn("Transaction conflict, retrying", {
            attempt,
            retries,
          });
          const jitter = randomInt(retryDelayMs);
          await this.delay(retryDelayMs * attempt + jitter);
          continue;
        }

        throw error;
      } finally {
        await session.endSession();
      }
    }

    if (lastError !== null) {
      throw lastError;
    }
    throw new Error("Transaction failed after all retries");
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendAuctionCompleteNotifications(
    auctionId: string,
  ): Promise<void> {
    const auction = await this.auctionModel.findById(auctionId);
    if (auction === null) return;

    const allBids = await this.bidModel.find({ auctionId: auction._id });
    const userBids = new Map<string, { wins: number; totalSpent: number }>();

    for (const bid of allBids) {
      const bidUserId = bid.userId.toString();
      const existingData = userBids.get(bidUserId);
      if (existingData === undefined) {
        userBids.set(bidUserId, { wins: 0, totalSpent: 0 });
      }
      const userData = userBids.get(bidUserId);
      if (userData !== undefined && bid.status === BidStatus.WON) {
        userData.wins++;
        userData.totalSpent += bid.amount;
      }
    }

    for (const [participantId, { wins, totalSpent }] of userBids) {
      const user = await this.userModel.findById(participantId);
      if (user !== null && !user.isBot && user.telegramId !== undefined) {
        this.notificationsService
          .notifyAuctionComplete(participantId, {
            auctionId: auction._id.toString(),
            auctionTitle: auction.title,
            totalWins: wins,
            totalSpent,
          })
          .catch((err: unknown) =>
            this.logger.warn(
              "Failed to send auction complete notification",
              err,
            ),
          );
      }
    }
  }

  private async checkAntiSnipingUltraFast(
    auctionId: string,
    meta: {
      roundEndTime: number;
      antiSnipingWindowMs: number;
      antiSnipingExtensionMs: number;
      maxExtensions: number;
      currentRound: number;
    },
  ): Promise<void> {
    const now = Date.now();
    const windowStart = meta.roundEndTime - meta.antiSnipingWindowMs;

    if (now < windowStart || meta.antiSnipingExtensionMs <= 0) {
      return;
    }

    const auction = await this.auctionModel.findById(auctionId).lean();
    if (auction === null) return;

    const currentRound = auction.rounds[auction.currentRound - 1];
    if (
      currentRound === undefined ||
      currentRound.extensionsCount >= meta.maxExtensions
    ) {
      return;
    }

    const newEndTime = new Date(
      meta.roundEndTime + meta.antiSnipingExtensionMs,
    );

    const roundIndex = auction.currentRound - 1;
    const updated = await this.auctionModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(auctionId),
        status: AuctionStatus.ACTIVE,
        [`rounds.${String(roundIndex)}.extensionsCount`]:
          currentRound.extensionsCount,
      },
      {
        $set: { [`rounds.${String(roundIndex)}.endTime`]: newEndTime },
        $inc: { [`rounds.${String(roundIndex)}.extensionsCount`]: 1 },
      },
      { new: true },
    );

    if (updated !== null) {
      await this.bidCacheService.updateRoundEndTime(
        auctionId,
        newEndTime.getTime(),
      );

      this.eventsGateway.emitAntiSnipingExtension(
        updated,
        currentRound.extensionsCount + 1,
      );

      this.timerService.updateTimer(auctionId, newEndTime);
    }
  }

  private async checkOutbidNotificationsUltraFast(
    auctionId: string,
    meta: { itemsInRound: number },
    bidderId: string,
    newAmount: number,
  ): Promise<void> {
    const itemsInRound = meta.itemsInRound > 0 ? meta.itemsInRound : 1;

    const topBidders = await this.bidCacheService.getTopBidders(
      auctionId,
      itemsInRound + 1,
    );
    const outbidEntry = topBidders[itemsInRound];

    if (outbidEntry === undefined || outbidEntry.userId === bidderId) return;

    const bid = await this.bidModel
      .findOneAndUpdate(
        {
          auctionId: new Types.ObjectId(auctionId),
          userId: new Types.ObjectId(outbidEntry.userId),
          status: BidStatus.ACTIVE,
          outbidNotifiedAt: null,
        },
        { outbidNotifiedAt: new Date() },
        { new: true },
      )
      .populate<{ userId: UserDocument }>(
        "userId",
        "telegramId isBot languageCode",
      );

    if (bid === null) return;

    const bidUser = bid.userId;
    if (bidUser.isBot || bidUser.telegramId === undefined) {
      return;
    }

    const auction = await this.auctionModel
      .findById(auctionId)
      .select("title currentRound minBidIncrement")
      .lean();
    if (auction === null) return;

    this.notificationsService
      .notifyOutbid(outbidEntry.userId, {
        auctionId,
        auctionTitle: auction.title,
        yourBid: outbidEntry.amount,
        newLeaderBid: newAmount,
        roundNumber: auction.currentRound,
        minBidToWin: newAmount + auction.minBidIncrement,
      })
      .catch((err: unknown) =>
        this.logger.warn("Failed to send outbid notification", err),
      );
  }
}
