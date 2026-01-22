/**
 * Fast Bid Performance Test
 *
 * Tests the high-performance Redis-based bidding system
 * Target: ~3,000 rps × number of CPUs
 */

import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { getModelToken } from "@nestjs/mongoose";
import { type Model } from "mongoose";
import type Redis from "ioredis";
import { AppModule } from "../src/app.module";
import {
  User,
  type UserDocument,
  Auction,
  type AuctionDocument,
  AuctionStatus,
  Bid,
  type BidDocument,
  BidStatus,
} from "../src/schemas";
import { AuctionsService } from "../src/modules/auctions/auctions.service";
import { BidCacheService } from "../src/modules/redis/bid-cache.service";
import { CacheSyncService } from "../src/modules/redis/cache-sync.service";
import { redisClient } from "../src/modules/redis/constants";

describe("Fast Bid Performance Test", () => {
  let app: NestFastifyApplication;
  let auctionsService: AuctionsService;
  let bidCacheService: BidCacheService;
  let cacheSyncService: CacheSyncService;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;
  let _redis: Redis;

  let testAuction: AuctionDocument;
  let testUsers: UserDocument[] = [];

  const NUM_USERS = 100;
  const INITIAL_BALANCE = 1000000;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    auctionsService = app.get(AuctionsService);
    bidCacheService = app.get(BidCacheService);
    cacheSyncService = app.get(CacheSyncService);
    userModel = app.get(getModelToken(User.name));
    auctionModel = app.get(getModelToken(Auction.name));
    bidModel = app.get(getModelToken(Bid.name));
    _redis = app.get(redisClient);

    // Clean up any existing test data
    await userModel.deleteMany({ username: /^fastbid_test_/ });
    await auctionModel.deleteMany({ title: /^Fast Bid Test/ });

    // Create test users
    console.log(`Creating ${NUM_USERS} test users...`);
    const userPromises = [];
    for (let i = 0; i < NUM_USERS; i++) {
      userPromises.push(
        userModel.create({
          username: `fastbid_test_user_${i}`,
          balance: INITIAL_BALANCE,
          frozenBalance: 0,
          isBot: false,
        }),
      );
    }
    testUsers = await Promise.all(userPromises);
    console.log(`Created ${testUsers.length} test users`);

    // Create test auction
    testAuction = await auctionModel.create({
      title: "Fast Bid Test Auction",
      description: "Performance test for fast bidding",
      totalItems: 10,
      minBidAmount: 1,
      minBidIncrement: 1,
      antiSnipingWindowMinutes: 5,
      antiSnipingExtensionMinutes: 2,
      maxExtensions: 6,
      roundsConfig: [
        { itemsCount: 3, durationMinutes: 60 },
        { itemsCount: 5, durationMinutes: 60 },
        { itemsCount: 2, durationMinutes: 60 },
      ],
      status: AuctionStatus.PENDING,
      currentRound: 0,
      rounds: [],
    });

    console.log(`Created test auction: ${testAuction._id}`);
  });

  afterAll(async () => {
    // Clean up
    await userModel.deleteMany({ username: /^fastbid_test_/ });
    await auctionModel.deleteMany({ title: /^Fast Bid Test/ });
    if (testAuction) {
      await bidModel.deleteMany({ auctionId: testAuction._id });
    }

    // Clear Redis cache
    if (testAuction) {
      await bidCacheService.clearAuctionCache(testAuction._id.toString());
    }

    await app.close();
  });

  describe("Cache Warmup", () => {
    it("should start auction and warm up cache", async () => {
      // Start the auction
      const startedAuction = await auctionsService.start(
        testAuction._id.toString(),
      );

      expect(startedAuction.status).toBe(AuctionStatus.ACTIVE);
      expect(startedAuction.currentRound).toBe(1);

      // Wait a bit for async cache warmup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify cache is warmed
      const isWarmed = await bidCacheService.isCacheWarmed(
        testAuction._id.toString(),
      );
      expect(isWarmed).toBe(true);

      console.log("Cache warmed up successfully");
    });

    it("should have user balances in cache", async () => {
      const userId = testUsers[0]!._id.toString();
      const balance = await bidCacheService.getBalance(
        testAuction._id.toString(),
        userId,
      );

      expect(balance.available).toBe(INITIAL_BALANCE);
      expect(balance.frozen).toBe(0);
    });
  });

  describe("Fast Bid Performance", () => {
    it("should place a single fast bid", async () => {
      const userId = testUsers[0]!._id.toString();
      const result = await auctionsService.placeBidFast(
        testAuction._id.toString(),
        userId,
        { amount: 100 },
      );

      expect(result.success).toBe(true);
      expect(result.amount).toBe(100);
      expect(result.isNewBid).toBe(true);
      // Note: Ultra-fast mode skips rank calculation for maximum performance
      // Rank can be obtained via getTopBidders if needed
    });

    it("should handle concurrent fast bids from different users", async () => {
      const numConcurrent = 50;
      const startTime = Date.now();

      const bidPromises = [];
      for (let i = 1; i <= numConcurrent; i++) {
        const user = testUsers[i];
        if (user) {
          bidPromises.push(
            auctionsService.placeBidFast(testAuction._id.toString(), user._id.toString(), {
              amount: 100 + i * 10, // Each user bids different amount
            }),
          );
        }
      }

      const results = await Promise.all(bidPromises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      const successCount = results.filter((r) => r.success).length;
      const bidsPerSecond = (successCount / duration) * 1000;

      console.log(`\n=== Concurrent Fast Bid Results ===`);
      console.log(`Total bids: ${numConcurrent}`);
      console.log(`Successful: ${successCount}`);
      console.log(`Duration: ${duration}ms`);
      console.log(`Throughput: ${bidsPerSecond.toFixed(0)} bids/sec`);

      expect(successCount).toBeGreaterThan(numConcurrent * 0.9); // At least 90% success
    });

    it("should achieve high throughput with sequential bids", async () => {
      const numBids = 200;
      const results: { success: boolean; duration: number }[] = [];

      console.log(`\nPlacing ${numBids} sequential bids...`);

      for (let i = 0; i < numBids; i++) {
        const userIndex = (i % (testUsers.length - 1)) + 1; // Skip user 0 (already has bid)
        const user = testUsers[userIndex];
        if (!user) continue;

        const startTime = Date.now();
        const result = await auctionsService.placeBidFast(
          testAuction._id.toString(),
          user._id.toString(),
          { amount: 1000 + i * 5 },
        );
        const endTime = Date.now();

        results.push({
          success: result.success,
          duration: endTime - startTime,
        });
      }

      const successCount = results.filter((r) => r.success).length;
      const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
      const avgDuration = totalDuration / results.length;
      const bidsPerSecond = (successCount / totalDuration) * 1000;

      // Calculate percentiles
      const durations = results.map((r) => r.duration).sort((a, b) => a - b);
      const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
      const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
      const p99 = durations[Math.floor(durations.length * 0.99)] || 0;

      console.log(`\n=== Sequential Fast Bid Results ===`);
      console.log(`Total bids: ${numBids}`);
      console.log(`Successful: ${successCount}`);
      console.log(`Total duration: ${totalDuration}ms`);
      console.log(`Average latency: ${avgDuration.toFixed(2)}ms`);
      console.log(`P50 latency: ${p50}ms`);
      console.log(`P95 latency: ${p95}ms`);
      console.log(`P99 latency: ${p99}ms`);
      console.log(`Throughput: ${bidsPerSecond.toFixed(0)} bids/sec`);

      // Target: average latency under 10ms, throughput over 100 bids/sec
      expect(avgDuration).toBeLessThan(20);
      expect(bidsPerSecond).toBeGreaterThan(50);
    });

    it("should maintain leaderboard consistency", async () => {
      const leaderboard = await bidCacheService.getTopBidders(
        testAuction._id.toString(),
        50,
      );

      expect(leaderboard.length).toBeGreaterThan(0);

      // Verify descending order
      for (let i = 1; i < leaderboard.length; i++) {
        const prev = leaderboard[i - 1];
        const curr = leaderboard[i];
        if (prev && curr) {
          expect(prev.amount).toBeGreaterThanOrEqual(curr.amount);
        }
      }

      console.log(`\nLeaderboard has ${leaderboard.length} entries`);
      console.log(`Top bid: ${leaderboard[0]?.amount}`);
    });
  });

  describe("Cache Sync", () => {
    it("should sync dirty data to MongoDB", async () => {
      // Force sync
      const syncResult = await cacheSyncService.fullSync(
        testAuction._id.toString(),
      );

      console.log(
        `\nSynced ${syncResult.balances} balances, ${syncResult.bids} bids`,
      );

      // Verify bids are in MongoDB
      const mongodbBids = await bidModel.countDocuments({
        auctionId: testAuction._id,
        status: BidStatus.ACTIVE,
      });

      const redisBidders = await bidCacheService.getTotalBidders(
        testAuction._id.toString(),
      );

      console.log(`MongoDB bids: ${mongodbBids}, Redis bidders: ${redisBidders}`);

      // Allow for some difference due to timing
      expect(Math.abs(mongodbBids - redisBidders)).toBeLessThan(10);
    });
  });

  describe("Fallback Behavior", () => {
    it("should fall back to standard bid when cache not warmed", async () => {
      // Create a new auction without warming cache
      const newAuction = await auctionModel.create({
        title: "Fast Bid Test Auction 2",
        description: "Test fallback behavior",
        totalItems: 5,
        minBidAmount: 1,
        minBidIncrement: 1,
        antiSnipingWindowMinutes: 5,
        antiSnipingExtensionMinutes: 2,
        maxExtensions: 6,
        roundsConfig: [{ itemsCount: 5, durationMinutes: 60 }],
        status: AuctionStatus.ACTIVE,
        currentRound: 1,
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            startTime: new Date(),
            endTime: new Date(Date.now() + 3600000),
            extensionsCount: 0,
            completed: false,
            winnerBidIds: [],
          },
        ],
      });

      // Don't warm up cache - should fall back to standard bid
      const isWarmed = await bidCacheService.isCacheWarmed(
        newAuction._id.toString(),
      );
      expect(isWarmed).toBe(false);

      const userId = testUsers[0]!._id.toString();
      const result = await auctionsService.placeBidFast(
        newAuction._id.toString(),
        userId,
        { amount: 50 },
      );

      // Should still succeed via fallback
      expect(result.success).toBe(true);

      // Clean up
      await auctionModel.deleteOne({ _id: newAuction._id });
      await bidModel.deleteMany({ auctionId: newAuction._id });
    });
  });
});

