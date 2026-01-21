import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { redisClient } from "./constants";

/**
 * High-performance Redis-based bid caching system
 *
 * Achieves ~3,000 rps × number of CPUs by:
 * 1. Using Lua scripts for atomic operations (single round-trip)
 * 2. Storing balances and bids in Redis during active auction
 * 3. Syncing to MongoDB periodically (background) and at round end
 *
 * Redis Key Structure:
 * - auction:{auctionId}:balance:{userId} → HASH {available, frozen}
 * - auction:{auctionId}:bid:{userId} → HASH {amount, createdAt, version}
 * - auction:{auctionId}:dirty-users → SET of userIds with changes
 * - auction:{auctionId}:dirty-bids → SET of userIds with bid changes
 * - leaderboard:{auctionId} → ZSET (existing, from LeaderboardService)
 * - auction:{auctionId}:meta → HASH {minBid, status, currentRound, roundEndTime}
 */

// Score encoding for leaderboard (same as LeaderboardService)
const maxTimestamp = 9999999999999;
const timestampMultiplier = 1e13;

export interface CachedBalance {
  available: number;
  frozen: number;
}

export interface CachedBid {
  amount: number;
  createdAt: number; // timestamp in ms
  version: number;
}

export interface PlaceBidResult {
  success: boolean;
  error?: string;
  newAmount?: number;
  previousAmount?: number;
  frozenDelta?: number;
  isNewBid?: boolean;
  rank?: number;
}

/**
 * Ultra-fast bid result with all meta fields included
 * Eliminates need for separate getAuctionMeta call
 */
export interface UltraFastBidResult extends PlaceBidResult {
  needsWarmup?: boolean;
  roundEndTime?: number;
  antiSnipingWindowMs?: number;
  antiSnipingExtensionMs?: number;
  maxExtensions?: number;
  itemsInRound?: number;
  currentRound?: number;
}

export interface CacheSyncData {
  balances: Map<string, CachedBalance>;
  bids: Map<string, CachedBid>;
}

@Injectable()
export class BidCacheService implements OnModuleInit {
  private readonly logger = new Logger(BidCacheService.name);

  // Lua script SHA hashes (loaded on init)
  private placeBidSha: string = "";
  private placeBidUltraFastSha: string = "";
  private getBidInfoSha: string = "";
  private getBalanceSha: string = "";

