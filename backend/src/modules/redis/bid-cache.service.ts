import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { redisClient } from "./constants";

// Score encoding for leaderboard
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

  private placeBidSha = "";
  private placeBidUltraFastSha = "";
  private getBidInfoSha = "";
  private getBalanceSha = "";

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

  private readonly GET_BALANCE_SCRIPT = `
    local balanceKey = KEYS[1]
    local available = tonumber(redis.call('HGET', balanceKey, 'available') or '0')
    local frozen = tonumber(redis.call('HGET', balanceKey, 'frozen') or '0')
    return {available, frozen}
  `;

  constructor(@Inject(redisClient) private readonly redis: Redis) {}

  public async onModuleInit(): Promise<void> {
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.includes("Unsupported command") ||
        errorMsg.includes("script")
      ) {
        this.logger.debug(
          "Lua script preloading skipped (using mocked Redis or script command not available)",
        );
      } else {
        this.logger.error("Failed to load Lua scripts", error);
        throw error;
      }
    }
  }

  public async warmupUserBalance(
    auctionId: string,
    userId: string,
    available: number,
    frozen: number,
  ): Promise<void> {
    const key = this.balanceKey(auctionId, userId);
    await this.redis.hset(key, "available", available, "frozen", frozen);
  }

  public async warmupBalances(
    auctionId: string,
    users: { id: string; balance: number; frozenBalance: number }[],
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
      `Warmed up ${String(users.length)} user balances for auction ${auctionId}`,
    );
  }

  public async warmupBids(
    auctionId: string,
    bids: {
      userId: string;
      amount: number;
      createdAt: Date;
    }[],
  ): Promise<void> {
    if (bids.length === 0) return;

    const pipeline = this.redis.pipeline();
    const leaderboardKeyStr = this.leaderboardKey(auctionId);

    pipeline.del(leaderboardKeyStr);

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

      const invertedTimestamp = maxTimestamp - timestamp;
      const score = bid.amount * timestampMultiplier + invertedTimestamp;
      pipeline.zadd(leaderboardKeyStr, score, bid.userId);
    }

    await pipeline.exec();
    this.logger.debug(
      `Warmed up ${String(bids.length)} bids for auction ${auctionId}`,
    );
  }

  public async setAuctionMeta(
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
      meta.roundEndTime ?? 0,
      "itemsInRound",
      meta.itemsInRound ?? 0,
      "antiSnipingWindowMs",
      meta.antiSnipingWindowMs ?? 0,
      "antiSnipingExtensionMs",
      meta.antiSnipingExtensionMs ?? 0,
      "maxExtensions",
      meta.maxExtensions ?? 0,
      "warmedAt",
      Date.now(),
    );
  }

  public async getAuctionMeta(auctionId: string): Promise<{
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

    if (Object.keys(data).length === 0) {
      return null;
    }

    return {
      minBidAmount: parseInt(data.minBidAmount ?? "0", 10),
      status: data.status ?? "unknown",
      currentRound: parseInt(data.currentRound ?? "0", 10),
      roundEndTime: parseInt(data.roundEndTime ?? "0", 10),
      itemsInRound: parseInt(data.itemsInRound ?? "0", 10),
      antiSnipingWindowMs: parseInt(data.antiSnipingWindowMs ?? "0", 10),
      antiSnipingExtensionMs: parseInt(data.antiSnipingExtensionMs ?? "0", 10),
      maxExtensions: parseInt(data.maxExtensions ?? "0", 10),
    };
  }

  public async updateRoundEndTime(
    auctionId: string,
    newEndTime: number,
  ): Promise<void> {
    const key = this.metaKey(auctionId);
    await this.redis.hset(key, "roundEndTime", newEndTime);
  }

  public async placeBid(
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

      const errorMessages: Record<string, string> = {
        MIN_BID: `Minimum bid is ${String(minBidAmount)}`,
        BID_TOO_LOW: "Bid must be higher than current bid",
        INSUFFICIENT_BALANCE: "Insufficient balance",
      };

      return {
        success: false,
        error: errorMessages[String(errorOrOk)] ?? "Unknown error",
        previousAmount,
      };
    } catch (error) {
      const err = error as Error;
      if (err.message.includes("NOSCRIPT")) {
        this.logger.warn("Lua script not found, reloading...");
        await this.onModuleInit();
        return await this.placeBid(auctionId, userId, amount, minBidAmount);
      }
      throw error;
    }
  }

  public async placeBidUltraFast(
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
        error: errorMessages[errorCode] ?? `Unknown error: ${errorCode}`,
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
      const err = error as Error;
      if (err.message.includes("NOSCRIPT")) {
        this.logger.warn("Lua script not found, reloading...");
        await this.onModuleInit();
        return await this.placeBidUltraFast(auctionId, userId, amount);
      }
      throw error;
    }
  }

  public async getBidInfo(
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
      const err = error as Error;
      if (err.message.includes("NOSCRIPT")) {
        await this.onModuleInit();
        return await this.getBidInfo(auctionId, userId);
      }
      throw error;
    }
  }

  public async getBalance(
    auctionId: string,
    userId: string,
  ): Promise<CachedBalance> {
    try {
      const result = (await this.redis.evalsha(
        this.getBalanceSha,
        1,
        this.balanceKey(auctionId, userId),
      )) as number[];

      return {
        available: result[0] ?? 0,
        frozen: result[1] ?? 0,
      };
    } catch (error) {
      const err = error as Error;
      if (err.message.includes("NOSCRIPT")) {
        await this.onModuleInit();
        return await this.getBalance(auctionId, userId);
      }
      throw error;
    }
  }

  public async getDirtyUserIds(auctionId: string): Promise<string[]> {
    return await this.redis.smembers(this.dirtyUsersKey(auctionId));
  }

  public async getDirtyBidUserIds(auctionId: string): Promise<string[]> {
    return await this.redis.smembers(this.dirtyBidsKey(auctionId));
  }

  public async getSyncData(auctionId: string): Promise<CacheSyncData> {
    const dirtyUsers = await this.getDirtyUserIds(auctionId);
    const dirtyBids = await this.getDirtyBidUserIds(auctionId);

    const balances = new Map<string, CachedBalance>();
    const bids = new Map<string, CachedBid>();

    if (dirtyUsers.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const usrId of dirtyUsers) {
        pipeline.hgetall(this.balanceKey(auctionId, usrId));
      }
      const results = await pipeline.exec();

      for (let i = 0; i < dirtyUsers.length; i++) {
        const usrId = dirtyUsers[i];
        const resultItem = results?.[i]?.[1] as Record<string, string> | null;
        if (resultItem !== null && usrId !== undefined) {
          balances.set(usrId, {
            available: parseInt(resultItem.available ?? "0", 10),
            frozen: parseInt(resultItem.frozen ?? "0", 10),
          });
        }
      }
    }

    if (dirtyBids.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const usrId of dirtyBids) {
        pipeline.hgetall(this.bidKey(auctionId, usrId));
      }
      const results = await pipeline.exec();

      for (let i = 0; i < dirtyBids.length; i++) {
        const usrId = dirtyBids[i];
        const resultItem = results?.[i]?.[1] as Record<string, string> | null;
        if (resultItem?.amount !== undefined && usrId !== undefined) {
          bids.set(usrId, {
            amount: parseInt(resultItem.amount, 10),
            createdAt: parseInt(resultItem.createdAt ?? "0", 10),
            version: parseInt(resultItem.version ?? "0", 10),
          });
        }
      }
    }

    return { balances, bids };
  }

  public async clearDirtyFlags(auctionId: string): Promise<void> {
    await this.redis.del(
      this.dirtyUsersKey(auctionId),
      this.dirtyBidsKey(auctionId),
    );
  }

  public async clearDirtyUsers(
    auctionId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.srem(this.dirtyUsersKey(auctionId), ...userIds);
  }

  public async clearDirtyBids(
    auctionId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.srem(this.dirtyBidsKey(auctionId), ...userIds);
  }

  public async getTopBidders(
    auctionId: string,
    count: number,
    offset = 0,
  ): Promise<
    {
      userId: string;
      amount: number;
      createdAt: Date;
    }[]
  > {
    const key = this.leaderboardKey(auctionId);
    const results = await this.redis.zrevrange(
      key,
      offset,
      offset + count - 1,
      "WITHSCORES",
    );

    const entries: { userId: string; amount: number; createdAt: Date }[] = [];

    for (let i = 0; i < results.length; i += 2) {
      const usrId = results[i];
      const score = parseFloat(results[i + 1] ?? "0");

      if (usrId === undefined) continue;

      const amount = Math.floor(score / timestampMultiplier);
      const invertedTimestamp = score % timestampMultiplier;
      const timestamp = maxTimestamp - invertedTimestamp;

      entries.push({
        userId: usrId,
        amount,
        createdAt: new Date(timestamp),
      });
    }

    return entries;
  }

  public async getTotalBidders(auctionId: string): Promise<number> {
    return await this.redis.zcard(this.leaderboardKey(auctionId));
  }

  public async removeFromLeaderboard(
    auctionId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.zrem(this.leaderboardKey(auctionId), ...userIds);
  }

  public async clearAuctionCache(auctionId: string): Promise<void> {
    const pattern = this.auctionKeysPattern(auctionId);
    const leaderboardKeyStr = this.leaderboardKey(auctionId);

    let cursor = "0";
    const keysToDelete: string[] = [leaderboardKeyStr];

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
      const batchSize = 1000;
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        await this.redis.del(...batch);
      }
    }

    this.logger.debug(
      `Cleared ${String(keysToDelete.length)} keys for auction ${auctionId}`,
    );
  }

  public async isCacheWarmed(auctionId: string): Promise<boolean> {
    const metaKeyStr = this.metaKey(auctionId);
    const exists = await this.redis.exists(metaKeyStr);
    return exists === 1;
  }

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
}
