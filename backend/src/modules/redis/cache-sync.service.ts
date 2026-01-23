import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, Types } from "mongoose";
import { Cron, CronExpression } from "@nestjs/schedule";
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
import { BidCacheService, CacheSyncData } from "./bid-cache.service";

@Injectable()
export class CacheSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheSyncService.name);
  private isRunning = false;
  private readonly syncInProgress = new Set<string>();

  constructor(
    @InjectModel(Auction.name)
    private readonly auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name) private readonly bidModel: Model<BidDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly bidCacheService: BidCacheService,
  ) {
    this.isRunning = true;
  }

  public onModuleDestroy(): void {
    this.isRunning = false;
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  public async periodicSync(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const activeAuctions = await this.auctionModel
        .find({ status: AuctionStatus.ACTIVE })
        .select("_id")
        .lean();

      for (const auction of activeAuctions) {
        const auctionId = auction._id.toString();

        if (this.syncInProgress.has(auctionId)) {
          continue;
        }

        const isWarmed = await this.bidCacheService.isCacheWarmed(auctionId);
        if (!isWarmed) {
          continue;
        }

        this.syncAuction(auctionId).catch((error: unknown) => {
          this.logger.error(
            `Periodic sync failed for auction ${auctionId}`,
            error,
          );
        });
      }
    } catch (error) {
      this.logger.error("Periodic sync job failed", error);
    }
  }

  public async syncAuction(
    auctionId: string,
    force = false,
  ): Promise<{ balances: number; bids: number }> {
    if (!force && this.syncInProgress.has(auctionId)) {
      this.logger.debug(`Sync already in progress for auction ${auctionId}`);
      return { balances: 0, bids: 0 };
    }

    this.syncInProgress.add(auctionId);
    const startTime = Date.now();

    try {
      const syncData = await this.bidCacheService.getSyncData(auctionId);

      if (syncData.balances.size === 0 && syncData.bids.size === 0) {
        return { balances: 0, bids: 0 };
      }

      const result = await this.writeSyncData(auctionId, syncData);
      await this.bidCacheService.clearDirtyFlags(auctionId);

      const duration = Date.now() - startTime;
      this.logger.debug(
        `Synced auction ${auctionId}: ${String(result.balances)} balances, ${String(result.bids)} bids in ${String(duration)}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to sync auction ${auctionId}`, error);
      throw error;
    } finally {
      this.syncInProgress.delete(auctionId);
    }
  }

  public async fullSync(
    auctionId: string,
  ): Promise<{ balances: number; bids: number }> {
    this.logger.log(`Starting full sync for auction ${auctionId}`);

    let retries = 0;
    while (this.syncInProgress.has(auctionId) && retries < 10) {
      await this.delay(100);
      retries++;
    }

    return await this.syncAuction(auctionId, true);
  }

  public async syncAndClearCache(auctionId: string): Promise<void> {
    await this.fullSync(auctionId);
    await this.bidCacheService.clearAuctionCache(auctionId);
    this.logger.log(`Cleared cache for auction ${auctionId}`);
  }

  public isSyncInProgress(auctionId: string): boolean {
    return this.syncInProgress.has(auctionId);
  }

  public async waitForSync(auctionId: string, timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();

    while (this.syncInProgress.has(auctionId)) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Sync timeout for auction ${auctionId}`);
      }
      await this.delay(50);
    }
  }

  private async writeSyncData(
    auctionId: string,
    data: CacheSyncData,
  ): Promise<{ balances: number; bids: number }> {
    const session = await this.connection.startSession();

    try {
      session.startTransaction({
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });

      let balanceCount = 0;
      let bidCount = 0;

      if (data.balances.size > 0) {
        const balanceOps = Array.from(data.balances.entries()).map(
          ([userId, balance]) => ({
            updateOne: {
              filter: { _id: new Types.ObjectId(userId) },
              update: {
                $set: {
                  balance: balance.available,
                  frozenBalance: balance.frozen,
                },
              },
            },
          }),
        );

        const balanceResult = await this.userModel.bulkWrite(balanceOps, {
          session,
        });
        balanceCount = balanceResult.modifiedCount;
      }

      if (data.bids.size > 0) {
        const auctionObjectId = new Types.ObjectId(auctionId);

        const bidOps = Array.from(data.bids.entries()).map(([userId, bid]) => ({
          updateOne: {
            filter: {
              auctionId: auctionObjectId,
              userId: new Types.ObjectId(userId),
              status: BidStatus.ACTIVE,
            },
            update: {
              $set: {
                amount: bid.amount,
                lastProcessedAt: new Date(),
              },
              $setOnInsert: {
                auctionId: auctionObjectId,
                userId: new Types.ObjectId(userId),
                status: BidStatus.ACTIVE,
                createdAt: new Date(bid.createdAt),
              },
            },
            upsert: true,
          },
        }));

        const bidResult = await this.bidModel.bulkWrite(bidOps, { session });
        bidCount = bidResult.modifiedCount + bidResult.upsertedCount;
      }

      await session.commitTransaction();
      return { balances: balanceCount, bids: bidCount };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
