import { Test, TestingModule } from "@nestjs/testing";
import { BidCacheService } from "@/modules/redis/bid-cache.service";
import { LeaderboardService } from "@/modules/redis/leaderboard.service";
import { redisClient } from "@/modules/redis/constants";
import Redis from "ioredis";

describe("Redis Services", () => {
  describe("BidCacheService", () => {
    let service: BidCacheService;
    let mockRedis: jest.Mocked<Redis>;

    beforeEach(async () => {
      mockRedis = {
        script: jest.fn(),
        evalsha: jest.fn(),
        hset: jest.fn(),
        hgetall: jest.fn(),
        smembers: jest.fn(),
        del: jest.fn(),
        srem: jest.fn(),
        pipeline: jest.fn(),
        scan: jest.fn(),
        exists: jest.fn(),
        zrevrange: jest.fn(),
        zcard: jest.fn(),
        zrem: jest.fn(),
        duplicate: jest.fn().mockReturnThis(),
      } as unknown as jest.Mocked<Redis>;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BidCacheService,
          {
            provide: redisClient,
            useValue: mockRedis,
          },
        ],
      }).compile();

      service = module.get<BidCacheService>(BidCacheService);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe("Module Initialization", () => {
      it("should be defined", () => {
        expect(service).toBeDefined();
      });

      it("should load Lua scripts on module init", async () => {
        mockRedis.script.mockResolvedValue("sha1234");

        await service.onModuleInit();

        expect(mockRedis.script).toHaveBeenCalledTimes(4);
        expect(mockRedis.script).toHaveBeenCalledWith(
          "LOAD",
          expect.any(String),
        );
      });

      it("should throw error if Lua script loading fails", async () => {
        mockRedis.script.mockRejectedValue(
          new Error("Redis connection failed"),
        );

        await expect(service.onModuleInit()).rejects.toThrow(
          "Redis connection failed",
        );
      });
    });

    describe("Cache Warmup", () => {
      it("should warmup user balance", async () => {
        mockRedis.hset.mockResolvedValue(0);

        await service.warmupUserBalance("auction1", "user1", 1000, 500);

        expect(mockRedis.hset).toHaveBeenCalledWith(
          "auction:auction1:balance:user1",
          "available",
          1000,
          "frozen",
          500,
        );
      });

      it("should warmup balances for multiple users", async () => {
        const mockPipeline = {
          hset: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        mockRedis.pipeline.mockReturnValue(mockPipeline as any);

        const users = [
          { id: "user1", balance: 1000, frozenBalance: 0 },
          { id: "user2", balance: 2000, frozenBalance: 500 },
        ];

        await service.warmupBalances("auction1", users);

        expect(mockRedis.pipeline).toHaveBeenCalled();
        expect(mockPipeline.hset).toHaveBeenCalledTimes(2);
        expect(mockPipeline.exec).toHaveBeenCalled();
      });

      it("should skip warmup if no users provided", async () => {
        await service.warmupBalances("auction1", []);

        expect(mockRedis.pipeline).not.toHaveBeenCalled();
      });

      it("should warmup existing bids", async () => {
        const mockPipeline = {
          del: jest.fn().mockReturnThis(),
          hset: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        mockRedis.pipeline.mockReturnValue(mockPipeline as any);

        const bids = [
          {
            userId: "user1",
            amount: 1000,
            createdAt: new Date("2024-01-01"),
          },
          {
            userId: "user2",
            amount: 2000,
            createdAt: new Date("2024-01-02"),
          },
        ];

        await service.warmupBids("auction1", bids);

        expect(mockPipeline.del).toHaveBeenCalledWith("leaderboard:auction1");
        expect(mockPipeline.hset).toHaveBeenCalledTimes(2);
        expect(mockPipeline.zadd).toHaveBeenCalledTimes(2);
      });
    });

    describe("Auction Metadata", () => {
      it("should set auction meta", async () => {
        mockRedis.hset.mockResolvedValue(0);

        await service.setAuctionMeta("auction1", {
          minBidAmount: 100,
          status: "active",
          currentRound: 1,
          roundEndTime: Date.now() + 60000,
          itemsInRound: 5,
          antiSnipingWindowMs: 30000,
          antiSnipingExtensionMs: 60000,
          maxExtensions: 3,
        });

        expect(mockRedis.hset).toHaveBeenCalledWith(
          "auction:auction1:meta",
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Number),
          expect.any(String),
          expect.any(Number),
        );
      });

      it("should get auction meta", async () => {
        mockRedis.hgetall.mockResolvedValue({
          minBidAmount: "100",
          status: "active",
          currentRound: "1",
          roundEndTime: "1704067200000",
          itemsInRound: "5",
          antiSnipingWindowMs: "30000",
          antiSnipingExtensionMs: "60000",
          maxExtensions: "3",
        });

        const result = await service.getAuctionMeta("auction1");

        expect(result).toEqual({
          minBidAmount: 100,
          status: "active",
          currentRound: 1,
          roundEndTime: 1704067200000,
          itemsInRound: 5,
          antiSnipingWindowMs: 30000,
          antiSnipingExtensionMs: 60000,
          maxExtensions: 3,
        });
      });

      it("should return null if meta not found", async () => {
        mockRedis.hgetall.mockResolvedValue({});

        const result = await service.getAuctionMeta("auction1");

        expect(result).toBeNull();
      });

      it("should update round end time", async () => {
        mockRedis.hset.mockResolvedValue(0);

        const newEndTime = Date.now() + 120000;
        await service.updateRoundEndTime("auction1", newEndTime);

        expect(mockRedis.hset).toHaveBeenCalledWith(
          "auction:auction1:meta",
          "roundEndTime",
          newEndTime,
        );
      });
    });

    describe("Bid Placement", () => {
      beforeEach(() => {
        mockRedis.script.mockResolvedValue("sha1234");
      });

      it("should place bid successfully", async () => {
        mockRedis.evalsha.mockResolvedValue([
          1, // success
          "OK",
          1500, // newAmount
          1000, // previousAmount
          500, // frozenDelta
          0, // isNewBid
          5, // rank
        ]);

        const result = await service.placeBid("auction1", "user1", 1500, 100);

        expect(result).toEqual({
          success: true,
          newAmount: 1500,
          previousAmount: 1000,
          frozenDelta: 500,
          isNewBid: false,
          rank: 5,
        });
      });

      it("should reject bid below minimum", async () => {
        mockRedis.evalsha.mockResolvedValue([
          0, // failure
          "MIN_BID",
          0,
          0,
          0,
          0,
          -1,
        ]);

        const result = await service.placeBid("auction1", "user1", 50, 100);

        expect(result).toEqual({
          success: false,
          error: "Minimum bid is 100",
          previousAmount: 0,
        });
      });

      it("should reject bid that is too low", async () => {
        mockRedis.evalsha.mockResolvedValue([
          0,
          "BID_TOO_LOW",
          1000,
          1000,
          0,
          0,
          -1,
        ]);

        const result = await service.placeBid("auction1", "user1", 900, 100);

        expect(result).toEqual({
          success: false,
          error: "Bid must be higher than current bid",
          previousAmount: 1000,
        });
      });

      it("should reject bid with insufficient balance", async () => {
        mockRedis.evalsha.mockResolvedValue([
          0,
          "INSUFFICIENT_BALANCE",
          1000,
          1000,
          0,
          0,
          -1,
        ]);

        const result = await service.placeBid("auction1", "user1", 5000, 100);

        expect(result).toEqual({
          success: false,
          error: "Insufficient balance",
          previousAmount: 1000,
        });
      });

      it("should reload scripts on NOSCRIPT error", async () => {
        mockRedis.evalsha
          .mockRejectedValueOnce(new Error("NOSCRIPT No matching script"))
          .mockResolvedValueOnce([1, "OK", 1500, 1000, 500, 0, 5]);

        await service.onModuleInit();
        const result = await service.placeBid("auction1", "user1", 1500, 100);

        expect(result.success).toBe(true);
      });
    });

    describe("Ultra-Fast Bid Placement", () => {
      it("should place bid with all meta fields", async () => {
        mockRedis.evalsha.mockResolvedValue([
          1,
          "OK",
          1500,
          1000,
          500,
          0,
          -1,
          1704067200000, // roundEndTime
          30000, // antiSnipingWindowMs
          60000, // antiSnipingExtensionMs
          3, // maxExtensions
          5, // itemsInRound
          1, // currentRound
        ]);

        const result = await service.placeBidUltraFast(
          "auction1",
          "user1",
          1500,
        );

        expect(result).toEqual({
          success: true,
          newAmount: 1500,
          previousAmount: 1000,
          frozenDelta: 500,
          isNewBid: false,
          rank: undefined,
          roundEndTime: 1704067200000,
          antiSnipingWindowMs: 30000,
          antiSnipingExtensionMs: 60000,
          maxExtensions: 3,
          itemsInRound: 5,
          currentRound: 1,
        });
      });

      it("should indicate cache not warmed", async () => {
        mockRedis.evalsha.mockResolvedValue([
          0,
          "NOT_WARMED",
          0,
          0,
          0,
          0,
          -1,
          0,
          0,
          0,
          0,
          0,
          0,
        ]);

        const result = await service.placeBidUltraFast(
          "auction1",
          "user1",
          1500,
        );

        expect(result.success).toBe(false);
        expect(result.needsWarmup).toBe(true);
        expect(result.error).toBe("Cache not warmed");
      });

      it("should reject bid when auction not active", async () => {
        mockRedis.evalsha.mockResolvedValue([
          0,
          "NOT_ACTIVE",
          0,
          0,
          0,
          0,
          -1,
          0,
          0,
          0,
          0,
          0,
          0,
        ]);

        const result = await service.placeBidUltraFast(
          "auction1",
          "user1",
          1500,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Auction is not active");
      });

      it("should reject bid when round ended", async () => {
        mockRedis.evalsha.mockResolvedValue([
          0,
          "ROUND_ENDED",
          0,
          0,
          0,
          0,
          -1,
          1704067200000,
          30000,
          60000,
          3,
          5,
          1,
        ]);

        const result = await service.placeBidUltraFast(
          "auction1",
          "user1",
          1500,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Round has ended or is about to end");
      });
    });

    describe("Bid Info Retrieval", () => {
      it("should get bid info with rank", async () => {
        mockRedis.evalsha.mockResolvedValue([
          1500, // amount
          1704067200000, // createdAt
          5, // rank
        ]);

        const result = await service.getBidInfo("auction1", "user1");

        expect(result).toEqual({
          amount: 1500,
          createdAt: new Date(1704067200000),
          rank: 5,
        });
      });

      it("should return null rank if user not in leaderboard", async () => {
        mockRedis.evalsha.mockResolvedValue([1500, 1704067200000, -1]);

        const result = await service.getBidInfo("auction1", "user1");

        expect(result.rank).toBeNull();
      });

      it("should return null createdAt if bid not found", async () => {
        mockRedis.evalsha.mockResolvedValue([0, 0, -1]);

        const result = await service.getBidInfo("auction1", "user1");

        expect(result).toEqual({
          amount: 0,
          createdAt: null,
          rank: null,
        });
      });
    });

    describe("Balance Operations", () => {
      it("should get user balance", async () => {
        mockRedis.evalsha.mockResolvedValue([5000, 1500]);

        const result = await service.getBalance("auction1", "user1");

        expect(result).toEqual({
          available: 5000,
          frozen: 1500,
        });
      });

      it("should handle zero balance", async () => {
        mockRedis.evalsha.mockResolvedValue([0, 0]);

        const result = await service.getBalance("auction1", "user1");

        expect(result).toEqual({
          available: 0,
          frozen: 0,
        });
      });
    });

    describe("Sync Operations", () => {
      it("should get dirty user IDs", async () => {
        mockRedis.smembers.mockResolvedValue(["user1", "user2", "user3"]);

        const result = await service.getDirtyUserIds("auction1");

        expect(result).toEqual(["user1", "user2", "user3"]);
        expect(mockRedis.smembers).toHaveBeenCalledWith(
          "auction:auction1:dirty-users",
        );
      });

      it("should get dirty bid user IDs", async () => {
        mockRedis.smembers.mockResolvedValue(["user1", "user2"]);

        const result = await service.getDirtyBidUserIds("auction1");

        expect(result).toEqual(["user1", "user2"]);
        expect(mockRedis.smembers).toHaveBeenCalledWith(
          "auction:auction1:dirty-bids",
        );
      });

      it("should get sync data", async () => {
        mockRedis.smembers
          .mockResolvedValueOnce(["user1"])
          .mockResolvedValueOnce(["user1"]);

        const mockBalancePipeline = {
          hgetall: jest.fn().mockReturnThis(),
          exec: jest
            .fn()
            .mockResolvedValue([[null, { available: "5000", frozen: "1500" }]]),
        };

        const mockBidPipeline = {
          hgetall: jest.fn().mockReturnThis(),
          exec: jest
            .fn()
            .mockResolvedValue([
              [
                null,
                { amount: "1500", createdAt: "1704067200000", version: "1" },
              ],
            ]),
        };

        mockRedis.pipeline
          .mockReturnValueOnce(mockBalancePipeline as any)
          .mockReturnValueOnce(mockBidPipeline as any);

        const result = await service.getSyncData("auction1");

        expect(result.balances.size).toBe(1);
        expect(result.bids.size).toBe(1);
        expect(result.balances.get("user1")).toEqual({
          available: 5000,
          frozen: 1500,
        });
        expect(result.bids.get("user1")).toEqual({
          amount: 1500,
          createdAt: 1704067200000,
          version: 1,
        });
      });

      it("should clear dirty flags", async () => {
        mockRedis.del.mockResolvedValue(2);

        await service.clearDirtyFlags("auction1");

        expect(mockRedis.del).toHaveBeenCalledWith(
          "auction:auction1:dirty-users",
          "auction:auction1:dirty-bids",
        );
      });

      it("should clear specific dirty users", async () => {
        mockRedis.srem.mockResolvedValue(2);

        await service.clearDirtyUsers("auction1", ["user1", "user2"]);

        expect(mockRedis.srem).toHaveBeenCalledWith(
          "auction:auction1:dirty-users",
          "user1",
          "user2",
        );
      });

      it("should skip clearing if no users provided", async () => {
        await service.clearDirtyUsers("auction1", []);

        expect(mockRedis.srem).not.toHaveBeenCalled();
      });
    });

    describe("Leaderboard Operations", () => {
      it("should get top bidders", async () => {
        mockRedis.zrevrange.mockResolvedValue([
          "user1",
          "15008295932799999",
          "user2",
          "10008295932799999",
        ]);

        const result = await service.getTopBidders("auction1", 2);

        expect(result).toHaveLength(2);
        const firstResult = result[0];
        if (firstResult) {
          expect(firstResult.userId).toBe("user1");
          expect(firstResult.amount).toBe(1500);
        }
      });

      it("should get total bidders count", async () => {
        mockRedis.zcard.mockResolvedValue(25);

        const result = await service.getTotalBidders("auction1");

        expect(result).toBe(25);
      });

      it("should remove users from leaderboard", async () => {
        mockRedis.zrem.mockResolvedValue(2);

        await service.removeFromLeaderboard("auction1", ["user1", "user2"]);

        expect(mockRedis.zrem).toHaveBeenCalledWith(
          "leaderboard:auction1",
          "user1",
          "user2",
        );
      });

      it("should skip removal if no users provided", async () => {
        await service.removeFromLeaderboard("auction1", []);

        expect(mockRedis.zrem).not.toHaveBeenCalled();
      });
    });

    describe("Cleanup Operations", () => {
      it("should check if cache is warmed", async () => {
        mockRedis.exists.mockResolvedValue(1);

        const result = await service.isCacheWarmed("auction1");

        expect(result).toBe(true);
        expect(mockRedis.exists).toHaveBeenCalledWith("auction:auction1:meta");
      });

      it("should return false if cache not warmed", async () => {
        mockRedis.exists.mockResolvedValue(0);

        const result = await service.isCacheWarmed("auction1");

        expect(result).toBe(false);
      });

      it("should clear auction cache", async () => {
        mockRedis.scan
          .mockResolvedValueOnce([
            "10",
            ["auction:auction1:balance:user1", "auction:auction1:bid:user1"],
          ])
          .mockResolvedValueOnce(["0", ["auction:auction1:meta"]]);
        mockRedis.del.mockResolvedValue(4);

        await service.clearAuctionCache("auction1");

        expect(mockRedis.scan).toHaveBeenCalled();
        expect(mockRedis.del).toHaveBeenCalled();
      });
    });
  });

  describe("LeaderboardService", () => {
    let service: LeaderboardService;
    let mockRedis: jest.Mocked<Redis>;

    beforeEach(async () => {
      mockRedis = {
        zadd: jest.fn(),
        zrem: jest.fn(),
        zrevrange: jest.fn(),
        zrevrank: jest.fn(),
        zscore: jest.fn(),
        zcard: jest.fn(),
        del: jest.fn(),
      } as unknown as jest.Mocked<Redis>;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LeaderboardService,
          {
            provide: redisClient,
            useValue: mockRedis,
          },
        ],
      }).compile();

      service = module.get<LeaderboardService>(LeaderboardService);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    describe("Add/Update Bid", () => {
      it("should add bid to leaderboard", async () => {
        mockRedis.zadd.mockResolvedValue(1 as any);

        await service.addBid("auction1", "user1", 1000, new Date("2024-01-01"));

        expect(mockRedis.zadd).toHaveBeenCalledWith(
          "leaderboard:auction1",
          expect.any(Number),
          "user1",
        );
      });

      it("should update existing bid", async () => {
        mockRedis.zadd.mockResolvedValue(0 as any);

        await service.updateBid(
          "auction1",
          "user1",
          1500,
          new Date("2024-01-01"),
        );

        expect(mockRedis.zadd).toHaveBeenCalledWith(
          "leaderboard:auction1",
          expect.any(Number),
          "user1",
        );
      });

      it("should preserve timestamp for tie-breaking", async () => {
        const timestamp = new Date("2024-01-01T12:00:00.000Z");
        mockRedis.zadd.mockResolvedValue(1 as any);

        await service.addBid("auction1", "user1", 1000, timestamp);

        const expectedScore =
          1000 * 1e13 + (9999999999999 - timestamp.getTime());
        expect(mockRedis.zadd).toHaveBeenCalledWith(
          "leaderboard:auction1",
          expectedScore,
          "user1",
        );
      });
    });

    describe("Remove Bid", () => {
      it("should remove single bid", async () => {
        mockRedis.zrem.mockResolvedValue(1);

        await service.removeBid("auction1", "user1");

        expect(mockRedis.zrem).toHaveBeenCalledWith(
          "leaderboard:auction1",
          "user1",
        );
      });

      it("should remove multiple bids", async () => {
        mockRedis.zrem.mockResolvedValue(3);

        await service.removeBids("auction1", ["user1", "user2", "user3"]);

        expect(mockRedis.zrem).toHaveBeenCalledWith(
          "leaderboard:auction1",
          "user1",
          "user2",
          "user3",
        );
      });

      it("should skip removal if no users provided", async () => {
        await service.removeBids("auction1", []);

        expect(mockRedis.zrem).not.toHaveBeenCalled();
      });
    });

    describe("Query Leaderboard", () => {
      it("should get top N entries", async () => {
        mockRedis.zrevrange.mockResolvedValue([
          "user1",
          "15008295932799999",
          "user2",
          "10008295932799999",
        ]);

        const result = await service.getTopN("auction1", 2);

        expect(result).toHaveLength(2);
        expect(result[0]!.userId).toBe("user1");
        expect(result[0]!.amount).toBe(1500);
        expect(result[1]!.userId).toBe("user2");
        expect(result[1]!.amount).toBe(1000);
      });

      it("should support offset for pagination", async () => {
        mockRedis.zrevrange.mockResolvedValue(["user3", "8000009999999997999"]);

        const result = await service.getTopN("auction1", 1, 2);

        expect(mockRedis.zrevrange).toHaveBeenCalledWith(
          "leaderboard:auction1",
          2,
          2,
          "WITHSCORES",
        );
        expect(result).toHaveLength(1);
      });

      it("should handle empty leaderboard", async () => {
        mockRedis.zrevrange.mockResolvedValue([]);

        const result = await service.getTopN("auction1", 10);

        expect(result).toHaveLength(0);
      });

      it("should get user rank", async () => {
        mockRedis.zrevrank.mockResolvedValue(5);

        const rank = await service.getUserRank("auction1", "user1");

        expect(rank).toBe(5);
      });

      it("should return null if user not in leaderboard", async () => {
        mockRedis.zrevrank.mockResolvedValue(null);

        const rank = await service.getUserRank("auction1", "user1");

        expect(rank).toBeNull();
      });

      it("should get user entry", async () => {
        mockRedis.zscore.mockResolvedValue("15008295932799999");

        const entry = await service.getUserEntry("auction1", "user1");

        expect(entry).not.toBeNull();
        expect(entry?.userId).toBe("user1");
        expect(entry?.amount).toBe(1500);
      });

      it("should return null if user entry not found", async () => {
        mockRedis.zscore.mockResolvedValue(null);

        const entry = await service.getUserEntry("auction1", "user1");

        expect(entry).toBeNull();
      });

      it("should get total count", async () => {
        mockRedis.zcard.mockResolvedValue(42);

        const count = await service.getTotalCount("auction1");

        expect(count).toBe(42);
      });

      it("should get entries by rank range", async () => {
        mockRedis.zrevrange.mockResolvedValue([
          "user3",
          "8000009999999997999",
          "user4",
          "7000009999999996999",
        ]);

        const result = await service.getEntriesByRankRange("auction1", 2, 3);

        expect(mockRedis.zrevrange).toHaveBeenCalledWith(
          "leaderboard:auction1",
          2,
          3,
          "WITHSCORES",
        );
        expect(result).toHaveLength(2);
      });
    });

    describe("Rebuild Leaderboard", () => {
      it("should rebuild leaderboard from bid array", async () => {
        mockRedis.del.mockResolvedValue(1);
        mockRedis.zadd.mockResolvedValue(3 as any);

        const bids = [
          {
            userId: "user1",
            amount: 1500,
            createdAt: new Date("2024-01-01"),
          },
          {
            userId: "user2",
            amount: 1000,
            createdAt: new Date("2024-01-02"),
          },
          {
            userId: "user3",
            amount: 800,
            createdAt: new Date("2024-01-03"),
          },
        ];

        await service.rebuildLeaderboard("auction1", bids);

        expect(mockRedis.del).toHaveBeenCalledWith("leaderboard:auction1");
        expect(mockRedis.zadd).toHaveBeenCalledWith(
          "leaderboard:auction1",
          expect.any(Number),
          "user1",
          expect.any(Number),
          "user2",
          expect.any(Number),
          "user3",
        );
      });

      it("should handle empty bid array", async () => {
        mockRedis.del.mockResolvedValue(1);

        await service.rebuildLeaderboard("auction1", []);

        expect(mockRedis.del).toHaveBeenCalledWith("leaderboard:auction1");
        expect(mockRedis.zadd).not.toHaveBeenCalled();
      });
    });

    describe("Cleanup", () => {
      it("should clear leaderboard", async () => {
        mockRedis.del.mockResolvedValue(1);

        await service.clearLeaderboard("auction1");

        expect(mockRedis.del).toHaveBeenCalledWith("leaderboard:auction1");
      });

      it("should check if leaderboard exists", async () => {
        mockRedis.zcard.mockResolvedValue(10);

        const exists = await service.exists("auction1");

        expect(exists).toBe(true);
      });

      it("should return false for empty leaderboard", async () => {
        mockRedis.zcard.mockResolvedValue(0);

        const exists = await service.exists("auction1");

        expect(exists).toBe(false);
      });
    });

    describe("Score Encoding/Decoding", () => {
      it("should correctly encode higher amounts with higher scores", async () => {
        const timestamp = new Date("2024-01-01T12:00:00.000Z");
        mockRedis.zadd.mockResolvedValue(1 as any);

        await service.addBid("auction1", "user1", 1000, timestamp);
        await service.addBid("auction1", "user2", 2000, timestamp);

        const calls = mockRedis.zadd.mock.calls;
        const firstCall = calls[0];
        const secondCall = calls[1];

        if (firstCall && secondCall) {
          const score1 = firstCall[1] as unknown as number;
          const score2 = secondCall[1] as unknown as number;
          expect(score2).toBeGreaterThan(score1);
        }
      });

      it("should prioritize earlier timestamps for same amount", async () => {
        const earlier = new Date("2024-01-01T12:00:00.000Z");
        const later = new Date("2024-01-01T12:00:01.000Z");
        mockRedis.zadd.mockResolvedValue(1 as any);

        await service.addBid("auction1", "user1", 1000, earlier);
        await service.addBid("auction1", "user2", 1000, later);

        const calls = mockRedis.zadd.mock.calls;
        const firstCall = calls[0];
        const secondCall = calls[1];

        if (firstCall && secondCall) {
          const score1 = firstCall[1] as unknown as number;
          const score2 = secondCall[1] as unknown as number;
          expect(score1).toBeGreaterThan(score2);
        }
      });
    });
  });
});