  /**
   * Lua script for atomic bid placement
   *
   * KEYS[1] = balance key (auction:{auctionId}:balance:{userId})
   * KEYS[2] = bid key (auction:{auctionId}:bid:{userId})
   * KEYS[3] = leaderboard key (leaderboard:{auctionId})
   * KEYS[4] = meta key (auction:{auctionId}:meta)
   * KEYS[5] = dirty-users set (auction:{auctionId}:dirty-users)
   * KEYS[6] = dirty-bids set (auction:{auctionId}:dirty-bids)
   *
   * ARGV[1] = userId
   * ARGV[2] = requested amount
   * ARGV[3] = current timestamp (ms)
   * ARGV[4] = minBidAmount
   *
   * Returns: [success(0/1), errorCode, newAmount, previousAmount, frozenDelta, isNewBid(0/1), rank]
   */
  private readonly PLACE_BID_SCRIPT = `
    local balanceKey = KEYS[1]
    local bidKey = KEYS[2]
    local leaderboardKey = KEYS[3]
    local metaKey = KEYS[4]
    local dirtyUsersKey = KEYS[5]
    local dirtyBidsKey = KEYS[6]

    local userId = ARGV[1]
    local requestedAmount = tonumber(ARGV[2])
    local timestamp = tonumber(ARGV[3])
    local minBidAmount = tonumber(ARGV[4])

    -- Validate minimum bid
    if requestedAmount < minBidAmount then
      return {0, "MIN_BID", 0, 0, 0, 0, -1}
    end

    -- Get current balance
    local available = tonumber(redis.call('HGET', balanceKey, 'available') or '0')
    local frozen = tonumber(redis.call('HGET', balanceKey, 'frozen') or '0')

    -- Get current bid if exists
    local currentAmount = tonumber(redis.call('HGET', bidKey, 'amount') or '0')
    local currentCreatedAt = tonumber(redis.call('HGET', bidKey, 'createdAt') or '0')
    local isNewBid = currentAmount == 0 and 1 or 0

    -- Cannot lower bid
    if requestedAmount <= currentAmount then
      return {0, "BID_TOO_LOW", currentAmount, currentAmount, 0, 0, -1}
    end

    -- Calculate additional funds needed
    local additionalNeeded = requestedAmount - currentAmount

    -- Check sufficient balance
    if available < additionalNeeded then
      return {0, "INSUFFICIENT_BALANCE", currentAmount, currentAmount, 0, 0, -1}
    end

    -- Use original createdAt for existing bids (preserves timestamp priority)
    local bidTimestamp = isNewBid == 1 and timestamp or currentCreatedAt

    -- Atomic updates
    redis.call('HINCRBY', balanceKey, 'available', -additionalNeeded)
    redis.call('HINCRBY', balanceKey, 'frozen', additionalNeeded)
    redis.call('HSET', bidKey, 'amount', requestedAmount)
    redis.call('HSET', bidKey, 'createdAt', bidTimestamp)
    redis.call('HINCRBY', bidKey, 'version', 1)

    -- Mark as dirty for sync
    redis.call('SADD', dirtyUsersKey, userId)
    redis.call('SADD', dirtyBidsKey, userId)

    -- Update leaderboard with encoded score
    -- Higher amount = higher score, earlier timestamp = higher score (for ties)
    local invertedTimestamp = 9999999999999 - bidTimestamp
    local score = requestedAmount * 10000000000000 + invertedTimestamp
    redis.call('ZADD', leaderboardKey, score, userId)

    -- Get new rank (0-indexed, so add 1 for 1-indexed)
    local rank = redis.call('ZREVRANK', leaderboardKey, userId)

    return {1, "OK", requestedAmount, currentAmount, additionalNeeded, isNewBid, rank}
  `;

