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

/**
 * Background service that syncs Redis cache to MongoDB
 *
 * Responsibilities:
 * 1. Periodic sync (every 5-10 seconds) during active auctions
 * 2. Full sync at round end before winner determination
 * 3. Full sync at auction end
 *
 * This allows the bid placement to be Redis-only (~1-2ms) while
 * ensuring durability through periodic MongoDB writes.
 */
@Injectable()
export class CacheSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheSyncService.name);
  private isRunning = false;
  private syncInProgress = new Set<string>(); // Track auctions being synced

  constructor(
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectConnection() private connection: Connection,
    private bidCacheService: BidCacheService,
  ) {
    this.isRunning = true;
  }

  onModuleDestroy() {
    this.isRunning = false;
  }

  /**
   * Periodic sync job - runs every 5 seconds
   * Syncs all dirty data from Redis to MongoDB
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async periodicSync(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Find all active auctions
      const activeAuctions = await this.auctionModel
        .find({ status: AuctionStatus.ACTIVE })
        .select("_id")
        .lean();

      for (const auction of activeAuctions) {
        const auctionId = auction._id.toString();

        // Skip if sync already in progress for this auction
        if (this.syncInProgress.has(auctionId)) {
          continue;
        }

        // Check if cache is warmed for this auction
        const isWarmed = await this.bidCacheService.isCacheWarmed(auctionId);
        if (!isWarmed) {
          continue;
        }

        // Run sync in background (don't await to allow parallel syncs)
        this.syncAuction(auctionId).catch((error) => {
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

  /**
   * Sync a specific auction's cache to MongoDB
   *
   * @param auctionId - The auction to sync
   * @param force - If true, sync even if another sync is in progress
   * @returns Number of records synced
   */
  async syncAuction(
    auctionId: string,
    force = false,
  ): Promise<{ balances: number; bids: number }> {
    // Prevent concurrent syncs for the same auction
    if (!force && this.syncInProgress.has(auctionId)) {
      this.logger.debug(`Sync already in progress for auction ${auctionId}`);
      return { balances: 0, bids: 0 };
    }

    this.syncInProgress.add(auctionId);
    const startTime = Date.now();

    try {
      // Get dirty data from Redis
      const syncData = await this.bidCacheService.getSyncData(auctionId);

      if (syncData.balances.size === 0 && syncData.bids.size === 0) {
        return { balances: 0, bids: 0 };
      }

      // Sync to MongoDB
      const result = await this.writeSyncData(auctionId, syncData);

      // Clear dirty flags only after successful sync
      await this.bidCacheService.clearDirtyFlags(auctionId);

      const duration = Date.now() - startTime;
      this.logger.debug(
        `Synced auction ${auctionId}: ${result.balances} balances, ${result.bids} bids in ${duration}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to sync auction ${auctionId}`, error);
      throw error;
    } finally {
      this.syncInProgress.delete(auctionId);
    }
  }

  /**
   * Full sync - ensures all cache data is written to MongoDB
   * Call this before critical operations like round completion
   */
  async fullSync(
    auctionId: string,
  ): Promise<{ balances: number; bids: number }> {
    this.logger.log(`Starting full sync for auction ${auctionId}`);

    // Wait for any in-progress sync to complete
    let retries = 0;
    while (this.syncInProgress.has(auctionId) && retries < 10) {
      await this.delay(100);
      retries++;
    }

    // Force sync
    return this.syncAuction(auctionId, true);
  }

  /**
   * Write sync data to MongoDB using bulk operations
   */
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

      // Sync balances using bulk write
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

      // Sync bids using bulk write
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

  /**
   * Sync and then clear cache for an auction (call at auction end)
   */
  async syncAndClearCache(auctionId: string): Promise<void> {
    // Full sync first
    await this.fullSync(auctionId);

    // Clear cache
    await this.bidCacheService.clearAuctionCache(auctionId);
    this.logger.log(`Cleared cache for auction ${auctionId}`);
  }

  /**
   * Check if sync is in progress for an auction
   */
  isSyncInProgress(auctionId: string): boolean {
    return this.syncInProgress.has(auctionId);
  }

  /**
   * Wait for sync to complete
   */
  async waitForSync(auctionId: string, timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();

    while (this.syncInProgress.has(auctionId)) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Sync timeout for auction ${auctionId}`);
      }
      await this.delay(50);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