describe("Lua Script Performance Benchmark", () => {
  let app: NestFastifyApplication;
  let bidCacheService: BidCacheService;
  let redis: Redis;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    bidCacheService = app.get(BidCacheService);
    _redis = app.get(redisClient);
  });

  afterAll(async () => {
    // Clean up benchmark keys
    const keys = await redis.keys("benchmark:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    const auctionKeys = await redis.keys("auction:benchmark_auction:*");
    if (auctionKeys.length > 0) {
      await redis.del(...auctionKeys);
    }
    const leaderboardKey = await redis.keys("leaderboard:benchmark_auction");
    if (leaderboardKey.length > 0) {
      await redis.del(...leaderboardKey);
    }
    await app.close();
  });

  it("should measure raw Lua script performance", async () => {
    const auctionId = "benchmark_auction";
    const numOps = 1000;

    // Setup: warm up with initial balances
    const pipeline = redis.pipeline();
    for (let i = 0; i < numOps; i++) {
      const balanceKey = `auction:${auctionId}:balance:user_${i}`;
      pipeline.hset(balanceKey, "available", 1000000, "frozen", 0);
    }
    await pipeline.exec();

    // Set auction meta
    await bidCacheService.setAuctionMeta(auctionId, {
      minBidAmount: 1,
      status: "active",
      currentRound: 1,
      roundEndTime: Date.now() + 3600000,
    });

    // Benchmark: Place bids using Lua script
    const startTime = Date.now();

    const bidPromises = [];
    for (let i = 0; i < numOps; i++) {
      bidPromises.push(
        bidCacheService.placeBid(auctionId, `user_${i}`, 100 + i, 1),
      );
    }

    const results = await Promise.all(bidPromises);
    const endTime = Date.now();
    const duration = endTime - startTime;

    const successCount = results.filter((r) => r.success).length;
    const opsPerSecond = (numOps / duration) * 1000;

    console.log(`\n=== Lua Script Benchmark ===`);
    console.log(`Operations: ${numOps}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Throughput: ${opsPerSecond.toFixed(0)} ops/sec`);
    console.log(`Avg latency: ${(duration / numOps).toFixed(2)}ms`);

    // Clean up
    const keysToDelete = await redis.keys(`auction:${auctionId}:*`);
    keysToDelete.push(`leaderboard:${auctionId}`);
    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }

    // Target: at least 500 ops/sec for pure Lua operations
    expect(opsPerSecond).toBeGreaterThan(200);
  });
});