  /**
   * Ultra-fast Lua script that includes ALL validation (no separate checks needed)
   *
   * KEYS[1] = balance key
   * KEYS[2] = bid key
   * KEYS[3] = leaderboard key
   * KEYS[4] = meta key
   * KEYS[5] = dirty-users set
   * KEYS[6] = dirty-bids set
   *
   * ARGV[1] = userId
   * ARGV[2] = requested amount
   * ARGV[3] = current timestamp (ms)
   *
   * Returns: [success(0/1), errorCode, newAmount, previousAmount, frozenDelta, isNewBid(0/1), rank,
   *           roundEndTime, antiSnipingWindowMs, antiSnipingExtensionMs, maxExtensions, itemsInRound, currentRound]
   */
  private readonly PLACE_BID_ULTRA_FAST_SCRIPT = `
    local balanceKey = KEYS[1]
    local bidKey = KEYS[2]
    local leaderboardKey = KEYS[3]
    local metaKey = KEYS[4]
    local dirtyUsersKey = KEYS[5]
    local dirtyBidsKey = KEYS[6]

    local userId = ARGV[1]
    local requestedAmount = tonumber(ARGV[2])
    local timestamp = tonumber(ARGV[3])

    -- Get all auction meta at once (single HGETALL is faster than multiple HGET)
    local meta = redis.call('HGETALL', metaKey)
    if #meta == 0 then
      return {0, "NOT_WARMED", 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0}
    end

    -- Parse meta into table
    local metaMap = {}
    for i = 1, #meta, 2 do
      metaMap[meta[i]] = meta[i + 1]
    end

    local status = metaMap['status']
    if status ~= 'active' then
      return {0, "NOT_ACTIVE", 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0}
    end

    local roundEndTime = tonumber(metaMap['roundEndTime'] or '0')
    local minBidAmount = tonumber(metaMap['minBidAmount'] or '0')
    local antiSnipingWindowMs = tonumber(metaMap['antiSnipingWindowMs'] or '0')
    local antiSnipingExtensionMs = tonumber(metaMap['antiSnipingExtensionMs'] or '0')
    local maxExtensions = tonumber(metaMap['maxExtensions'] or '0')
    local itemsInRound = tonumber(metaMap['itemsInRound'] or '1')
    local currentRound = tonumber(metaMap['currentRound'] or '1')

    -- Check round timing (100ms buffer)
    if timestamp > roundEndTime - 100 then
      return {0, "ROUND_ENDED", 0, 0, 0, 0, -1, roundEndTime, antiSnipingWindowMs, antiSnipingExtensionMs, maxExtensions, itemsInRound, currentRound}
    end

    -- Validate minimum bid
    if requestedAmount < minBidAmount then
      return {0, "MIN_BID", 0, 0, 0, 0, -1, roundEndTime, antiSnipingWindowMs, antiSnipingExtensionMs, maxExtensions, itemsInRound, currentRound}
    end

    -- Get current balance
    local available = tonumber(redis.call('HGET', balanceKey, 'available') or '0')
    local frozen = tonumber(redis.call('HGET', balanceKey, 'frozen') or '0')

    -- If user has no balance at all, they're not warmed up
    if available == 0 and frozen == 0 then
      return {0, "USER_NOT_WARMED", 0, 0, 0, 0, -1, roundEndTime, antiSnipingWindowMs, antiSnipingExtensionMs, maxExtensions, itemsInRound, currentRound}
    end

    -- Get current bid if exists
    local currentAmount = tonumber(redis.call('HGET', bidKey, 'amount') or '0')
    local currentCreatedAt = tonumber(redis.call('HGET', bidKey, 'createdAt') or '0')
    local isNewBid = currentAmount == 0 and 1 or 0

    -- Cannot lower bid
    if requestedAmount <= currentAmount then
      return {0, "BID_TOO_LOW", currentAmount, currentAmount, 0, 0, -1, roundEndTime, antiSnipingWindowMs, antiSnipingExtensionMs, maxExtensions, itemsInRound, currentRound}
    end

    -- Calculate additional funds needed
    local additionalNeeded = requestedAmount - currentAmount

    -- Check sufficient balance
    if available < additionalNeeded then
      return {0, "INSUFFICIENT_BALANCE", currentAmount, currentAmount, 0, 0, -1, roundEndTime, antiSnipingWindowMs, antiSnipingExtensionMs, maxExtensions, itemsInRound, currentRound}
    end

    -- Use original createdAt for existing bids
    local bidTimestamp = isNewBid == 1 and timestamp or currentCreatedAt

    -- Atomic updates
    redis.call('HINCRBY', balanceKey, 'available', -additionalNeeded)
    redis.call('HINCRBY', balanceKey, 'frozen', additionalNeeded)
    redis.call('HSET', bidKey, 'amount', requestedAmount)
    redis.call('HSET', bidKey, 'createdAt', bidTimestamp)
    redis.call('HINCRBY', bidKey, 'version', 1)

    -- Mark as dirty
    redis.call('SADD', dirtyUsersKey, userId)
    redis.call('SADD', dirtyBidsKey, userId)

    -- Update leaderboard
    local invertedTimestamp = 9999999999999 - bidTimestamp
    local score = requestedAmount * 10000000000000 + invertedTimestamp
    redis.call('ZADD', leaderboardKey, score, userId)

    -- Get rank (skip for ultra-fast mode, can be fetched separately if needed)
    -- local rank = redis.call('ZREVRANK', leaderboardKey, userId)
    local rank = -1

    return {1, "OK", requestedAmount, currentAmount, additionalNeeded, isNewBid, rank, roundEndTime, antiSnipingWindowMs, antiSnipingExtensionMs, maxExtensions, itemsInRound, currentRound}
  `;

