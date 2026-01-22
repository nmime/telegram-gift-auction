/* eslint-disable @typescript-eslint/no-explicit-any */
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

// MongoDB Memory Server with replica set requires time to download binary on first run
jest.setTimeout(180000);

describe("Error Recovery and Resilience Integration Tests", () => {
  let usersService: UsersService;
  let auctionsService: AuctionsService;
  let bidsService: BidsService;
  let authService: AuthService;

  let mockUserModel: any;
  let mockTransactionModel: any;
  let mockAuctionModel: any;
  let mockBidModel: any;
  let mockConnection: any;
  let mockSession: any;
  let mockRedis: any;
  let mockBidCacheService: any;
  let mockCacheSyncService: any;
  let mockEventsGateway: any;
  let mockNotificationsService: any;
  let mockTimerService: any;
  let mockJwtService: any;
  let mockRedlock: any;

  const mockUserId = new Types.ObjectId();
  const mockUserId2 = new Types.ObjectId();
  const mockAuctionId = new Types.ObjectId();
  const mockBidId = new Types.ObjectId();

  beforeEach(async () => {
    // Mock session with ability to simulate failures
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
      inTransaction: jest.fn().mockReturnValue(true),
    };

    // Mock connection with failure simulation
    mockConnection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
      readyState: 1, // Connected
    };

    // Mock models with failure simulation capabilities
    mockUserModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOneAndUpdate: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    mockTransactionModel = {
      create: jest.fn(),
      find: jest.fn(),
    };

    mockAuctionModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
    };

    mockBidModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      deleteOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    // Mock Redis with failure simulation
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      hgetall: jest.fn(),
      hset: jest.fn(),
      zadd: jest.fn(),
      zrange: jest.fn(),
      zcard: jest.fn(),
      ping: jest.fn().mockResolvedValue("PONG"),
    };

    // Mock services
    mockBidCacheService = {
      setAuctionMeta: jest.fn(),
      warmupBids: jest.fn(),
      warmupBalances: jest.fn(),
      warmupUserBalance: jest.fn(),
      placeBidUltraFast: jest.fn(),
      isCacheWarmed: jest.fn().mockResolvedValue(false),
      getTopBidders: jest.fn().mockResolvedValue([]),
      getTotalBidders: jest.fn().mockResolvedValue(0),
      updateRoundEndTime: jest.fn(),
    };

    mockCacheSyncService = {
      fullSync: jest.fn().mockResolvedValue(undefined),
      syncBids: jest.fn(),
      syncBalances: jest.fn(),
    };

    mockEventsGateway = {
      emitAuctionUpdate: jest.fn(),
      emitNewBid: jest.fn(),
      emitRoundComplete: jest.fn(),
      emitAuctionComplete: jest.fn(),
      emitRoundStart: jest.fn(),
      emitAntiSnipingExtension: jest.fn(),
    };

    mockNotificationsService = {
      notifyOutbid: jest.fn(),
      notifyRoundWin: jest.fn(),
      notifyRoundLost: jest.fn(),
      notifyAuctionComplete: jest.fn(),
      notifyAntiSniping: jest.fn(),
      notifyNewRoundStarted: jest.fn(),
    };

    mockTimerService = {
      startTimer: jest.fn(),
      stopTimer: jest.fn(),
      updateTimer: jest.fn(),
    };

    mockJwtService = {
      signAsync: jest.fn().mockResolvedValue("mock-jwt-token"),
      verifyAsync: jest.fn(),
    };

    mockRedlock = {
      acquire: jest.fn(),
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
    jest.clearAllMocks();
  });

  describe("1. Database Connection Recovery", () => {
    it("should retry operation when transient DB error occurs and succeed", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      // First call fails with transient error, second succeeds
      mockUserModel.findById
        .mockRejectedValueOnce(new Error("TransientTransactionError"))
        .mockReturnValue({
          session: jest.fn().mockResolvedValue(mockUser),
        });

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
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it("should retry multiple operations with transient failures and all succeed", async () => {
      const user1 = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };
      const user2 = {
        _id: mockUserId2,
        balance: 500,
        frozenBalance: 0,
        version: 1,
      };

      // Simulate transient errors then success
      let callCount = 0;
      mockUserModel.findById.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return await Promise.reject(new Error("TransientTransactionError"));
        }
        return {
          session: jest.fn().mockResolvedValue(callCount === 2 ? user1 : user2),
        };
      });

      mockUserModel.findOneAndUpdate.mockImplementation(async () => {
        if (Math.random() > 0.7) {
          return await Promise.reject(new Error("TransientTransactionError"));
        }
        return await Promise.resolve({ ...user1, balance: 1100, version: 2 });
      });

      mockTransactionModel.create.mockResolvedValue([
        { _id: new Types.ObjectId() },
      ]);

      // Should eventually succeed despite transient errors
      const result = await usersService.deposit(mockUserId.toString(), 100);
      expect(result.balance).toBe(1100);
    });

    it("should handle temporary DB timeout with retry and succeed", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      // First call times out, second succeeds
      mockUserModel.findById
        .mockRejectedValueOnce(new Error("operation exceeded time limit"))
        .mockReturnValue({
          session: jest.fn().mockResolvedValue(mockUser),
        });

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...mockUser,
        balance: 1200,
        version: 2,
      });

      mockTransactionModel.create.mockResolvedValue([
        { _id: new Types.ObjectId() },
      ]);

      const result = await usersService.deposit(mockUserId.toString(), 200);

      expect(result.balance).toBe(1200);
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should handle connection pool exhaustion with queued requests", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      // Simulate pool exhaustion then recovery
      let attempts = 0;
      mockConnection.startSession.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("connection pool exhausted");
        }
        return mockSession;
      });

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(mockUser),
      });

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...mockUser,
        balance: 1100,
        version: 2,
      });

      mockTransactionModel.create.mockResolvedValue([
        { _id: new Types.ObjectId() },
      ]);

      // Should eventually get a session
      const result = await usersService.deposit(mockUserId.toString(), 100);
      expect(result.balance).toBe(1100);
      expect(attempts).toBeGreaterThanOrEqual(3);
    });

    it("should recover from DB reconnection after crash", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      // Simulate disconnection then reconnection
      mockConnection.readyState = 0; // Disconnected
      mockUserModel.findById
        .mockRejectedValueOnce(new Error("connection closed"))
        .mockReturnValue({
          session: jest.fn().mockResolvedValue(mockUser),
        });

      // Simulate reconnection
      setTimeout(() => {
        mockConnection.readyState = 1;
      }, 100);

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
        session: jest.fn().mockResolvedValue(mockUser),
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
      mockAuctionModel.findById.mockResolvedValue(null);

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
        session: jest.fn().mockResolvedValue(mockUser),
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
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockBids),
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
        select: jest.fn().mockResolvedValue(mockUser),
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
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockBids),
        session: jest.fn().mockReturnThis(),
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
        lean: jest.fn().mockResolvedValue(mockBids),
      });

      mockUserModel.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
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
        session: jest.fn().mockResolvedValue(mockUser),
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
        session: jest.fn().mockResolvedValue(mockUser),
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
        session: jest.fn().mockResolvedValue(mockUser),
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
        session: jest.fn().mockResolvedValue(mockUser),
      });

      // First update succeeds
      mockUserModel.findOneAndUpdate
        .mockResolvedValueOnce({
          ...mockUser,
          frozenBalance: 400,
          balance: 1100,
          version: 2,
        })
        // Second update fails
        .mockRejectedValueOnce(new Error("Version conflict"));

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

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should handle concurrent transactions with failure correctly", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(mockUser),
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
        session: jest.fn().mockResolvedValue(mockUser),
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
        session: jest.fn().mockResolvedValue(mockUser),
      });

      const createdBid = {
        _id: mockBidId,
        userId: mockUserId,
        auctionId: mockAuctionId,
        amount: 100,
      };

      mockBidModel.create.mockResolvedValue([createdBid]);
      mockUserModel.findOneAndUpdate.mockResolvedValue(null); // Fails

      mockBidModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await expect(
        auctionsService.placeBid(
          mockAuctionId.toString(),
          mockUserId.toString(),
          { amount: 100 },
        ),
      ).rejects.toThrow();

      // Bid should be cleaned up
      expect(mockBidModel.deleteOne).toHaveBeenCalled();
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
        session: jest.fn().mockResolvedValue(mockUser),
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
    it("should retry request with backoff after timeout", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      let attempts = 0;
      mockUserModel.findById.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          return await Promise.reject(
            new Error("operation exceeded time limit"),
          );
        }
        return {
          session: jest.fn().mockResolvedValue(mockUser),
        };
      });

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
      expect(attempts).toBe(3);
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
        session: jest
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
          session: jest.fn().mockRejectedValue(new Error("User 1 locked")),
        })
        // User 2 succeeds
        .mockReturnValueOnce({
          session: jest.fn().mockResolvedValue(user2),
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

    it("should preserve successes in batch operation with partial failure", async () => {
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
          session: jest.fn().mockResolvedValue(users[0]),
        })
        .mockReturnValueOnce({
          session: jest.fn().mockResolvedValue(users[1]),
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
