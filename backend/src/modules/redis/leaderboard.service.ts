import { Injectable, Inject, Logger } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS_CLIENT } from "./constants";

/**
 * Leaderboard entry returned from Redis
 */
export interface RedisLeaderboardEntry {
  userId: string;
  amount: number;
  createdAt: Date;
}

/**
 * Score encoding for Redis ZSET:
 * - Primary: bid amount (higher is better)
 * - Secondary: timestamp for tie-breaking (earlier is better)
 *
 * Formula: amount * 10^13 + (MAX_TIMESTAMP - createdAt)
 * MAX_TIMESTAMP = 9999999999999 (year ~2286)
 *
 * This ensures:
 * 1. Higher amounts always rank higher
 * 2. For equal amounts, earlier bids rank higher (lower timestamp inversion)
 */
const MAX_TIMESTAMP = 9999999999999;
const TIMESTAMP_MULTIPLIER = 1e13;

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Generate Redis key for auction leaderboard
   */
  private getKey(auctionId: string): string {
    return `leaderboard:${auctionId}`;
  }

  /**
   * Encode amount and timestamp into a single score for ZSET
   * Higher scores = higher ranking (amount priority, earlier timestamp for ties)
   */
  private encodeScore(amount: number, createdAt: Date): number {
    const timestamp = createdAt.getTime();
    // Invert timestamp so earlier bids get higher scores for tie-breaking
    const invertedTimestamp = MAX_TIMESTAMP - timestamp;
    return amount * TIMESTAMP_MULTIPLIER + invertedTimestamp;
  }

  /**
   * Decode a ZSET score back to amount and timestamp
   */
  private decodeScore(score: number): { amount: number; createdAt: Date } {
    const amount = Math.floor(score / TIMESTAMP_MULTIPLIER);
    const invertedTimestamp = score % TIMESTAMP_MULTIPLIER;
    const timestamp = MAX_TIMESTAMP - invertedTimestamp;
    return {
      amount,
      createdAt: new Date(timestamp),
    };
  }

  /**
   * Add or update a bid in the leaderboard
   * O(log N) complexity
   */
  async addBid(
    auctionId: string,
    userId: string,
    amount: number,
    createdAt: Date,
  ): Promise<void> {
    const key = this.getKey(auctionId);
    const score = this.encodeScore(amount, createdAt);

    await this.redis.zadd(key, score, userId);
    this.logger.debug("Added/updated bid in leaderboard", {
      auctionId,
      userId,
      amount,
      score,
    });
  }

  /**
   * Update an existing bid (same as addBid, ZADD handles updates)
   * O(log N) complexity
   */
  async updateBid(
    auctionId: string,
    userId: string,
    newAmount: number,
    createdAt: Date,
  ): Promise<void> {
    await this.addBid(auctionId, userId, newAmount, createdAt);
  }

  /**
   * Remove a bid from the leaderboard (e.g., when user wins)
   * O(log N) complexity
   */
  async removeBid(auctionId: string, userId: string): Promise<void> {
    const key = this.getKey(auctionId);
    await this.redis.zrem(key, userId);
    this.logger.debug("Removed bid from leaderboard", { auctionId, userId });
  }

  /**
   * Remove multiple bids from the leaderboard
   * O(log N * M) where M is number of userIds
   */
  async removeBids(auctionId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    const key = this.getKey(auctionId);
    await this.redis.zrem(key, ...userIds);
    this.logger.debug("Removed multiple bids from leaderboard", {
      auctionId,
      count: userIds.length,
    });
  }

  /**
   * Get top N entries from leaderboard with optional offset
   * O(log N + k) where k is the number of entries returned
   *
   * Returns entries sorted by amount DESC, createdAt ASC (for ties)
   */
  async getTopN(
    auctionId: string,
    n: number,
    offset: number = 0,
  ): Promise<RedisLeaderboardEntry[]> {
    const key = this.getKey(auctionId);

    // ZREVRANGE returns highest scores first (our desired order)
    const results = await this.redis.zrevrange(
      key,
      offset,
      offset + n - 1,
      "WITHSCORES",
    );

    const entries: RedisLeaderboardEntry[] = [];
    for (let i = 0; i < results.length; i += 2) {
      const userId = results[i];
      const score = parseFloat(results[i + 1] || "0");

      if (!userId) continue;

      const { amount, createdAt } = this.decodeScore(score);
      entries.push({ userId, amount, createdAt });
    }

    return entries;
  }

  /**
   * Get user's rank in the leaderboard (0-indexed)
   * O(log N) complexity
   *
   * Returns null if user not in leaderboard
   */
  async getUserRank(auctionId: string, userId: string): Promise<number | null> {
    const key = this.getKey(auctionId);

    // ZREVRANK returns 0-indexed rank (highest score = rank 0)
    const rank = await this.redis.zrevrank(key, userId);
    return rank;
  }

  /**
   * Get user's entry from leaderboard
   * O(log N) complexity
   */
  async getUserEntry(
    auctionId: string,
    userId: string,
  ): Promise<RedisLeaderboardEntry | null> {
    const key = this.getKey(auctionId);

    const score = await this.redis.zscore(key, userId);
    if (score === null) return null;

    const { amount, createdAt } = this.decodeScore(parseFloat(score));
    return { userId, amount, createdAt };
  }

  /**
   * Get total count of entries in leaderboard
   * O(1) complexity
   */
  async getTotalCount(auctionId: string): Promise<number> {
    const key = this.getKey(auctionId);
    return this.redis.zcard(key);
  }

  /**
   * Clear entire leaderboard for an auction
   */
  async clearLeaderboard(auctionId: string): Promise<void> {
    const key = this.getKey(auctionId);
    await this.redis.del(key);
    this.logger.debug("Cleared leaderboard", { auctionId });
  }

  /**
   * Rebuild leaderboard from an array of bid data
   * Useful for recovery or initial sync
   */
  async rebuildLeaderboard(
    auctionId: string,
    bids: Array<{ userId: string; amount: number; createdAt: Date }>,
  ): Promise<void> {
    const key = this.getKey(auctionId);

    // Clear existing leaderboard
    await this.redis.del(key);

    if (bids.length === 0) {
      this.logger.debug("Rebuilt empty leaderboard", { auctionId });
      return;
    }

    // Build ZADD arguments: [score1, member1, score2, member2, ...]
    const args: (string | number)[] = [];
    for (const bid of bids) {
      const score = this.encodeScore(bid.amount, bid.createdAt);
      args.push(score, bid.userId);
    }

    // Use ZADD with multiple members
    await this.redis.zadd(key, ...args);
    this.logger.debug("Rebuilt leaderboard", {
      auctionId,
      bidCount: bids.length,
    });
  }

  /**
   * Check if leaderboard exists and has entries
   */
  async exists(auctionId: string): Promise<boolean> {
    const count = await this.getTotalCount(auctionId);
    return count > 0;
  }

  /**
   * Get entries within a rank range (0-indexed, inclusive)
   * Useful for checking winning positions
   */
  async getEntriesByRankRange(
    auctionId: string,
    startRank: number,
    endRank: number,
  ): Promise<RedisLeaderboardEntry[]> {
    return this.getTopN(auctionId, endRank - startRank + 1, startRank);
  }
}