  /**
   * Lua script to get bid info with rank
   */
  private readonly GET_BID_INFO_SCRIPT = `
    local bidKey = KEYS[1]
    local leaderboardKey = KEYS[2]
    local userId = ARGV[1]

    local amount = tonumber(redis.call('HGET', bidKey, 'amount') or '0')
    local createdAt = tonumber(redis.call('HGET', bidKey, 'createdAt') or '0')
    local rank = redis.call('ZREVRANK', leaderboardKey, userId)

    if rank == false then
      rank = -1
    end

    return {amount, createdAt, rank}
  `;

  /**
   * Lua script to get balance
   */
  private readonly GET_BALANCE_SCRIPT = `
    local balanceKey = KEYS[1]
    local available = tonumber(redis.call('HGET', balanceKey, 'available') or '0')
    local frozen = tonumber(redis.call('HGET', balanceKey, 'frozen') or '0')
    return {available, frozen}
  `;

  constructor(@Inject(redisClient) private readonly redis: Redis) {}

  async onModuleInit() {
    // Pre-load Lua scripts for better performance
    try {
      this.placeBidSha = (await this.redis.script(
        "LOAD",
        this.PLACE_BID_SCRIPT,
      )) as string;
      this.placeBidUltraFastSha = (await this.redis.script(
        "LOAD",
        this.PLACE_BID_ULTRA_FAST_SCRIPT,
      )) as string;
      this.getBidInfoSha = (await this.redis.script(
        "LOAD",
        this.GET_BID_INFO_SCRIPT,
      )) as string;
      this.getBalanceSha = (await this.redis.script(
        "LOAD",
        this.GET_BALANCE_SCRIPT,
      )) as string;
      this.logger.log("Lua scripts loaded successfully (4 scripts)");
    } catch (error) {
      // In test environments with mocked Redis (ioredis-mock), script() may not be supported
      // This is expected and not an error - tests won't use evalsha
      if (error instanceof Error && error.message?.includes("Unsupported command")) {
        this.logger.warn(
          "Redis script() command not supported (likely using mocked Redis in tests)",
        );
      } else {
        this.logger.error("Failed to load Lua scripts", error);
        throw error;
      }
    }
  }

  // ==================== Key Generators ====================

  private balanceKey(auctionId: string, userId: string): string {
    return `auction:${auctionId}:balance:${userId}`;
  }

  private bidKey(auctionId: string, userId: string): string {
    return `auction:${auctionId}:bid:${userId}`;
  }

  private leaderboardKey(auctionId: string): string {
    return `leaderboard:${auctionId}`;
  }

  private metaKey(auctionId: string): string {
    return `auction:${auctionId}:meta`;
  }

  private dirtyUsersKey(auctionId: string): string {
    return `auction:${auctionId}:dirty-users`;
  }

  private dirtyBidsKey(auctionId: string): string {
    return `auction:${auctionId}:dirty-bids`;
  }

  private auctionKeysPattern(auctionId: string): string {
    return `auction:${auctionId}:*`;
  }

  // ==================== Cache Warmup ====================

  /**
   * Initialize cache for an auction with all participant balances
   * Call this when auction starts or when a user joins
   */
  async warmupUserBalance(
    auctionId: string,
    userId: string,
    available: number,
    frozen: number,
  ): Promise<void> {
    const key = this.balanceKey(auctionId, userId);
    await this.redis.hset(key, "available", available, "frozen", frozen);
  }

  /**
   * Batch warmup for multiple users
   */
  async warmupBalances(
    auctionId: string,
    users: Array<{ id: string; balance: number; frozenBalance: number }>,
  ): Promise<void> {
    if (users.length === 0) return;

    const pipeline = this.redis.pipeline();

    for (const user of users) {
      const key = this.balanceKey(auctionId, user.id);
      pipeline.hset(
        key,
        "available",
        user.balance,
        "frozen",
        user.frozenBalance,
      );
    }

    await pipeline.exec();
    this.logger.debug(
      `Warmed up ${users.length} user balances for auction ${auctionId}`,
    );
  }

