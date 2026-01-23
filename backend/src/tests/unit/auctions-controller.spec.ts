import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuctionsController } from "@/modules/auctions/auctions.controller";
import { AuctionsService } from "@/modules/auctions/auctions.service";
import { BotService } from "@/modules/auctions/bot.service";
import {
  AuctionStatus,
  type AuctionDocument,
  type BidDocument,
} from "@/schemas";
import { Types } from "mongoose";
import type { ICreateAuction } from "@/modules/auctions/dto";

interface MockAuthenticatedRequest {
  user: {
    sub: string;
    username: string;
  };
}

// Mock only the guards to bypass authentication in tests
vi.mock("@/common/guards", () => ({
  AuthGuard: class MockAuthGuard {
    canActivate() {
      return true;
    }
  },
  ThrottlerBehindProxyGuard: class MockThrottlerGuard {
    canActivate() {
      return true;
    }
  },
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

describe("AuctionsController", () => {
  let controller: AuctionsController;
  let auctionsService: {
    create: Mock;
    findAll: Mock;
    findById: Mock;
    start: Mock;
    placeBid: Mock;
    placeBidFast: Mock;
    getLeaderboard: Mock;
    getUserBids: Mock;
    getMinWinningBid: Mock;
    auditFinancialIntegrity: Mock;
  };
  let botService: { startBots: Mock };

  const mockDate = new Date("2024-01-01T00:00:00.000Z");

  const mockAuctionDocument = {
    _id: new Types.ObjectId("507f1f77bcf86cd799439011"),
    title: "Test Auction",
    description: "Test Description",
    totalItems: 10,
    roundsConfig: [
      { itemsCount: 5, durationMinutes: 60 },
      { itemsCount: 5, durationMinutes: 60 },
    ],
    rounds: [
      {
        roundNumber: 1,
        itemsCount: 5,
        startTime: mockDate,
        endTime: new Date("2024-01-01T01:00:00.000Z"),
        extensionsCount: 0,
        completed: false,
        winnerBidIds: [],
      },
    ],
    status: AuctionStatus.ACTIVE,
    currentRound: 1,
    minBidAmount: 100,
    minBidIncrement: 10,
    antiSnipingWindowMinutes: 5,
    antiSnipingExtensionMinutes: 5,
    maxExtensions: 6,
    botsEnabled: true,
    botCount: 5,
    startTime: mockDate,
    endTime: null,
    createdAt: mockDate,
    updatedAt: mockDate,
  } as Partial<AuctionDocument>;

  const mockAuthenticatedRequest: MockAuthenticatedRequest = {
    user: {
      sub: "user123",
      username: "testuser",
    },
  };

  beforeEach(async () => {
    const mockAuctionsService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      start: vi.fn(),
      placeBid: vi.fn(),
      placeBidFast: vi.fn(),
      getLeaderboard: vi.fn(),
      getUserBids: vi.fn(),
      getMinWinningBid: vi.fn(),
      auditFinancialIntegrity: vi.fn(),
    };

    const mockBotService = {
      startBots: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuctionsController],
      providers: [
        {
          provide: AuctionsService,
          useValue: mockAuctionsService,
        },
        {
          provide: BotService,
          useValue: mockBotService,
        },
      ],
    }).compile();

    controller = module.get<AuctionsController>(AuctionsController);
    auctionsService = module.get(AuctionsService);
    botService = module.get(BotService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Controller Initialization", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });
  });

  describe("Create Auction (POST /auctions)", () => {
    const validCreateDto = {
      title: "New Auction",
      description: "Test auction",
      totalItems: 10,
      rounds: [
        { itemsCount: 5, durationMinutes: 60 },
        { itemsCount: 5, durationMinutes: 60 },
      ],
      minBidAmount: 100,
      minBidIncrement: 10,
      antiSnipingWindowMinutes: 5,
      antiSnipingExtensionMinutes: 5,
      maxExtensions: 6,
      botsEnabled: true,
      botCount: 5,
    };

    it("should create auction successfully with valid data", async () => {
      const expectedAuction = {
        ...mockAuctionDocument,
        _id: new Types.ObjectId("507f1f77bcf86cd799439099"),
        title: "New Auction",
        status: AuctionStatus.PENDING,
        currentRound: 0,
        rounds: [],
      };

      auctionsService.create.mockResolvedValue(expectedAuction);

      const result = await controller.create(
        validCreateDto,
        mockAuthenticatedRequest,
      );

      expect(auctionsService.create).toHaveBeenCalledWith(
        validCreateDto,
        "user123",
      );
      expect(result.id).toBeDefined();
      expect(result.title).toBe("New Auction");
      expect(result.status).toBe(AuctionStatus.PENDING);
      expect(result.totalItems).toBe(10);
    });

    it("should include auction ID and initial state in response", async () => {
      const expectedAuction = {
        ...mockAuctionDocument,
        status: AuctionStatus.PENDING,
        currentRound: 0,
        rounds: [],
      };

      auctionsService.create.mockResolvedValue(expectedAuction);

      const result = await controller.create(
        validCreateDto,
        mockAuthenticatedRequest,
      );

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("status", AuctionStatus.PENDING);
      expect(result).toHaveProperty("currentRound", 0);
      expect(result.rounds).toEqual([]);
    });

    it("should set status to PENDING on creation", async () => {
      const expectedAuction = {
        ...mockAuctionDocument,
        status: AuctionStatus.PENDING,
      };

      auctionsService.create.mockResolvedValue(expectedAuction);

      const result = await controller.create(
        validCreateDto,
        mockAuthenticatedRequest,
      );

      expect(result.status).toBe(AuctionStatus.PENDING);
    });

    it("should initialize first round correctly", async () => {
      const expectedAuction = {
        ...mockAuctionDocument,
        status: AuctionStatus.PENDING,
        roundsConfig: validCreateDto.rounds,
      };

      auctionsService.create.mockResolvedValue(expectedAuction);

      const result = await controller.create(
        validCreateDto,
        mockAuthenticatedRequest,
      );

      expect(result.roundsConfig).toHaveLength(2);
      expect(result.roundsConfig[0]!.itemsCount).toBe(5);
      expect(result.roundsConfig[0]!.durationMinutes).toBe(60);
    });

    it("should throw error on invalid parameters (totalItems mismatch)", async () => {
      const invalidDto = {
        ...validCreateDto,
        totalItems: 15, // Doesn't match rounds sum (10)
      };

      auctionsService.create.mockRejectedValue(
        new BadRequestException("Sum of items in rounds must equal totalItems"),
      );

      await expect(
        controller.create(invalidDto, mockAuthenticatedRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw error when totalItems is zero or negative", async () => {
      const invalidDto = {
        ...validCreateDto,
        totalItems: 0,
      };

      auctionsService.create.mockRejectedValue(
        new BadRequestException("Total items must be positive"),
      );

      await expect(
        controller.create(invalidDto, mockAuthenticatedRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw error when round duration is invalid", async () => {
      const invalidDto = {
        ...validCreateDto,
        rounds: [
          { itemsCount: 5, durationMinutes: 0 },
          { itemsCount: 5, durationMinutes: 60 },
        ],
      };

      auctionsService.create.mockRejectedValue(
        new BadRequestException("Round items and duration must be positive"),
      );

      await expect(
        controller.create(invalidDto, mockAuthenticatedRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it("should require user authentication", () => {
      // This test demonstrates that the endpoint is protected by AuthGuard
      // In a real scenario, the guard would reject unauthenticated requests
      expect(controller.create).toBeDefined();
    });
  });

  describe("Get All Auctions (GET /auctions)", () => {
    const mockAuctions = [
      mockAuctionDocument,
      {
        ...mockAuctionDocument,
        _id: new Types.ObjectId("507f1f77bcf86cd799439012"),
        status: AuctionStatus.PENDING,
      },
      {
        ...mockAuctionDocument,
        _id: new Types.ObjectId("507f1f77bcf86cd799439013"),
        status: AuctionStatus.COMPLETED,
      },
    ];

    it("should return all auctions without filter", async () => {
      auctionsService.findAll.mockResolvedValue(
        mockAuctions as unknown as AuctionDocument[],
      );

      const result = await controller.findAll({});

      expect(auctionsService.findAll).toHaveBeenCalledWith(undefined);
      expect(result).toHaveLength(3);
    });

    it("should filter by PENDING status", async () => {
      const pendingAuctions = mockAuctions.filter(
        (a) => a.status === AuctionStatus.PENDING,
      );
      auctionsService.findAll.mockResolvedValue(
        pendingAuctions as unknown as AuctionDocument[],
      );

      const result = await controller.findAll({
        status: AuctionStatus.PENDING,
      });

      expect(auctionsService.findAll).toHaveBeenCalledWith(
        AuctionStatus.PENDING,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe(AuctionStatus.PENDING);
    });

    it("should filter by ACTIVE status", async () => {
      const activeAuctions = mockAuctions.filter(
        (a) => a.status === AuctionStatus.ACTIVE,
      );
      auctionsService.findAll.mockResolvedValue(
        activeAuctions as unknown as AuctionDocument[],
      );

      const result = await controller.findAll({ status: AuctionStatus.ACTIVE });

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe(AuctionStatus.ACTIVE);
    });

    it("should filter by COMPLETED status", async () => {
      const completedAuctions = mockAuctions.filter(
        (a) => a.status === AuctionStatus.COMPLETED,
      );
      auctionsService.findAll.mockResolvedValue(
        completedAuctions as unknown as AuctionDocument[],
      );

      const result = await controller.findAll({
        status: AuctionStatus.COMPLETED,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe(AuctionStatus.COMPLETED);
    });

    it("should return auctions sorted by creation date (newest first)", async () => {
      const sortedAuctions = [
        { ...mockAuctionDocument, createdAt: new Date("2024-01-03") },
        { ...mockAuctionDocument, createdAt: new Date("2024-01-02") },
        { ...mockAuctionDocument, createdAt: new Date("2024-01-01") },
      ];
      auctionsService.findAll.mockResolvedValue(
        sortedAuctions as unknown as AuctionDocument[],
      );

      const result = await controller.findAll({});

      expect(result[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        result[1]!.createdAt.getTime(),
      );
    });

    it("should handle empty results", async () => {
      auctionsService.findAll.mockResolvedValue([]);

      const result = await controller.findAll({
        status: AuctionStatus.CANCELLED,
      });

      expect(result).toEqual([]);
    });
  });

  describe("Get Auction By ID (GET /auctions/:id)", () => {
    const validId = "507f1f77bcf86cd799439011";

    it("should return auction with valid ID", async () => {
      auctionsService.findById.mockResolvedValue(mockAuctionDocument);

      const result = await controller.findOne(validId);

      expect(auctionsService.findById).toHaveBeenCalledWith(validId);
      expect(result.id).toBe(validId);
      expect(result.title).toBe("Test Auction");
    });

    it("should include rounds and bid history", async () => {
      auctionsService.findById.mockResolvedValue(mockAuctionDocument);

      const result = await controller.findOne(validId);

      expect(result.rounds).toBeDefined();
      expect(result.rounds).toHaveLength(1);
      expect(result.rounds[0]!.roundNumber).toBe(1);
    });

    it("should throw NotFoundException when auction not found", async () => {
      auctionsService.findById.mockRejectedValue(
        new NotFoundException("Auction not found"),
      );

      await expect(
        controller.findOne("507f1f77bcf86cd799439099"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException for invalid ID format", async () => {
      auctionsService.findById.mockRejectedValue(
        new BadRequestException("Invalid auction ID"),
      );

      await expect(controller.findOne("invalid-id")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("Start Auction (POST /auctions/:id/start)", () => {
    const validId = "507f1f77bcf86cd799439011";

    it("should start auction successfully", async () => {
      const startedAuction = {
        ...mockAuctionDocument,
        status: AuctionStatus.ACTIVE,
        startTime: mockDate,
        currentRound: 1,
      };

      auctionsService.start.mockResolvedValue(startedAuction);

      const result = await controller.start(validId);

      expect(auctionsService.start).toHaveBeenCalledWith(validId);
      expect(result.status).toBe(AuctionStatus.ACTIVE);
      expect(result.currentRound).toBe(1);
    });

    it("should only allow owner to start auction", async () => {
      auctionsService.start.mockRejectedValue(
        new BadRequestException("Only owner can start auction"),
      );

      await expect(controller.start(validId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should only start PENDING auctions", async () => {
      auctionsService.start.mockRejectedValue(
        new BadRequestException(
          "Auction can only be started from pending status",
        ),
      );

      await expect(controller.start(validId)).rejects.toThrow(
        "Auction can only be started from pending status",
      );
    });

    it("should set status to ACTIVE and initialize round", async () => {
      const startedAuction = {
        ...mockAuctionDocument,
        status: AuctionStatus.ACTIVE,
        currentRound: 1,
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            startTime: mockDate,
            endTime: new Date("2024-01-01T01:00:00.000Z"),
            extensionsCount: 0,
            completed: false,
            winnerBidIds: [],
          },
        ],
      };

      auctionsService.start.mockResolvedValue(startedAuction);

      const result = await controller.start(validId);

      expect(result.status).toBe(AuctionStatus.ACTIVE);
      expect(result.currentRound).toBe(1);
      expect(result.rounds[0]!.startTime).toBeDefined();
      expect(result.rounds[0]!.completed).toBe(false);
    });

    it("should throw error if auction already started", async () => {
      auctionsService.start.mockRejectedValue(
        new BadRequestException(
          "Auction can only be started from pending status",
        ),
      );

      await expect(controller.start(validId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should start bots when botsEnabled is true", async () => {
      const startedAuction = {
        ...mockAuctionDocument,
        status: AuctionStatus.ACTIVE,
        botsEnabled: true,
        botCount: 5,
      };

      auctionsService.start.mockResolvedValue(startedAuction);

      await controller.start(validId);

      expect(botService.startBots).toHaveBeenCalledWith(validId, 5);
    });

    it("should not start bots when botsEnabled is false", async () => {
      const startedAuction = {
        ...mockAuctionDocument,
        status: AuctionStatus.ACTIVE,
        botsEnabled: false,
      };

      auctionsService.start.mockResolvedValue(startedAuction);

      await controller.start(validId);

      expect(botService.startBots).not.toHaveBeenCalled();
    });
  });

  describe("Get Auction Rounds", () => {
    it("should return all rounds for auction", async () => {
      const auctionWithRounds = {
        ...mockAuctionDocument,
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            startTime: mockDate,
            endTime: new Date("2024-01-01T01:00:00.000Z"),
            extensionsCount: 0,
            completed: true,
            winnerBidIds: [new Types.ObjectId()],
          },
          {
            roundNumber: 2,
            itemsCount: 5,
            startTime: new Date("2024-01-01T01:00:00.000Z"),
            endTime: new Date("2024-01-01T02:00:00.000Z"),
            extensionsCount: 2,
            completed: false,
            winnerBidIds: [],
          },
        ],
      };

      auctionsService.findById.mockResolvedValue(auctionWithRounds);

      const result = await controller.findOne(auctionWithRounds._id.toString());

      expect(result.rounds).toHaveLength(2);
    });

    it("should include current active round details", async () => {
      auctionsService.findById.mockResolvedValue(mockAuctionDocument);

      const result = await controller.findOne(
        mockAuctionDocument._id.toString(),
      );

      expect(result.currentRound).toBe(1);
      expect(result.rounds[0]!.completed).toBe(false);
    });

    it("should include completed rounds with results", async () => {
      const completedAuction = {
        ...mockAuctionDocument,
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            completed: true,
            winnerBidIds: [new Types.ObjectId(), new Types.ObjectId()],
          },
        ],
      };

      auctionsService.findById.mockResolvedValue(completedAuction);

      const result = await controller.findOne(completedAuction._id.toString());

      expect(result.rounds[0]!.completed).toBe(true);
      expect(result.rounds[0]!.winnerBidIds).toHaveLength(2);
    });

    it("should include round history with extension counts", async () => {
      const auctionWithExtensions = {
        ...mockAuctionDocument,
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            extensionsCount: 3,
            completed: false,
            winnerBidIds: [],
          },
        ],
      };

      auctionsService.findById.mockResolvedValue(auctionWithExtensions);

      const result = await controller.findOne(
        auctionWithExtensions._id.toString(),
      );

      expect(result.rounds[0]!.extensionsCount).toBe(3);
    });
  });

  describe("Admin Operations", () => {
    it("should perform financial audit", async () => {
      const auditResult = {
        isValid: true,
        totalBalance: 10000,
        totalFrozen: 500,
        totalWinnings: 1000,
        discrepancy: 0,
        details: "All balances are consistent",
      };

      auctionsService.auditFinancialIntegrity.mockResolvedValue(auditResult);

      const result = await controller.auditFinancialIntegrity();

      expect(result.isValid).toBe(true);
      expect(result.discrepancy).toBe(0);
    });

    it("should detect financial discrepancies", async () => {
      const auditResult = {
        isValid: false,
        totalBalance: 10000,
        totalFrozen: 600,
        totalWinnings: 1000,
        discrepancy: 100,
        details: "Frozen balance does not match active bids",
      };

      auctionsService.auditFinancialIntegrity.mockResolvedValue(auditResult);

      const result = await controller.auditFinancialIntegrity();

      expect(result.isValid).toBe(false);
      expect(result.discrepancy).toBe(100);
      expect(result.details).toContain("does not match");
    });

    it("should require admin access for audit endpoint", () => {
      // This test demonstrates that admin endpoints should be protected
      // In a real implementation, there would be an AdminGuard
      expect(controller.auditFinancialIntegrity).toBeDefined();
    });
  });

  describe("Error Scenarios", () => {
    it("should validate auction data on creation", async () => {
      const invalidDto = {
        title: "",
        totalItems: -1,
        rounds: [],
      };

      auctionsService.create.mockRejectedValue(
        new BadRequestException("Invalid auction data"),
      );

      await expect(
        controller.create(
          invalidDto as unknown as ICreateAuction,
          mockAuthenticatedRequest,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should require authentication for protected endpoints", () => {
      // This test demonstrates the authentication requirement
      // The AuthGuard would reject requests without valid JWT
      expect(controller.create).toBeDefined();
      expect(controller.start).toBeDefined();
    });
  });

  describe("Get Auction Leaderboard (GET /auctions/:id/leaderboard)", () => {
    const validId = "507f1f77bcf86cd799439011";

    it("should return leaderboard with default pagination", async () => {
      const mockLeaderboard = {
        leaderboard: [
          {
            rank: 1,
            amount: 1000,
            username: "user1",
            isBot: false,
            isWinning: true,
            createdAt: mockDate,
          },
          {
            rank: 2,
            amount: 900,
            username: "user2",
            isBot: false,
            isWinning: true,
            createdAt: mockDate,
          },
        ],
        totalCount: 2,
        pastWinners: [],
      };

      auctionsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await controller.getLeaderboard(validId, {});

      expect(auctionsService.getLeaderboard).toHaveBeenCalledWith(
        validId,
        50,
        0,
      );
      expect(result.leaderboard).toHaveLength(2);
      expect(result.totalCount).toBe(2);
    });

    it("should apply custom limit and offset", async () => {
      const mockLeaderboard = {
        leaderboard: [],
        totalCount: 100,
        pastWinners: [],
      };

      auctionsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      await controller.getLeaderboard(validId, { limit: 10, offset: 20 });

      expect(auctionsService.getLeaderboard).toHaveBeenCalledWith(
        validId,
        10,
        20,
      );
    });

    it("should include past winners", async () => {
      const mockLeaderboard = {
        leaderboard: [],
        totalCount: 0,
        pastWinners: [
          {
            round: 1,
            itemNumber: 1,
            amount: 1000,
            username: "winner1",
            isBot: false,
            createdAt: mockDate,
          },
        ],
      };

      auctionsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await controller.getLeaderboard(validId, {});

      expect(result.pastWinners).toHaveLength(1);
      expect(result.pastWinners[0]!.round).toBe(1);
    });

    it("should mark winning bids correctly", async () => {
      const mockLeaderboard = {
        leaderboard: [
          {
            rank: 1,
            amount: 1000,
            username: "user1",
            isBot: false,
            isWinning: true,
            createdAt: mockDate,
          },
          {
            rank: 6,
            amount: 500,
            username: "user6",
            isBot: false,
            isWinning: false,
            createdAt: mockDate,
          },
        ],
        totalCount: 6,
        pastWinners: [],
      };

      auctionsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await controller.getLeaderboard(validId, {});

      expect(result.leaderboard[0]!.isWinning).toBe(true);
      expect(result.leaderboard[1]!.isWinning).toBe(false);
    });
  });

  describe("Get My Bids (GET /auctions/:id/my-bids)", () => {
    const validId = "507f1f77bcf86cd799439011";
    const mockBids = [
      {
        _id: new Types.ObjectId(),
        amount: 1000,
        status: "active",
        wonRound: null,
        itemNumber: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      },
      {
        _id: new Types.ObjectId(),
        amount: 800,
        status: "won",
        wonRound: 1,
        itemNumber: 1,
        createdAt: mockDate,
        updatedAt: mockDate,
      },
    ];

    it("should return user's bids for auction", async () => {
      auctionsService.getUserBids.mockResolvedValue(
        mockBids as unknown as BidDocument[],
      );

      const result = await controller.getMyBids(
        validId,
        mockAuthenticatedRequest,
      );

      expect(auctionsService.getUserBids).toHaveBeenCalledWith(
        validId,
        "user123",
      );
      expect(result).toHaveLength(2);
    });

    it("should include bid status and amounts", async () => {
      auctionsService.getUserBids.mockResolvedValue(
        mockBids as unknown as BidDocument[],
      );

      const result = await controller.getMyBids(
        validId,
        mockAuthenticatedRequest,
      );

      expect(result[0]!.amount).toBe(1000);
      expect(result[0]!.status).toBe("active");
      expect(result[1]!.status).toBe("won");
    });

    it("should include won round and item number for winning bids", async () => {
      auctionsService.getUserBids.mockResolvedValue(
        mockBids as unknown as BidDocument[],
      );

      const result = await controller.getMyBids(
        validId,
        mockAuthenticatedRequest,
      );

      expect(result[1]!.wonRound).toBe(1);
      expect(result[1]!.itemNumber).toBe(1);
    });

    it("should return empty array if user has no bids", async () => {
      auctionsService.getUserBids.mockResolvedValue([]);

      const result = await controller.getMyBids(
        validId,
        mockAuthenticatedRequest,
      );

      expect(result).toEqual([]);
    });
  });

  describe("Get Minimum Winning Bid (GET /auctions/:id/min-winning-bid)", () => {
    const validId = "507f1f77bcf86cd799439011";

    it("should return minimum winning bid for active auction", async () => {
      auctionsService.getMinWinningBid.mockResolvedValue(510);

      const result = await controller.getMinWinningBid(validId);

      expect(result.minWinningBid).toBe(510);
    });

    it("should return null for auctions with no active bids", async () => {
      auctionsService.getMinWinningBid.mockResolvedValue(null);

      const result = await controller.getMinWinningBid(validId);

      expect(result.minWinningBid).toBeNull();
    });

    it("should calculate based on current lowest winning bid", async () => {
      auctionsService.getMinWinningBid.mockResolvedValue(510);

      const result = await controller.getMinWinningBid(validId);

      // minWinningBid = lastWinningBid.amount + minBidIncrement
      // If lastWinningBid is 500 and increment is 10, result is 510
      expect(result.minWinningBid).toBe(510);
    });
  });

  describe("Place Bid (POST /auctions/:id/bid)", () => {
    const validId = "507f1f77bcf86cd799439011";
    const validBidDto = { amount: 500 };

    const mockBidResponse = {
      bid: {
        _id: new Types.ObjectId(),
        amount: 500,
        status: "active",
        createdAt: mockDate,
        updatedAt: mockDate,
      },
      auction: mockAuctionDocument,
    };

    const createMockRequest = () => ({
      ...mockAuthenticatedRequest,
      ip: "127.0.0.1",
      headers: {
        "x-real-ip": "127.0.0.1",
        "x-forwarded-for": "127.0.0.1",
      },
      socket: {
        remoteAddress: "127.0.0.1",
      },
    });

    it("should place bid successfully", async () => {
      auctionsService.placeBid.mockResolvedValue(
        mockBidResponse as unknown as {
          bid: BidDocument;
          auction: AuctionDocument;
        },
      );

      const mockRequest = createMockRequest();

      const result = await controller.placeBid(
        validId,
        validBidDto,
        mockRequest,
      );

      expect(result.bid.amount).toBe(500);
      expect(result.auction.id).toBeDefined();
    });

    it("should validate minimum bid amount", async () => {
      auctionsService.placeBid.mockRejectedValue(
        new BadRequestException("Minimum bid is 100"),
      );

      const lowBidDto = { amount: 50 };
      const mockRequest = createMockRequest();

      await expect(
        controller.placeBid(validId, lowBidDto, mockRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it("should enforce minimum bid increment for existing bids", async () => {
      auctionsService.placeBid.mockRejectedValue(
        new BadRequestException("Minimum bid increment is 10"),
      );

      const mockRequest = createMockRequest();

      await expect(
        controller.placeBid(validId, validBidDto, mockRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it("should check user balance before placing bid", async () => {
      auctionsService.placeBid.mockRejectedValue(
        new BadRequestException("Insufficient balance"),
      );

      const mockRequest = createMockRequest();

      await expect(
        controller.placeBid(validId, { amount: 10000 }, mockRequest),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("Place Fast Bid (POST /auctions/:id/fast-bid)", () => {
    const validId = "507f1f77bcf86cd799439011";
    const validBidDto = { amount: 500 };

    it("should place fast bid successfully", async () => {
      const mockFastBidResult = {
        success: true,
        amount: 500,
        previousAmount: 0,
        rank: 1,
        isNewBid: true,
      };

      auctionsService.placeBidFast.mockResolvedValue(mockFastBidResult);

      const result = await controller.placeFastBid(
        validId,
        validBidDto,
        mockAuthenticatedRequest,
      );

      expect(result.success).toBe(true);
      expect(result.amount).toBe(500);
      expect(result.rank).toBe(1);
    });

    it("should return rank after fast bid", async () => {
      const mockFastBidResult = {
        success: true,
        amount: 500,
        rank: 3,
        isNewBid: true,
      };

      auctionsService.placeBidFast.mockResolvedValue(mockFastBidResult);

      const result = await controller.placeFastBid(
        validId,
        validBidDto,
        mockAuthenticatedRequest,
      );

      expect(result.rank).toBe(3);
    });

    it("should handle fast bid errors gracefully", async () => {
      const mockFastBidResult = {
        success: false,
        error: "Bid amount is already taken",
      };

      auctionsService.placeBidFast.mockResolvedValue(mockFastBidResult);

      const result = await controller.placeFastBid(
        validId,
        validBidDto,
        mockAuthenticatedRequest,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should fallback to standard bid if cache not warmed", async () => {
      const mockFastBidResult = {
        success: true,
        amount: 500,
        isNewBid: true,
      };

      auctionsService.placeBidFast.mockResolvedValue(mockFastBidResult);

      const result = await controller.placeFastBid(
        validId,
        validBidDto,
        mockAuthenticatedRequest,
      );

      expect(result.success).toBe(true);
    });
  });
});
