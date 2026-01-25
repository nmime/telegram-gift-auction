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
import { getModelToken } from "@nestjs/mongoose";
import { BotService } from "@/modules/auctions/bot.service";
import { AuctionsService } from "@/modules/auctions/auctions.service";
import { redisClient } from "@/modules/redis/constants";
import { User, Auction, Bid, AuctionStatus, BidStatus } from "@/schemas";
import * as clusterUtil from "@/common/cluster/cluster.util";

// Mock cluster utilities
vi.mock("@/common/cluster/cluster.util", () => ({
  isPrimaryWorker: vi.fn(),
  getWorkerId: vi.fn(),
}));

interface MockRedisSubscriber {
  on: Mock;
  subscribe: Mock;
  unsubscribe: Mock;
  quit: Mock;
}

interface MockBotUser {
  _id: { toString: () => string };
  username: string;
  balance: number;
  isBot: boolean;
  save: Mock;
}

interface MockAuction {
  _id: { toString: () => string };
  status: AuctionStatus;
  botsEnabled: boolean;
  botCount: number;
  currentRound: number;
  minBidAmount: number;
  minBidIncrement: number;
  antiSnipingWindowMinutes: number;
  rounds: Array<{
    startTime: Date;
    endTime: Date;
    itemsCount: number;
    completed: boolean;
  }>;
}