  /**
   * Warmup existing bids for an auction
   */
  async warmupBids(
    auctionId: string,
    bids: Array<{
      userId: string;
      amount: number;
      createdAt: Date;
    }>,
  ): Promise<void> {
    if (bids.length === 0) return;

    const pipeline = this.redis.pipeline();
    const leaderboardKey = this.leaderboardKey(auctionId);

    // Clear existing leaderboard
    pipeline.del(leaderboardKey);

    for (const bid of bids) {
      const bidKeyStr = this.bidKey(auctionId, bid.userId);
      const timestamp = bid.createdAt.getTime();

      pipeline.hset(
        bidKeyStr,
        "amount",
        bid.amount,
        "createdAt",
        timestamp,
        "version",
        0,
      );

      // Add to leaderboard with encoded score
      const invertedTimestamp = maxTimestamp - timestamp;
      const score = bid.amount * timestampMultiplier + invertedTimestamp;
      pipeline.zadd(leaderboardKey, score, bid.userId);
    }

    await pipeline.exec();
    this.logger.debug(`Warmed up ${bids.length} bids for auction ${auctionId}`);
  }

  /**
   * Set auction metadata (call on auction start and round changes)
   */
  async setAuctionMeta(
    auctionId: string,
    meta: {
      minBidAmount: number;
      status: string;
      currentRound: number;
      roundEndTime?: number;
      itemsInRound?: number;
      antiSnipingWindowMs?: number;
      antiSnipingExtensionMs?: number;
      maxExtensions?: number;
    },
  ): Promise<void> {
    const key = this.metaKey(auctionId);
    await this.redis.hset(
      key,
      "minBidAmount",
      meta.minBidAmount,
      "status",
      meta.status,
      "currentRound",
      meta.currentRound,
      "roundEndTime",
      meta.roundEndTime || 0,
      "itemsInRound",
      meta.itemsInRound || 0,
      "antiSnipingWindowMs",
      meta.antiSnipingWindowMs || 0,
      "antiSnipingExtensionMs",
      meta.antiSnipingExtensionMs || 0,
      "maxExtensions",
      meta.maxExtensions || 0,
      "warmedAt",
      Date.now(),
    );
  }

