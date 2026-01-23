import { Injectable, Inject, Logger } from "@nestjs/common";
import Redis from "ioredis";
import { redisClient } from "./constants";

interface RedisLeaderboardEntry {
  userId: string;
  amount: number;
  createdAt: Date;
}

const maxTimestamp = 9999999999999;
const timestampMultiplier = 1e13;

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(@Inject(redisClient) private readonly redis: Redis) {}

  public async addBid(
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

  public async updateBid(
    auctionId: string,
    userId: string,
    newAmount: number,
    createdAt: Date,
  ): Promise<void> {
    await this.addBid(auctionId, userId, newAmount, createdAt);
  }

  public async removeBid(auctionId: string, userId: string): Promise<void> {
    const key = this.getKey(auctionId);
    await this.redis.zrem(key, userId);
    this.logger.debug("Removed bid from leaderboard", { auctionId, userId });
  }

  public async removeBids(auctionId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    const key = this.getKey(auctionId);
    await this.redis.zrem(key, ...userIds);
    this.logger.debug("Removed multiple bids from leaderboard", {
      auctionId,
      count: userIds.length,
    });
  }

  public async getTopN(
    auctionId: string,
    n: number,
    offset = 0,
  ): Promise<RedisLeaderboardEntry[]> {
    const key = this.getKey(auctionId);

    const results = await this.redis.zrevrange(
      key,
      offset,
      offset + n - 1,
      "WITHSCORES",
    );

    const entries: RedisLeaderboardEntry[] = [];
    for (let i = 0; i < results.length; i += 2) {
      const userId = results[i];
      const score = parseFloat(results[i + 1] ?? "0");

      if (userId === undefined) continue;

      const { amount, createdAt } = this.decodeScore(score);
      entries.push({ userId, amount, createdAt });
    }

    return entries;
  }

  public async getUserRank(
    auctionId: string,
    userId: string,
  ): Promise<number | null> {
    const key = this.getKey(auctionId);
    const rank = await this.redis.zrevrank(key, userId);
    return rank;
  }

  public async getUserEntry(
    auctionId: string,
    userId: string,
  ): Promise<RedisLeaderboardEntry | null> {
    const key = this.getKey(auctionId);

    const score = await this.redis.zscore(key, userId);
    if (score === null) return null;

    const { amount, createdAt } = this.decodeScore(parseFloat(score));
    return { userId, amount, createdAt };
  }

  public async getTotalCount(auctionId: string): Promise<number> {
    const key = this.getKey(auctionId);
    return await this.redis.zcard(key);
  }

  public async clearLeaderboard(auctionId: string): Promise<void> {
    const key = this.getKey(auctionId);
    await this.redis.del(key);
    this.logger.debug("Cleared leaderboard", { auctionId });
  }

  public async rebuildLeaderboard(
    auctionId: string,
    bids: { userId: string; amount: number; createdAt: Date }[],
  ): Promise<void> {
    const key = this.getKey(auctionId);

    await this.redis.del(key);

    if (bids.length === 0) {
      this.logger.debug("Rebuilt empty leaderboard", { auctionId });
      return;
    }

    const args: (string | number)[] = [];
    for (const bid of bids) {
      const score = this.encodeScore(bid.amount, bid.createdAt);
      args.push(score, bid.userId);
    }

    await this.redis.zadd(key, ...args);
    this.logger.debug("Rebuilt leaderboard", {
      auctionId,
      bidCount: bids.length,
    });
  }

  public async exists(auctionId: string): Promise<boolean> {
    const count = await this.getTotalCount(auctionId);
    return count > 0;
  }

  public async getEntriesByRankRange(
    auctionId: string,
    startRank: number,
    endRank: number,
  ): Promise<RedisLeaderboardEntry[]> {
    return await this.getTopN(auctionId, endRank - startRank + 1, startRank);
  }

  private getKey(auctionId: string): string {
    return `leaderboard:${auctionId}`;
  }

  private encodeScore(amount: number, createdAt: Date): number {
    const timestamp = createdAt.getTime();
    const invertedTimestamp = maxTimestamp - timestamp;
    return amount * timestampMultiplier + invertedTimestamp;
  }

  private decodeScore(score: number): { amount: number; createdAt: Date } {
    const amount = Math.floor(score / timestampMultiplier);
    const invertedTimestamp = score % timestampMultiplier;
    const timestamp = maxTimestamp - invertedTimestamp;
    return {
      amount,
      createdAt: new Date(timestamp),
    };
  }
}
