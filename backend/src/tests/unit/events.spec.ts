import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { EventsGateway } from "@/modules/events/events.gateway";
import { BidCacheService } from "@/modules/redis/bid-cache.service";
import { redisClient } from "@/modules/redis/constants";
import { Server, Socket } from "socket.io";
import Redis from "ioredis";

describe("EventsGateway", () => {
  let gateway: EventsGateway;
  let mockRedis: jest.Mocked<Redis>;
  let mockBidCacheService: jest.Mocked<BidCacheService>;
  let mockJwtService: jest.Mocked<JwtService>;
  let mockServer: jest.Mocked<Server>;
  let mockSocket: jest.Mocked<Socket>;

  beforeEach(async () => {
    mockRedis = {
      duplicate: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Redis>;

    mockBidCacheService = {
      placeBidUltraFast: jest.fn(),
    } as unknown as jest.Mocked<BidCacheService>;

    mockJwtService = {
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    mockServer = {
      adapter: jest.fn(),
      on: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      sockets: {
        adapter: {
          rooms: new Map(),
        },
      },
    } as unknown as jest.Mocked<Server>;

    mockSocket = {
      id: "socket-123",
      on: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      userId: undefined,
      username: undefined,
    } as unknown as jest.Mocked<Socket>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        {
          provide: redisClient,
          useValue: mockRedis,
        },
        {
          provide: BidCacheService,
          useValue: mockBidCacheService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Gateway Initialization", () => {
    it("should be defined", () => {
      expect(gateway).toBeDefined();
    });

    it("should setup server and Redis adapter", () => {
      gateway.setServer(mockServer);

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(2);
      expect(mockServer.adapter).toHaveBeenCalled();
      expect(mockServer.on).toHaveBeenCalledWith(
        "connection",
        expect.any(Function),
      );
    });

    it("should setup connection handlers on client connect", () => {
      gateway.setServer(mockServer);

      const connCall = mockServer.on.mock.calls.find(
        (call) => call[0] === "connection",
      );
      const connectionHandler = connCall ? (connCall[1] as (socket: any) => void) : undefined;

      connectionHandler?.(mockSocket);

      expect(mockSocket.on).toHaveBeenCalledWith(
        "disconnect",
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        "join-auction",
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        "leave-auction",
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith("auth", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith(
        "place-bid",
        expect.any(Function),
      );
    });
  });

  describe("Authentication", () => {
    let authHandler: (token: string) => void;

    beforeEach(() => {
      gateway.setServer(mockServer);
      const connCall = mockServer.on.mock.calls.find(
        (call) => call[0] === "connection",
      );
      const connectionHandler = connCall ? (connCall[1] as (socket: any) => void) : undefined;
      connectionHandler?.(mockSocket);

      const authCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "auth",
      );
      authHandler = authCall ? (authCall[1] as (token: string) => void) : (() => {});
    });

    it("should authenticate socket with valid JWT", () => {
      mockJwtService.verify.mockReturnValue({
        sub: "user123",
        username: "testuser",
      });

      authHandler("valid_token");

      expect(mockJwtService.verify).toHaveBeenCalledWith("valid_token");
      expect((mockSocket as any).userId).toBe("user123");
      expect((mockSocket as any).username).toBe("testuser");
      expect(mockSocket.emit).toHaveBeenCalledWith("auth-response", {
        success: true,
        userId: "user123",
      });
    });

    it("should reject invalid JWT token", () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error("Invalid token");
      });

      authHandler("invalid_token");

      expect(mockSocket.emit).toHaveBeenCalledWith("auth-response", {
        success: false,
        error: "Invalid or expired token",
      });
      expect((mockSocket as any).userId).toBeUndefined();
    });

    it("should reject expired token", () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error("Token expired");
      });

      authHandler("expired_token");

      expect(mockSocket.emit).toHaveBeenCalledWith("auth-response", {
        success: false,
        error: "Invalid or expired token",
      });
    });
  });

  describe("Room Management", () => {
    let joinHandler: (auctionId: string) => void;
    let leaveHandler: (auctionId: string) => void;
    let disconnectHandler: () => void;

    beforeEach(() => {
      gateway.setServer(mockServer);
      const connCall = mockServer.on.mock.calls.find(
        (call) => call[0] === "connection",
      );
      const connectionHandler = connCall ? (connCall[1] as (socket: any) => void) : undefined;
      connectionHandler?.(mockSocket);

      const joinCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "join-auction",
      );
      joinHandler = joinCall ? (joinCall[1] as (auctionId: string) => void) : (() => {});
      const leaveCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "leave-auction",
      );
      leaveHandler = leaveCall ? (leaveCall[1] as (auctionId: string) => void) : (() => {});
      const disconnectCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "disconnect",
      );
      disconnectHandler = disconnectCall ? (disconnectCall[1] as () => void) : (() => {});
    });

    it("should join auction room", () => {
      joinHandler("auction123");

      expect(mockSocket.join).toHaveBeenCalledWith("auction:auction123");
      expect(mockSocket.emit).toHaveBeenCalledWith("join-auction-response", {
        success: true,
      });
    });

    it("should leave auction room", () => {
      joinHandler("auction123");
      leaveHandler("auction123");

      expect(mockSocket.leave).toHaveBeenCalledWith("auction:auction123");
      expect(mockSocket.emit).toHaveBeenCalledWith("leave-auction-response", {
        success: true,
      });
    });

    it("should clean up client on disconnect", () => {
      joinHandler("auction123");
      joinHandler("auction456");

      disconnectHandler();

      // Client should be removed from tracking
      expect(mockSocket.id).toBe("socket-123");
    });

    it("should handle multiple clients in same auction", () => {
      const mockSocket2 = {
        id: "socket-456",
        on: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        emit: jest.fn(),
        userId: undefined,
        username: undefined,
      } as unknown as jest.Mocked<Socket>;

      const connCall = mockServer.on.mock.calls.find(
        (call) => call[0] === "connection",
      );
      const connectionHandler = connCall ? (connCall[1] as (socket: any) => void) : undefined;
      connectionHandler?.(mockSocket2);

      const joinCall2 = mockSocket2.on.mock.calls.find(
        (call) => call[0] === "join-auction",
      );
      const joinHandler2 = joinCall2 ? (joinCall2[1] as (auctionId: string) => void) : (() => {});

      joinHandler("auction123");
      joinHandler2("auction123");

      expect(mockSocket.join).toHaveBeenCalledWith("auction:auction123");
      expect(mockSocket2.join).toHaveBeenCalledWith("auction:auction123");
    });
  });

  describe("Bid Placement via WebSocket", () => {
    let placeBidHandler: (payload: any) => Promise<void>;

    beforeEach(() => {
      gateway.setServer(mockServer);
      const connCall = mockServer.on.mock.calls.find(
        (call) => call[0] === "connection",
      );
      const connectionHandler = connCall ? (connCall[1] as (socket: any) => void) : undefined;
      connectionHandler?.(mockSocket);

      const placeBidCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "place-bid",
      );
      placeBidHandler = placeBidCall ? (placeBidCall[1] as (payload: any) => Promise<void>) : (async () => {});
    });

    it("should reject bid without authentication", async () => {
      (mockSocket as any).userId = undefined;

      await placeBidHandler({ auctionId: "auction123", amount: 1000 });

      expect(mockSocket.emit).toHaveBeenCalledWith("bid-response", {
        success: false,
        error: "Not authenticated. Call 'auth' event first.",
      });
      expect(mockBidCacheService.placeBidUltraFast).not.toHaveBeenCalled();
    });

    it("should reject bid with invalid payload", async () => {
      (mockSocket as any).userId = "user123";

      await placeBidHandler({ auctionId: "auction123", amount: -100 });

      expect(mockSocket.emit).toHaveBeenCalledWith("bid-response", {
        success: false,
        error:
          "Invalid payload. Required: { auctionId: string, amount: number }",
      });
    });

    it("should reject bid with missing auctionId", async () => {
      (mockSocket as any).userId = "user123";

      await placeBidHandler({ amount: 1000 });

      expect(mockSocket.emit).toHaveBeenCalledWith("bid-response", {
        success: false,
        error:
          "Invalid payload. Required: { auctionId: string, amount: number }",
      });
    });

    it("should place bid successfully", async () => {
      (mockSocket as any).userId = "user123";

      mockBidCacheService.placeBidUltraFast.mockResolvedValue({
        success: true,
        newAmount: 1500,
        previousAmount: 1000,
        frozenDelta: 500,
        isNewBid: false,
        roundEndTime: Date.now() + 60000,
      });

      await placeBidHandler({ auctionId: "auction123", amount: 1500 });

      expect(mockBidCacheService.placeBidUltraFast).toHaveBeenCalledWith(
        "auction123",
        "user123",
        1500,
      );
      expect(mockSocket.emit).toHaveBeenCalledWith("bid-response", {
        success: true,
        amount: 1500,
        previousAmount: 1000,
        isNewBid: false,
      });
    });

    it("should broadcast new bid to auction room", async () => {
      (mockSocket as any).userId = "user123";

      mockBidCacheService.placeBidUltraFast.mockResolvedValue({
        success: true,
        newAmount: 1500,
        previousAmount: 1000,
        frozenDelta: 500,
        isNewBid: false,
        roundEndTime: Date.now() + 60000,
      });

      mockServer.sockets.adapter.rooms.set("auction:auction123", new Set());

      await placeBidHandler({ auctionId: "auction123", amount: 1500 });

      expect(mockServer.to).toHaveBeenCalledWith("auction:auction123");
      expect(mockServer.emit).toHaveBeenCalledWith(
        "new-bid",
        expect.objectContaining({
          auctionId: "auction123",
          amount: 1500,
          isIncrease: true,
        }),
      );
    });

    it("should handle bid placement errors", async () => {
      (mockSocket as any).userId = "user123";

      mockBidCacheService.placeBidUltraFast.mockResolvedValue({
        success: false,
        error: "Insufficient balance",
        previousAmount: 1000,
      });

      await placeBidHandler({ auctionId: "auction123", amount: 5000 });

      expect(mockSocket.emit).toHaveBeenCalledWith("bid-response", {
        success: false,
        error: "Insufficient balance",
        needsWarmup: undefined,
      });
    });

    it("should indicate warmup needed", async () => {
      (mockSocket as any).userId = "user123";

      mockBidCacheService.placeBidUltraFast.mockResolvedValue({
        success: false,
        error: "Cache not warmed",
        needsWarmup: true,
        previousAmount: 0,
      });

      await placeBidHandler({ auctionId: "auction123", amount: 1500 });

      expect(mockSocket.emit).toHaveBeenCalledWith("bid-response", {
        success: false,
        error: "Cache not warmed",
        needsWarmup: true,
      });
    });

    it("should handle internal server errors", async () => {
      (mockSocket as any).userId = "user123";

      mockBidCacheService.placeBidUltraFast.mockRejectedValue(
        new Error("Redis connection failed"),
      );

      await placeBidHandler({ auctionId: "auction123", amount: 1500 });

      expect(mockSocket.emit).toHaveBeenCalledWith("bid-response", {
        success: false,
        error: "Internal server error",
      });
    });
  });

  describe("Event Broadcasting", () => {
    beforeEach(() => {
      gateway.setServer(mockServer);
    });

    it("should emit auction update", () => {
      const auction = {
        _id: { toString: () => "auction123" },
        status: "active",
        currentRound: 2,
        rounds: [
          { roundNumber: 1, itemsCount: 5 },
          { roundNumber: 2, itemsCount: 3 },
        ],
      } as any;

      gateway.emitAuctionUpdate(auction);

      expect(mockServer.to).toHaveBeenCalledWith("auction:auction123");
      expect(mockServer.emit).toHaveBeenCalledWith("auction-update", {
        id: auction._id,
        status: "active",
        currentRound: 2,
        rounds: auction.rounds,
      });
    });

    it("should emit new bid event", () => {
      gateway.emitNewBid("auction123", {
        amount: 1500,
        timestamp: new Date(),
        isIncrease: true,
      });

      expect(mockServer.to).toHaveBeenCalledWith("auction:auction123");
      expect(mockServer.emit).toHaveBeenCalledWith(
        "new-bid",
        expect.objectContaining({
          auctionId: "auction123",
          amount: 1500,
          isIncrease: true,
        }),
      );
    });

    it("should emit anti-sniping extension", () => {
      const auction = {
        _id: { toString: () => "auction123" },
        currentRound: 1,
        rounds: [{ roundNumber: 1, endTime: new Date() }],
      } as any;

      gateway.emitAntiSnipingExtension(auction, 2);

      expect(mockServer.to).toHaveBeenCalledWith("auction:auction123");
      expect(mockServer.emit).toHaveBeenCalledWith(
        "anti-sniping",
        expect.objectContaining({
          auctionId: auction._id,
          roundNumber: 1,
          extensionCount: 2,
        }),
      );
    });

    it("should emit round start", () => {
      const auction = {
        _id: { toString: () => "auction123" },
        rounds: [
          {
            roundNumber: 1,
            itemsCount: 5,
            startTime: new Date(),
            endTime: new Date(),
          },
        ],
      } as any;

      gateway.emitRoundStart(auction, 1);

      expect(mockServer.to).toHaveBeenCalledWith("auction:auction123");
      expect(mockServer.emit).toHaveBeenCalledWith(
        "round-start",
        expect.objectContaining({
          auctionId: auction._id,
          roundNumber: 1,
          itemsCount: 5,
        }),
      );
    });

    it("should emit round complete with winners", () => {
      const auction = {
        _id: { toString: () => "auction123" },
      } as any;

      const winners = [
        { amount: 1500, itemNumber: 1 },
        { amount: 1400, itemNumber: 2 },
      ] as any;

      gateway.emitRoundComplete(auction, 1, winners);

      expect(mockServer.to).toHaveBeenCalledWith("auction:auction123");
      expect(mockServer.emit).toHaveBeenCalledWith(
        "round-complete",
        expect.objectContaining({
          auctionId: auction._id,
          roundNumber: 1,
          winnersCount: 2,
          winners: expect.arrayContaining([
            { amount: 1500, itemNumber: 1 },
            { amount: 1400, itemNumber: 2 },
          ]),
        }),
      );
    });

    it("should emit auction complete", () => {
      const auction = {
        _id: { toString: () => "auction123" },
        endTime: new Date(),
        rounds: [{}, {}, {}],
      } as any;

      gateway.emitAuctionComplete(auction);

      expect(mockServer.to).toHaveBeenCalledWith("auction:auction123");
      expect(mockServer.emit).toHaveBeenCalledWith(
        "auction-complete",
        expect.objectContaining({
          auctionId: auction._id,
          totalRounds: 3,
        }),
      );
    });

    it("should emit countdown updates", () => {
      const data = {
        auctionId: "auction123",
        roundNumber: 1,
        timeLeftSeconds: 45,
        roundEndTime: new Date().toISOString(),
        isUrgent: true,
        serverTime: new Date().toISOString(),
      };

      gateway.emitCountdown("auction123", data);

      expect(mockServer.to).toHaveBeenCalledWith("auction:auction123");
      expect(mockServer.emit).toHaveBeenCalledWith("countdown", data);
    });

    it("should emit global events", () => {
      gateway.emitGlobal("system-maintenance", { message: "Maintenance mode" });

      expect(mockServer.emit).toHaveBeenCalledWith("system-maintenance", {
        message: "Maintenance mode",
      });
    });

    it("should not emit if server not set", () => {
      const newGateway = new EventsGateway(
        mockRedis,
        mockBidCacheService,
        mockJwtService,
      );

      newGateway.emitNewBid("auction123", {
        amount: 1500,
        timestamp: new Date(),
        isIncrease: true,
      });

      // Should not throw and should not call server methods
      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    let placeBidHandler: (payload: any) => Promise<void>;
    let joinHandler: (auctionId: string) => void;
    let connectionHandler: ((socket: any) => void) | undefined;

    beforeEach(() => {
      gateway.setServer(mockServer);
    });

    it("should handle rapid bid placement", async () => {
      const connCall = mockServer.on.mock.calls.find(
        (call) => call[0] === "connection",
      );
      const connectionHandler = connCall ? (connCall[1] as (socket: any) => void) : undefined;
      connectionHandler?.(mockSocket);

      const placeBidCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "place-bid",
      );
      placeBidHandler = placeBidCall ? (placeBidCall[1] as (payload: any) => Promise<void>) : (async () => {});

      (mockSocket as any).userId = "user123";

      mockBidCacheService.placeBidUltraFast.mockResolvedValue({
        success: true,
        newAmount: 1500,
        previousAmount: 1000,
        frozenDelta: 500,
        isNewBid: false,
        roundEndTime: Date.now() + 60000,
      });

      // Place multiple bids rapidly
      await Promise.all([
        placeBidHandler({ auctionId: "auction123", amount: 1100 }),
        placeBidHandler({ auctionId: "auction123", amount: 1200 }),
        placeBidHandler({ auctionId: "auction123", amount: 1300 }),
      ]);

      expect(mockBidCacheService.placeBidUltraFast).toHaveBeenCalledTimes(3);
    });

    it("should handle zero or negative amounts", async () => {
      const connCall = mockServer.on.mock.calls.find(
        (call) => call[0] === "connection",
      );
      const connectionHandler = connCall ? (connCall[1] as (socket: any) => void) : undefined;
      connectionHandler?.(mockSocket);

      const placeBidCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === "place-bid",
      );
      placeBidHandler = placeBidCall ? (placeBidCall[1] as (payload: any) => Promise<void>) : (async () => {});

      (mockSocket as any).userId = "user123";

      await placeBidHandler({ auctionId: "auction123", amount: 0 });

      expect(mockSocket.emit).toHaveBeenCalledWith("bid-response", {
        success: false,
        error:
          "Invalid payload. Required: { auctionId: string, amount: number }",
      });
    });

    it("should handle empty auction room broadcasts", () => {
      mockServer.sockets.adapter.rooms.set("auction:empty123", new Set());

      gateway.emitNewBid("empty123", {
        amount: 1500,
        timestamp: new Date(),
        isIncrease: true,
      });

      expect(mockServer.to).toHaveBeenCalledWith("auction:empty123");
    });
  });
});