  /**
   * Get cached auction metadata (avoids MongoDB query)
   * Returns null if cache not warmed
   */
  async getAuctionMeta(auctionId: string): Promise<{
    minBidAmount: number;
    status: string;
    currentRound: number;
    roundEndTime: number;
    itemsInRound: number;
    antiSnipingWindowMs: number;
    antiSnipingExtensionMs: number;
    maxExtensions: number;
  } | null> {
    const key = this.metaKey(auctionId);
    const data = await this.redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      minBidAmount: parseInt(data.minBidAmount || "0", 10),
      status: data.status || "unknown",
      currentRound: parseInt(data.currentRound || "0", 10),
      roundEndTime: parseInt(data.roundEndTime || "0", 10),
      itemsInRound: parseInt(data.itemsInRound || "0", 10),
      antiSnipingWindowMs: parseInt(data.antiSnipingWindowMs || "0", 10),
      antiSnipingExtensionMs: parseInt(data.antiSnipingExtensionMs || "0", 10),
      maxExtensions: parseInt(data.maxExtensions || "0", 10),
    };
  }

  /**
   * Update round end time (for anti-sniping extensions)
   */
  async updateRoundEndTime(
    auctionId: string,
    newEndTime: number,
  ): Promise<void> {
    const key = this.metaKey(auctionId);
    await this.redis.hset(key, "roundEndTime", newEndTime);
  }

  // ==================== Core Bid Operations ====================

  /**
   * Place a bid using Lua script (atomic, ~1-2ms)
   *
   * @returns PlaceBidResult with success status and details
   */
  async placeBid(
    auctionId: string,
    userId: string,
    amount: number,
    minBidAmount: number,
  ): Promise<PlaceBidResult> {
    const timestamp = Date.now();

    try {
      const result = (await this.redis.evalsha(
        this.placeBidSha,
        6, // number of keys
        this.balanceKey(auctionId, userId),
        this.bidKey(auctionId, userId),
        this.leaderboardKey(auctionId),
        this.metaKey(auctionId),
        this.dirtyUsersKey(auctionId),
        this.dirtyBidsKey(auctionId),
        userId,
        amount,
        timestamp,
        minBidAmount,
      )) as number[];

      const [
        success,
        errorOrOk,
        newAmount,
        previousAmount,
        frozenDelta,
        isNewBid,
        rank,
      ] = result;
      const rankNum = rank ?? -1;

      if (success === 1) {
        return {
          success: true,
          newAmount,
          previousAmount,
          frozenDelta,
          isNewBid: isNewBid === 1,
          rank: rankNum >= 0 ? rankNum : undefined,
        };
      }

      // Map error codes to messages
      const errorMessages: Record<string, string> = {
        MIN_BID: `Minimum bid is ${minBidAmount}`,
        BID_TOO_LOW: "Bid must be higher than current bid",
        INSUFFICIENT_BALANCE: "Insufficient balance",
      };

      return {
        success: false,
        error: errorMessages[String(errorOrOk)] || "Unknown error",
        previousAmount,
      };
    } catch (error) {
      // Script not loaded, reload and retry
      if ((error as Error).message?.includes("NOSCRIPT")) {
        this.logger.warn("Lua script not found, reloading...");
        await this.onModuleInit();
        return this.placeBid(auctionId, userId, amount, minBidAmount);
      }
      throw error;
    }
  }

  /**
   * Ultra-fast bid placement - single Redis call does ALL validation
   * No separate cache check, no MongoDB query, no balance check
   * Target: <1ms latency
   *
   * Error codes returned:
   * - NOT_WARMED: Cache not initialized for this auction
   * - NOT_ACTIVE: Auction is not in active status
   * - ROUND_ENDED: Round has ended or is about to end
   * - USER_NOT_WARMED: User balance not in cache (need to warm up)
   * - MIN_BID: Amount below minimum
   * - BID_TOO_LOW: Amount not higher than current bid
   * - INSUFFICIENT_BALANCE: Not enough available balance
   *
   * Returns all auction meta fields to eliminate separate getAuctionMeta call
   */
  async placeBidUltraFast(
    auctionId: string,
    userId: string,
    amount: number,
  ): Promise<UltraFastBidResult> {
    const timestamp = Date.now();

    try {
      const result = (await this.redis.evalsha(
        this.placeBidUltraFastSha,
        6, // number of keys
        this.balanceKey(auctionId, userId),
        this.bidKey(auctionId, userId),
        this.leaderboardKey(auctionId),
        this.metaKey(auctionId),
        this.dirtyUsersKey(auctionId),
        this.dirtyBidsKey(auctionId),
        userId,
        amount,
        timestamp,
      )) as (number | string)[];

      const [
        success,
        errorOrOk,
        newAmount,
        previousAmount,
        frozenDelta,
        isNewBid,
        _rank,
        roundEndTime,
        antiSnipingWindowMs,
        antiSnipingExtensionMs,
        maxExtensions,
        itemsInRound,
        currentRound,
      ] = result;

      if (success === 1) {
        return {
          success: true,
          newAmount: newAmount as number,
          previousAmount: previousAmount as number,
          frozenDelta: frozenDelta as number,
          isNewBid: isNewBid === 1,
          rank: undefined, // Skipped for ultra-fast mode
          roundEndTime: roundEndTime as number,
          antiSnipingWindowMs: antiSnipingWindowMs as number,
          antiSnipingExtensionMs: antiSnipingExtensionMs as number,
          maxExtensions: maxExtensions as number,
          itemsInRound: itemsInRound as number,
          currentRound: currentRound as number,
        };
      }

      // Map error codes
      const errorCode = String(errorOrOk);
      const errorMessages: Record<string, string> = {
        NOT_WARMED: "Cache not warmed",
        NOT_ACTIVE: "Auction is not active",
        ROUND_ENDED: "Round has ended or is about to end",
        USER_NOT_WARMED: "User not in cache",
        MIN_BID: "Amount below minimum bid",
        BID_TOO_LOW: "Bid must be higher than current bid",
        INSUFFICIENT_BALANCE: "Insufficient balance",
      };

      return {
        success: false,
        error: errorMessages[errorCode] || `Unknown error: ${errorCode}`,
        previousAmount: previousAmount as number,
        needsWarmup:
          errorCode === "NOT_WARMED" || errorCode === "USER_NOT_WARMED",
        roundEndTime: roundEndTime as number,
        antiSnipingWindowMs: antiSnipingWindowMs as number,
        antiSnipingExtensionMs: antiSnipingExtensionMs as number,
        maxExtensions: maxExtensions as number,
        itemsInRound: itemsInRound as number,
        currentRound: currentRound as number,
      };
    } catch (error) {
      if ((error as Error).message?.includes("NOSCRIPT")) {
        this.logger.warn("Lua script not found, reloading...");
        await this.onModuleInit();
        return this.placeBidUltraFast(auctionId, userId, amount);
      }
      throw error;
    }
  }

  /**
   * Get user's bid info with rank
   */
  async getBidInfo(
    auctionId: string,
    userId: string,
  ): Promise<{ amount: number; createdAt: Date | null; rank: number | null }> {
    try {
      const result = (await this.redis.evalsha(
        this.getBidInfoSha,
        2,
        this.bidKey(auctionId, userId),
        this.leaderboardKey(auctionId),
        userId,
      )) as number[];

      const amount = result[0] ?? 0;
      const createdAt = result[1] ?? 0;
      const rank = result[2] ?? -1;

      return {
        amount,
        createdAt: createdAt > 0 ? new Date(createdAt) : null,
        rank: rank >= 0 ? rank : null,
      };
    } catch (error) {
      if ((error as Error).message?.includes("NOSCRIPT")) {
        await this.onModuleInit();
        return this.getBidInfo(auctionId, userId);
      }
      throw error;
    }
  }

  /**
   * Get user's cached balance for an auction
   */
  async getBalance(auctionId: string, userId: string): Promise<CachedBalance> {
    try {
      const result = (await this.redis.evalsha(
        this.getBalanceSha,
        1,
        this.balanceKey(auctionId, userId),
      )) as number[];

      return {
        available: result[0] || 0,
        frozen: result[1] || 0,
      };
    } catch (error) {
      if ((error as Error).message?.includes("NOSCRIPT")) {
        await this.onModuleInit();
        return this.getBalance(auctionId, userId);
      }
      throw error;
    }
  }

  // ==================== Sync Operations ====================

  /**
   * Get all dirty (modified) user IDs for sync
   */
  async getDirtyUserIds(auctionId: string): Promise<string[]> {
    return this.redis.smembers(this.dirtyUsersKey(auctionId));
  }

  /**
   * Get all dirty bid user IDs for sync
   */
  async getDirtyBidUserIds(auctionId: string): Promise<string[]> {
    return this.redis.smembers(this.dirtyBidsKey(auctionId));
  }

  /**
   * Get all cached data for sync to MongoDB
   */
  async getSyncData(auctionId: string): Promise<CacheSyncData> {
    const dirtyUsers = await this.getDirtyUserIds(auctionId);
    const dirtyBids = await this.getDirtyBidUserIds(auctionId);

    const balances = new Map<string, CachedBalance>();
    const bids = new Map<string, CachedBid>();

    // Fetch balances
    if (dirtyUsers.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const userId of dirtyUsers) {
        pipeline.hgetall(this.balanceKey(auctionId, userId));
      }
      const results = await pipeline.exec();

      for (let i = 0; i < dirtyUsers.length; i++) {
        const userId = dirtyUsers[i];
        const result = results?.[i]?.[1] as Record<string, string> | null;
        if (result && userId) {
          balances.set(userId, {
            available: parseInt(result.available || "0", 10),
            frozen: parseInt(result.frozen || "0", 10),
          });
        }
      }
    }

    // Fetch bids
    if (dirtyBids.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const userId of dirtyBids) {
        pipeline.hgetall(this.bidKey(auctionId, userId));
      }
      const results = await pipeline.exec();

      for (let i = 0; i < dirtyBids.length; i++) {
        const userId = dirtyBids[i];
        const result = results?.[i]?.[1] as Record<string, string> | null;
        if (result && result.amount && userId) {
          bids.set(userId, {
            amount: parseInt(result.amount, 10),
            createdAt: parseInt(result.createdAt || "0", 10),
            version: parseInt(result.version || "0", 10),
          });
        }
      }
    }

    return { balances, bids };
  }

  /**
   * Clear dirty flags after successful sync
   */
  async clearDirtyFlags(auctionId: string): Promise<void> {
    await this.redis.del(
      this.dirtyUsersKey(auctionId),
      this.dirtyBidsKey(auctionId),
    );
  }

  /**
   * Clear specific dirty users after partial sync
   */
  async clearDirtyUsers(auctionId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.srem(this.dirtyUsersKey(auctionId), ...userIds);
  }

  /**
   * Clear specific dirty bids after partial sync
   */
  async clearDirtyBids(auctionId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.srem(this.dirtyBidsKey(auctionId), ...userIds);
  }

  // ==================== Leaderboard Operations ====================

  /**
   * Get top N from leaderboard (delegates to existing LeaderboardService pattern)
   */
  async getTopBidders(
    auctionId: string,
    count: number,
    offset: number = 0,
  ): Promise<
    Array<{
      userId: string;
      amount: number;
      createdAt: Date;
    }>
  > {
    const key = this.leaderboardKey(auctionId);
    const results = await this.redis.zrevrange(
      key,
      offset,
      offset + count - 1,
      "WITHSCORES",
    );

    const entries: Array<{ userId: string; amount: number; createdAt: Date }> =
      [];

    for (let i = 0; i < results.length; i += 2) {
      const userId = results[i];
      const score = parseFloat(results[i + 1] || "0");

      if (!userId) continue;

      const amount = Math.floor(score / timestampMultiplier);
      const invertedTimestamp = score % timestampMultiplier;
      const timestamp = maxTimestamp - invertedTimestamp;

      entries.push({
        userId,
        amount,
        createdAt: new Date(timestamp),
      });
    }

    return entries;
  }

  /**
   * Get total number of bidders
   */
  async getTotalBidders(auctionId: string): Promise<number> {
    return this.redis.zcard(this.leaderboardKey(auctionId));
  }

  /**
   * Remove users from leaderboard (e.g., after winning)
   */
  async removeFromLeaderboard(
    auctionId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.zrem(this.leaderboardKey(auctionId), ...userIds);
  }

  // ==================== Cleanup ====================

  /**
   * Clear all cache data for an auction
   */
  async clearAuctionCache(auctionId: string): Promise<void> {
    const pattern = this.auctionKeysPattern(auctionId);
    const leaderboardKey = this.leaderboardKey(auctionId);

    let cursor = "0";
    const keysToDelete: string[] = [leaderboardKey];

    do {
      const [newCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        1000,
      );
      cursor = newCursor;
      keysToDelete.push(...keys);
    } while (cursor !== "0");

    if (keysToDelete.length > 0) {
      // Delete in batches to avoid blocking
      const batchSize = 1000;
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        await this.redis.del(...batch);
      }
    }

    this.logger.debug(
      `Cleared ${keysToDelete.length} keys for auction ${auctionId}`,
    );
  }

  /**
   * Check if auction cache is warmed up
   */
  async isCacheWarmed(auctionId: string): Promise<boolean> {
    const metaKey = this.metaKey(auctionId);
    const exists = await this.redis.exists(metaKey);
    return exists === 1;
  }
}
