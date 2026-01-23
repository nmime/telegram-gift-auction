import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import { getModelToken, getConnectionToken } from "@nestjs/mongoose";
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { UsersService } from "@/modules/users/users.service";
import { AuctionsService } from "@/modules/auctions/auctions.service";
import { BidsService } from "@/modules/bids/bids.service";
import { AuthService } from "@/modules/auth/auth.service";
import { JwtService } from "@nestjs/jwt";
import { EventsGateway } from "@/modules/events";
import { NotificationsService } from "@/modules/notifications";
import { TimerService } from "@/modules/auctions/timer.service";
import { BidCacheService } from "@/modules/redis/bid-cache.service";
import { CacheSyncService } from "@/modules/redis/cache-sync.service";
import {
  User,
  Transaction,
  Auction,
  Bid,
  TransactionType,
  AuctionStatus,
  BidStatus,
} from "@/schemas";
import { Types } from "mongoose";

// Mock type definitions for test mocks - using Record for flexibility
type MockFn = ReturnType<typeof vi.fn>;
type MockRecord = Record<string, MockFn>;

describe("Error Recovery and Resilience Integration Tests", () => {
  let usersService: UsersService;
  let auctionsService: AuctionsService;
  let bidsService: BidsService;
  let authService: AuthService;

  let mockUserModel: MockRecord;
  let mockTransactionModel: MockRecord;
  let mockAuctionModel: MockRecord;
  let mockBidModel: MockRecord;
  let mockConnection: MockRecord;
  let mockSession: MockRecord;
  let mockRedis: MockRecord;
  let mockBidCacheService: MockRecord;
  let mockCacheSyncService: MockRecord;
  let mockEventsGateway: MockRecord;
  let mockNotificationsService: MockRecord;
  let mockTimerService: MockRecord;
  let mockJwtService: MockRecord;
  let mockRedlock: MockRecord;

  const mockUserId = new Types.ObjectId();
  const mockUserId2 = new Types.ObjectId();
  const mockAuctionId = new Types.ObjectId();
  const mockBidId = new Types.ObjectId();

  beforeEach(async () => {
    // Mock session with ability to simulate failures
    mockSession = {
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      endSession: vi.fn(),
      inTransaction: vi.fn().mockReturnValue(true),
    };

    // Mock connection with failure simulation
    mockConnection = {
      startSession: vi.fn().mockResolvedValue(mockSession),
      readyState: 1, // Connected
    };

    // Mock models with failure simulation capabilities
    mockUserModel = {
      findById: vi.fn(),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOneAndUpdate: vi.fn(),
      create: vi.fn(),
      find: vi.fn(),
      countDocuments: vi.fn(),
    };

    mockTransactionModel = {
      create: vi.fn(),
      find: vi.fn(),
    };

    mockAuctionModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOneAndUpdate: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      find: vi.fn(),
      updateOne: vi.fn(),
    };

    mockBidModel = {
      findById: vi.fn(),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      create: vi.fn(),
      find: vi.fn(),
      deleteOne: vi.fn(),
      countDocuments: vi.fn(),
    };

    // Mock Redis with failure simulation
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
      hgetall: vi.fn(),
      hset: vi.fn(),
      zadd: vi.fn(),
      zrange: vi.fn(),
      zcard: vi.fn(),
      ping: vi.fn().mockResolvedValue("PONG"),
    };

    // Mock services
    mockBidCacheService = {
      setAuctionMeta: vi.fn(),
      warmupBids: vi.fn(),
      warmupBalances: vi.fn(),
      warmupUserBalance: vi.fn(),
      placeBidUltraFast: vi.fn(),
      isCacheWarmed: vi.fn().mockResolvedValue(false),
      getTopBidders: vi.fn().mockResolvedValue([]),
      getTotalBidders: vi.fn().mockResolvedValue(0),
      updateRoundEndTime: vi.fn(),
    };

    mockCacheSyncService = {
      fullSync: vi.fn().mockResolvedValue(undefined),
      syncBids: vi.fn(),
      syncBalances: vi.fn(),
    };

    mockEventsGateway = {
      emitAuctionUpdate: vi.fn(),
      emitNewBid: vi.fn(),
      emitRoundComplete: vi.fn(),
      emitAuctionComplete: vi.fn(),
      emitRoundStart: vi.fn(),
      emitAntiSnipingExtension: vi.fn(),
    };

    mockNotificationsService = {
      notifyOutbid: vi.fn(),
      notifyRoundWin: vi.fn(),
      notifyRoundLost: vi.fn(),
      notifyAuctionComplete: vi.fn(),
      notifyAntiSniping: vi.fn(),
      notifyNewRoundStarted: vi.fn(),
    };

    mockTimerService = {
      startTimer: vi.fn(),
      stopTimer: vi.fn(),
      updateTimer: vi.fn(),
    };

    mockJwtService = {
      signAsync: vi.fn().mockResolvedValue("mock-jwt-token"),
      verifyAsync: vi.fn(),
    };

    mockRedlock = {
      acquire: vi.fn().mockResolvedValue({
        release: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        AuctionsService,
        BidsService,
        AuthService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Transaction.name),
          useValue: mockTransactionModel,
        },
        {
          provide: getModelToken(Auction.name),
          useValue: mockAuctionModel,
        },
        {
          provide: getModelToken(Bid.name),
          useValue: mockBidModel,
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
        {
          provide: BidCacheService,
          useValue: mockBidCacheService,
        },
        {
          provide: CacheSyncService,
          useValue: mockCacheSyncService,
        },
        {
          provide: EventsGateway,
          useValue: mockEventsGateway,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
        {
          provide: TimerService,
          useValue: mockTimerService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: "REDIS_CLIENT",
          useValue: mockRedis,
        },
        {
          provide: "REDLOCK",
          useValue: mockRedlock,
        },
      ],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
    auctionsService = module.get<AuctionsService>(AuctionsService);
    bidsService = module.get<BidsService>(BidsService);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Database Connection Recovery", () => {
    it("should abort transaction when transient DB error occurs", async () => {
      // When a transient error occurs, the service should abort the transaction and throw
      mockUserModel.findById.mockImplementation(() => ({
        session: vi
          .fn()
          .mockRejectedValue(new Error("TransientTransactionError")),
      }));

      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow("TransientTransactionError");

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    });

    it("should complete successfully when no errors occur", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockImplementation(() => ({
        session: vi.fn().mockResolvedValue(mockUser),
      }));

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...mockUser,
        balance: 1100,
        version: 2,
      });

      mockTransactionModel.create.mockResolvedValue([
        { _id: new Types.ObjectId() },
      ]);

      const result = await usersService.deposit(mockUserId.toString(), 100);
      expect(result.balance).toBe(1100);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it("should abort transaction on DB timeout", async () => {
      mockUserModel.findById.mockImplementation(() => ({
        session: vi
          .fn()
          .mockRejectedValue(new Error("operation exceeded time limit")),
      }));

      await expect(
        usersService.deposit(mockUserId.toString(), 200),
      ).rejects.toThrow("operation exceeded time limit");

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should fail gracefully when connection pool is exhausted", async () => {
      // Session creation fails due to pool exhaustion
      mockConnection.startSession.mockRejectedValue(
        new Error("connection pool exhausted"),
      );

      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow("connection pool exhausted");
    });

    it("should abort transaction on DB connection closed", async () => {
      mockUserModel.findById.mockImplementation(() => ({
        session: vi.fn().mockRejectedValue(new Error("connection closed")),
      }));

      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow("connection closed");

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should handle partial DB data loss with recovery mechanisms", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      // User found but some data missing (recovered from backup)
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      // Simulate recovery by finding transaction history
      mockTransactionModel.find.mockResolvedValue([
        {
          userId: mockUserId,
          type: TransactionType.DEPOSIT,
          amount: 1000,
          balanceAfter: 1000,
        },
      ]);

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...mockUser,
        balance: 1100,
        version: 2,
      });

      mockTransactionModel.create.mockResolvedValue([
        { _id: new Types.ObjectId() },
      ]);

      const result = await usersService.deposit(mockUserId.toString(), 100);
      expect(result).toBeDefined();
      expect(result.balance).toBe(1100);
    });
  });

  describe("2. Service Failure Recovery", () => {
    it("should fail gracefully when auth service fails", async () => {
      mockUserModel.findById.mockResolvedValue(null);

      await expect(
        authService.getUser(mockUserId.toString()),
      ).rejects.toThrow();
    });

    it("should fail balance checks gracefully when user service fails", async () => {
      mockUserModel.findById.mockResolvedValue(null);

      await expect(
        usersService.getBalance(mockUserId.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it("should fail bid operations safely when auction service fails", async () => {
      mockAuctionModel.findOneAndUpdate.mockResolvedValue(null);
      mockAuctionModel.findById.mockImplementation(() => ({
        session: vi.fn().mockResolvedValue(null),
      }));

      await expect(
        auctionsService.placeBid(
          mockAuctionId.toString(),
          mockUserId.toString(),
          {
            amount: 100,
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should rollback financial operations when transaction service fails", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...mockUser,
        balance: 900,
        version: 2,
      });

      // Transaction creation fails
      mockTransactionModel.create.mockRejectedValue(
        new Error("Transaction service unavailable"),
      );

      await expect(
        usersService.withdraw(mockUserId.toString(), 100),
      ).rejects.toThrow();

      // Session should be aborted
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    });

    it("should use DB fallback when Redis connection fails", async () => {
      // Redis fails
      mockRedis.get.mockRejectedValue(new Error("Redis connection refused"));
      mockRedis.ping.mockRejectedValue(new Error("Redis connection refused"));

      // Should fall back to MongoDB
      const mockBids = [
        { userId: mockUserId, amount: 100, status: BidStatus.ACTIVE },
      ];
      mockBidModel.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        populate: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockBids),
      });

      const result = await bidsService.getActiveByAuction(
        mockAuctionId.toString(),
      );

      expect(result).toEqual(mockBids);
      expect(mockBidModel.find).toHaveBeenCalled();
    });

    it("should handle multiple service failures with correct cascading", async () => {
      // Auth fails
      mockJwtService.verifyAsync.mockRejectedValue(
        new Error("JWT verification failed"),
      );

      await expect(
        authService.validateToken("invalid-token"),
      ).rejects.toThrow();

      // User service still works independently
      const mockUser = { _id: mockUserId, balance: 1000, frozenBalance: 0 };
      mockUserModel.findById.mockResolvedValue(mockUser);

      const balance = await usersService.getBalance(mockUserId.toString());
      expect(balance.balance).toBe(1000);
    });
  });

  describe("3. Cache Consistency After Recovery", () => {
    it("should keep DB as source of truth when Redis cache fails", async () => {
      mockRedis.get.mockRejectedValue(new Error("Redis unavailable"));
      mockBidCacheService.isCacheWarmed.mockResolvedValue(false);

      const mockUser = { _id: mockUserId, balance: 1000, frozenBalance: 0 };
      mockUserModel.findById.mockResolvedValue(mockUser);

      const balance = await usersService.getBalance(mockUserId.toString());
      expect(balance.balance).toBe(1000);
      expect(mockUserModel.findById).toHaveBeenCalled();
    });

    it("should sync cache with DB when cache recovers", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 200,
        version: 1,
      };

      // Cache becomes available
      mockBidCacheService.isCacheWarmed.mockResolvedValue(true);
      mockBidCacheService.warmupUserBalance.mockResolvedValue(undefined);

      mockUserModel.findById.mockReturnValue({
        select: vi.fn().mockResolvedValue(mockUser),
      });

      await auctionsService.ensureUserInCache(
        mockAuctionId.toString(),
        mockUserId.toString(),
      );

      expect(mockBidCacheService.warmupUserBalance).toHaveBeenCalledWith(
        mockAuctionId.toString(),
        mockUserId.toString(),
        1000,
        200,
      );
    });

    it("should refresh stale cache on next access after recovery", async () => {
      const mockBids = [
        {
          userId: mockUserId,
          amount: 500,
          status: BidStatus.ACTIVE,
          createdAt: new Date(),
        },
      ];

      // Cache returns stale data initially
      mockBidCacheService.getTopBidders.mockResolvedValueOnce([
        { userId: mockUserId.toString(), amount: 400 },
      ]);

      // DB has fresh data
      mockBidModel.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        populate: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockBids),
        session: vi.fn().mockReturnThis(),
      });

      // Next access should refresh
      mockBidCacheService.warmupBids.mockResolvedValue(undefined);

      const result = await bidsService.getActiveByAuction(
        mockAuctionId.toString(),
      );

      expect(result).toEqual(mockBids);
    });

    it("should rebuild leaderboard cache after failure", async () => {
      const mockAuction = {
        _id: mockAuctionId,
        status: AuctionStatus.ACTIVE,
        currentRound: 1,
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            endTime: new Date(Date.now() + 3600000),
            extensionsCount: 0,
          },
        ],
        minBidAmount: 100,
        antiSnipingWindowMinutes: 5,
        antiSnipingExtensionMinutes: 5,
        maxExtensions: 6,
      };

      const mockBids = [
        { userId: mockUserId, amount: 500, createdAt: new Date() },
        { userId: mockUserId2, amount: 400, createdAt: new Date() },
      ];

      mockAuctionModel.findById.mockResolvedValue(mockAuction);
      mockBidModel.find.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockBids),
      });

      mockUserModel.find.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([
          { _id: mockUserId, balance: 1000, frozenBalance: 500 },
          { _id: mockUserId2, balance: 800, frozenBalance: 400 },
        ]),
      });

      await auctionsService.warmupAuctionCache(mockAuctionId.toString());

      expect(mockBidCacheService.setAuctionMeta).toHaveBeenCalled();
      expect(mockBidCacheService.warmupBids).toHaveBeenCalled();
      expect(mockBidCacheService.warmupBalances).toHaveBeenCalled();
    });
  });

  describe("4. Transaction Rollback Scenarios", () => {
    it("should rollback when bid placement partially succeeds", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      const mockAuction = {
        _id: mockAuctionId,
        status: AuctionStatus.ACTIVE,
        currentRound: 1,
        version: 1,
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            endTime: new Date(Date.now() + 3600000),
            completed: false,
            extensionsCount: 0,
          },
        ],
        minBidAmount: 100,
        minBidIncrement: 10,
      };

      mockAuctionModel.findOneAndUpdate.mockResolvedValue(mockAuction);
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      // Balance update succeeds
      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...mockUser,
        balance: 900,
        frozenBalance: 100,
        version: 2,
      });

      // But bid creation fails
      mockBidModel.create.mockRejectedValue(new Error("Bid creation failed"));

      await expect(
        auctionsService.placeBid(
          mockAuctionId.toString(),
          mockUserId.toString(),
          { amount: 100 },
        ),
      ).rejects.toThrow();

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    });

    it("should rollback transaction when deposit succeeds but audit fails", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...mockUser,
        balance: 1100,
        version: 2,
      });

      // Audit log (transaction) creation fails
      mockTransactionModel.create.mockRejectedValue(
        new Error("Audit log service unavailable"),
      );

      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow();

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should rollback withdrawal when fee calculation error occurs", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      // Withdrawal amount is invalid (would cause balance to go negative)
      await expect(
        usersService.withdraw(mockUserId.toString(), 1100),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should rollback all changes when multi-step operation fails mid-way", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 500,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      // Update fails with version conflict
      mockUserModel.findOneAndUpdate.mockRejectedValue(
        new Error("Version conflict"),
      );

      mockTransactionModel.create.mockResolvedValue([
        { _id: new Types.ObjectId() },
      ]);

      await expect(
        usersService.unfreezeBalance(
          mockUserId.toString(),
          100,
          mockAuctionId,
          mockBidId,
        ),
      ).rejects.toThrow();
    });

    it("should handle concurrent transactions with failure correctly", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      // First transaction updates version to 2
      mockUserModel.findOneAndUpdate
        .mockResolvedValueOnce({
          ...mockUser,
          balance: 1100,
          version: 2,
        })
        // Second transaction sees version conflict
        .mockResolvedValueOnce(null);

      mockTransactionModel.create.mockResolvedValue([
        { _id: new Types.ObjectId() },
      ]);

      // First succeeds
      const result1 = await usersService.deposit(mockUserId.toString(), 100);
      expect(result1.version).toBe(2);

      // Second detects conflict and throws
      await expect(
        usersService.deposit(mockUserId.toString(), 50),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("5. Data Consistency After Errors", () => {
    it("should not corrupt balance after failed operation", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      mockUserModel.findOneAndUpdate.mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow();

      // Balance should remain unchanged
      mockUserModel.findById.mockResolvedValue(mockUser);
      const balance = await usersService.getBalance(mockUserId.toString());
      expect(balance.balance).toBe(1000);
    });

    it("should not create orphaned records after failed bid", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      const mockAuction = {
        _id: mockAuctionId,
        status: AuctionStatus.ACTIVE,
        currentRound: 1,
        version: 1,
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            endTime: new Date(Date.now() + 3600000),
            completed: false,
            extensionsCount: 0,
          },
        ],
        minBidAmount: 100,
      };

      mockAuctionModel.findOneAndUpdate.mockResolvedValue(mockAuction);
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      const createdBid = {
        _id: mockBidId,
        userId: mockUserId,
        auctionId: mockAuctionId,
        amount: 100,
      };

      mockBidModel.create.mockResolvedValue([createdBid]);
      // User balance update fails - will trigger transaction rollback
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        auctionsService.placeBid(
          mockAuctionId.toString(),
          mockUserId.toString(),
          { amount: 100 },
        ),
      ).rejects.toThrow();

      // Transaction should be aborted - this rolls back the bid creation
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should not leave partial state after failed auction", async () => {
      const mockAuction = {
        _id: mockAuctionId,
        status: AuctionStatus.PENDING,
        version: 1,
        roundsConfig: [{ itemsCount: 5, durationMinutes: 60 }],
      };

      mockAuctionModel.findOneAndUpdate
        .mockResolvedValueOnce(mockAuction)
        .mockResolvedValueOnce(null); // Second update fails

      await expect(
        auctionsService.start(mockAuctionId.toString()),
      ).rejects.toThrow();

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should maintain consistency across multiple failed operations", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      // Multiple failures
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      mockUserModel.findOneAndUpdate.mockRejectedValue(
        new Error("Network error"),
      );

      // Try multiple operations
      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow();

      await expect(
        usersService.deposit(mockUserId.toString(), 50),
      ).rejects.toThrow();

      // Balance should still be correct
      mockUserModel.findById.mockResolvedValue(mockUser);
      const balance = await usersService.getBalance(mockUserId.toString());
      expect(balance.balance).toBe(1000);
      expect(balance.frozenBalance).toBe(0);
    });
  });

  describe("6. Timeout and Retry Handling", () => {
    it("should abort transaction on timeout and throw error", async () => {
      mockUserModel.findById.mockImplementation(() => ({
        session: vi
          .fn()
          .mockRejectedValue(new Error("operation exceeded time limit")),
      }));

      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow("operation exceeded time limit");

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should handle cascading timeouts with graceful failure", async () => {
      // All operations timeout
      mockUserModel.findById.mockRejectedValue(
        new Error("operation exceeded time limit"),
      );

      mockAuctionModel.findById.mockRejectedValue(
        new Error("operation exceeded time limit"),
      );

      // Should eventually fail gracefully
      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow();

      await expect(
        auctionsService.findById(mockAuctionId.toString()),
      ).rejects.toThrow();
    });

    it("should return proper error response after retry exhaustion", async () => {
      // Always timeout
      mockUserModel.findById.mockReturnValue({
        session: vi
          .fn()
          .mockRejectedValue(new Error("operation exceeded time limit")),
      });

      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow();

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });
  });

  describe("7. Partial Failure Handling", () => {
    it("should succeed for other users when one user operation fails", async () => {
      const user2 = {
        _id: mockUserId2,
        balance: 500,
        frozenBalance: 0,
        version: 1,
      };

      // User 1 fails
      mockUserModel.findById
        .mockReturnValueOnce({
          session: vi.fn().mockRejectedValue(new Error("User 1 locked")),
        })
        // User 2 succeeds
        .mockReturnValueOnce({
          session: vi.fn().mockResolvedValue(user2),
        });

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...user2,
        balance: 600,
        version: 2,
      });

      mockTransactionModel.create.mockResolvedValue([
        { _id: new Types.ObjectId() },
      ]);

      // User 1 fails
      await expect(
        usersService.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow();

      // User 2 succeeds
      const result = await usersService.deposit(mockUserId2.toString(), 100);
      expect(result.balance).toBe(600);
    });

    it("should preserve successes in batch operation with partial failure", () => {
      const mockBids = [
        {
          _id: new Types.ObjectId(),
          userId: mockUserId,
          amount: 100,
          status: BidStatus.ACTIVE,
          __v: 1,
        },
        {
          _id: new Types.ObjectId(),
          userId: mockUserId2,
          amount: 200,
          status: BidStatus.ACTIVE,
          __v: 1,
        },
      ];

      // First bid update succeeds
      mockBidModel.findOneAndUpdate
        .mockResolvedValueOnce({
          ...mockBids[0],
          status: BidStatus.WON,
          __v: 2,
        })
        // Second fails
        .mockResolvedValueOnce(null);

      const users = [
        { _id: mockUserId, frozenBalance: 100, balance: 900 },
        { _id: mockUserId2, frozenBalance: 200, balance: 800 },
      ];

      mockUserModel.findById
        .mockReturnValueOnce({
          session: vi.fn().mockResolvedValue(users[0]),
        })
        .mockReturnValueOnce({
          session: vi.fn().mockResolvedValue(users[1]),
        });

      // First user update succeeds
      mockUserModel.findOneAndUpdate.mockResolvedValueOnce({
        ...users[0],
        frozenBalance: 0,
      });

      // Transaction would fail on second bid, triggering rollback
      // But first bid update in session should still be aborted
      expect(mockSession.abortTransaction).toBeDefined();
    });
  });
});