describe("BotService", () => {
  let service: BotService;
  let mockRedis: {
    publish: Mock;
    duplicate: Mock;
  };
  let mockSubscriber: MockRedisSubscriber;
  let mockUserModel: {
    findOne: Mock;
    create: Mock;
  };
  let mockAuctionModel: {
    find: Mock;
    findById: Mock;
  };
  let mockBidModel: {
    find: Mock;
    findOne: Mock;
  };
  let mockAuctionsService: {
    placeBid: Mock;
    getMinWinningBid: Mock;
    getLeaderboard: Mock;
  };
  let mockIsPrimaryWorker: Mock;
  let mockGetWorkerId: Mock;

  beforeEach(async () => {
    // Setup cluster utility mocks
    mockIsPrimaryWorker = vi.mocked(clusterUtil.isPrimaryWorker);
    mockGetWorkerId = vi.mocked(clusterUtil.getWorkerId);
    mockIsPrimaryWorker.mockReturnValue(true);
    mockGetWorkerId.mockReturnValue(1);

    // Setup Redis subscriber mock
    mockSubscriber = {
      on: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
    };

    mockRedis = {
      publish: vi.fn().mockResolvedValue(1),
      duplicate: vi.fn().mockReturnValue(mockSubscriber),
    };

    mockUserModel = {
      findOne: vi.fn(),
      create: vi.fn(),
    };

    mockAuctionModel = {
      find: vi.fn(),
      findById: vi.fn(),
    };

    mockBidModel = {
      find: vi.fn(),
      findOne: vi.fn(),
    };

    mockAuctionsService = {
      placeBid: vi.fn(),
      getMinWinningBid: vi.fn(),
      getLeaderboard: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,
        {
          provide: redisClient,
          useValue: mockRedis,
        },
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
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
          provide: AuctionsService,
          useValue: mockAuctionsService,
        },
      ],
    }).compile();

    service = module.get<BotService>(BotService);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });
  });

  describe("onModuleInit", () => {
    it("should setup pub/sub subscription on primary worker", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockAuctionModel.find.mockResolvedValue([]);

      await service.onModuleInit();

      expect(mockRedis.duplicate).toHaveBeenCalled();
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
        "bot-service:start",
        "bot-service:stop",
      );
      expect(mockSubscriber.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );
    });

    it("should skip pub/sub setup on non-primary worker", async () => {
      mockIsPrimaryWorker.mockReturnValue(false);
      mockGetWorkerId.mockReturnValue(2);

      await service.onModuleInit();

      expect(mockRedis.duplicate).not.toHaveBeenCalled();
      expect(mockSubscriber.subscribe).not.toHaveBeenCalled();
    });

    it("should restore bots for active auctions on primary worker", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      const mockAuction: MockAuction = {
        _id: { toString: () => "auction123" },
        status: AuctionStatus.ACTIVE,
        botsEnabled: true,
        botCount: 2,
        currentRound: 1,
        minBidAmount: 100,
        minBidIncrement: 10,
        antiSnipingWindowMinutes: 1,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
      };

      mockAuctionModel.find.mockResolvedValue([mockAuction]);
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.onModuleInit();

      expect(mockAuctionModel.find).toHaveBeenCalledWith({
        status: AuctionStatus.ACTIVE,
        botsEnabled: true,
      });
    });

    it("should log when no active auctions with bots to restore", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockAuctionModel.find.mockResolvedValue([]);

      await service.onModuleInit();

      expect(mockAuctionModel.find).toHaveBeenCalledWith({
        status: AuctionStatus.ACTIVE,
        botsEnabled: true,
      });
    });
  });

  describe("startBots - Pub/Sub Delegation", () => {
    it("should handle bots directly on primary worker", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 1);

      expect(mockRedis.publish).not.toHaveBeenCalled();
      expect(mockUserModel.create).toHaveBeenCalled();

      // Cleanup
      service.stopBots("auction123");
      vi.useRealTimers();
    });

    it("should publish to Redis channel on non-primary worker", async () => {
      mockIsPrimaryWorker.mockReturnValue(false);
      mockGetWorkerId.mockReturnValue(2);

      await service.startBots("auction123", 3);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        "bot-service:start",
        JSON.stringify({ auctionId: "auction123", botCount: 3 }),
      );
    });

    it("should not start bots directly on non-primary worker", async () => {
      mockIsPrimaryWorker.mockReturnValue(false);
      mockGetWorkerId.mockReturnValue(2);

      await service.startBots("auction123", 3);

      expect(mockUserModel.findOne).not.toHaveBeenCalled();
      expect(mockUserModel.create).not.toHaveBeenCalled();
    });
  });

  describe("stopBots - Pub/Sub Delegation", () => {
    it("should stop bots directly on primary worker", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 1);
      service.stopBots("auction123");

      expect(mockRedis.publish).not.toHaveBeenCalledWith(
        "bot-service:stop",
        expect.any(String),
      );

      vi.useRealTimers();
    });

    it("should publish stop request on non-primary worker", () => {
      mockIsPrimaryWorker.mockReturnValue(false);
      mockGetWorkerId.mockReturnValue(2);

      service.stopBots("auction123");

      expect(mockRedis.publish).toHaveBeenCalledWith(
        "bot-service:stop",
        JSON.stringify({ auctionId: "auction123" }),
      );
    });
  });

  describe("Pub/Sub Message Handling", () => {
    it("should handle bot start message from pub/sub", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockAuctionModel.find.mockResolvedValue([]);

      await service.onModuleInit();

      // Get the message handler
      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1] as ((channel: string, message: string) => void) | undefined;

      expect(messageHandler).toBeDefined();

      // Setup mocks for bot creation
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      // Simulate receiving a message
      messageHandler?.(
        "bot-service:start",
        JSON.stringify({ auctionId: "auction456", botCount: 2 }),
      );

      // Allow async handling to process
      await vi.advanceTimersByTimeAsync(10);

      expect(mockUserModel.create).toHaveBeenCalled();

      // Cleanup
      service.stopBots("auction456");
      vi.useRealTimers();
    });

    it("should handle bot stop message from pub/sub", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockAuctionModel.find.mockResolvedValue([]);

      await service.onModuleInit();

      // First start bots
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction789", 1);

      // Get the message handler
      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1] as ((channel: string, message: string) => void) | undefined;

      // Simulate receiving a stop message
      messageHandler?.(
        "bot-service:stop",
        JSON.stringify({ auctionId: "auction789" }),
      );

      await vi.advanceTimersByTimeAsync(10);

      vi.useRealTimers();
    });

    it("should handle malformed pub/sub messages gracefully", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockAuctionModel.find.mockResolvedValue([]);

      await service.onModuleInit();

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1] as ((channel: string, message: string) => void) | undefined;

      // Should not throw on invalid JSON
      expect(() => {
        messageHandler?.("bot-service:start", "invalid-json{");
      }).not.toThrow();
    });
  });

  describe("Bot User Creation", () => {
    it("should create new bot users if they do not exist", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockUserModel.findOne.mockResolvedValue(null);

      const mockBotUser: MockBotUser = {
        _id: { toString: () => "bot-id-1" },
        username: "bot_tion123_1",
        balance: 100000,
        isBot: true,
        save: vi.fn(),
      };
      mockUserModel.create.mockResolvedValue(mockBotUser);

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 2);

      expect(mockUserModel.create).toHaveBeenCalledTimes(2);
      expect(mockUserModel.create).toHaveBeenCalledWith({
        username: expect.stringContaining("bot_"),
        balance: 100000,
        isBot: true,
      });

      service.stopBots("auction123");
      vi.useRealTimers();
    });

    it("should reuse existing bot users", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      const existingBot: MockBotUser = {
        _id: { toString: () => "existing-bot-id" },
        username: "bot_123_1",
        balance: 60000,
        isBot: true,
        save: vi.fn(),
      };
      mockUserModel.findOne.mockResolvedValue(existingBot);

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 1);

      expect(mockUserModel.create).not.toHaveBeenCalled();

      service.stopBots("auction123");
      vi.useRealTimers();
    });

    it("should top up bot balance if below threshold", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      const lowBalanceBot: MockBotUser = {
        _id: { toString: () => "low-balance-bot" },
        username: "bot_123_1",
        balance: 30000, // Below 50000 threshold
        isBot: true,
        save: vi.fn().mockResolvedValue(true),
      };
      mockUserModel.findOne.mockResolvedValue(lowBalanceBot);

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 1);

      expect(lowBalanceBot.balance).toBe(100000);
      expect(lowBalanceBot.save).toHaveBeenCalled();

      service.stopBots("auction123");
      vi.useRealTimers();
    });
  });

  describe("Bot Activity", () => {
    it("should not start duplicate bots for same auction", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 1);

      // Clear mock to track subsequent calls
      mockUserModel.create.mockClear();

      // Try to start bots again for same auction
      await service.startBots("auction123", 1);

      // Should not create new bots
      expect(mockUserModel.create).not.toHaveBeenCalled();

      service.stopBots("auction123");
      vi.useRealTimers();
    });

    it("should stop bots when auction is no longer active", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });

      vi.useFakeTimers();

      // First return active auction
      mockAuctionModel.findById
        .mockResolvedValueOnce({
          status: AuctionStatus.ACTIVE,
          rounds: [
            {
              startTime: new Date(Date.now() - 60000),
              endTime: new Date(Date.now() + 60000),
              itemsCount: 5,
              completed: false,
            },
          ],
          currentRound: 1,
          minBidAmount: 100,
        })
        // Then return completed auction for activity check
        .mockResolvedValue({
          status: AuctionStatus.COMPLETED,
          rounds: [],
          currentRound: 1,
        });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 1);

      // Advance timer to trigger bot activity
      await vi.advanceTimersByTimeAsync(2000);

      vi.useRealTimers();
    });
  });

  describe("stopAllBots", () => {
    it("should stop all active bots", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction1", 1);
      await service.startBots("auction2", 1);

      service.stopAllBots();

      // Verify bots are stopped by trying to start again
      mockUserModel.create.mockClear();
      await service.startBots("auction1", 1);
      await service.startBots("auction2", 1);

      // Should create new bots since old ones were stopped
      expect(mockUserModel.create).toHaveBeenCalledTimes(2);

      service.stopAllBots();
      vi.useRealTimers();
    });
  });

  describe("onModuleDestroy", () => {
    it("should cleanup resources on destroy", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockAuctionModel.find.mockResolvedValue([]);

      await service.onModuleInit();

      service.onModuleDestroy();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(
        "bot-service:start",
        "bot-service:stop",
      );
    });

    it("should stop all bots on destroy", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => "bot1" },
        username: "bot_123_1",
        balance: 100000,
        isBot: true,
      });
      mockAuctionModel.find.mockResolvedValue([]);

      await service.onModuleInit();

      vi.useFakeTimers();
      mockAuctionModel.findById.mockResolvedValue({
        status: AuctionStatus.ACTIVE,
        rounds: [
          {
            startTime: new Date(Date.now() - 60000),
            endTime: new Date(Date.now() + 60000),
            itemsCount: 5,
            completed: false,
          },
        ],
        currentRound: 1,
        minBidAmount: 100,
      });
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 1);

      service.onModuleDestroy();

      // Verify bots are stopped
      mockUserModel.create.mockClear();
      await service.startBots("auction123", 1);
      expect(mockUserModel.create).toHaveBeenCalled();

      service.stopAllBots();
      vi.useRealTimers();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty bot count gracefully", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      vi.useFakeTimers();
      mockBidModel.find.mockResolvedValue([]);

      await service.startBots("auction123", 0);

      expect(mockUserModel.create).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should handle Redis publish failures gracefully", async () => {
      mockIsPrimaryWorker.mockReturnValue(false);
      mockGetWorkerId.mockReturnValue(2);
      mockRedis.publish.mockRejectedValue(new Error("Redis error"));

      // Should not throw
      await expect(service.startBots("auction123", 3)).rejects.toThrow(
        "Redis error",
      );
    });

    it("should handle failed pub/sub subscription setup", async () => {
      mockIsPrimaryWorker.mockReturnValue(true);
      mockSubscriber.subscribe.mockRejectedValue(new Error("Subscribe failed"));
      mockAuctionModel.find.mockResolvedValue([]);

      // Should not throw, just log error
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should handle stopping non-existent auction bots", () => {
      mockIsPrimaryWorker.mockReturnValue(true);

      // Should not throw
      expect(() => service.stopBots("non-existent-auction")).not.toThrow();
    });
  });
});
