/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from "@nestjs/testing";
import { Types } from "mongoose";
import { JwtService } from "@nestjs/jwt";
import { BidsController } from "@/modules/bids/bids.controller";
import { BidsService } from "@/modules/bids/bids.service";
import { BidStatus, AuctionStatus } from "@/schemas";
import { AuthenticatedRequest, AuthGuard } from "@/common";
import { IBidResponse } from "@/modules/bids/dto";

describe("BidsController", () => {
  let controller: BidsController;
  let mockBidsService: jest.Mocked<BidsService>;

  const mockUserId = new Types.ObjectId("507f1f77bcf86cd799439011");
  const mockAuctionId = new Types.ObjectId("507f1f77bcf86cd799439012");
  const mockBidId = new Types.ObjectId("507f1f77bcf86cd799439013");

  const createMockRequest = (userId: string): AuthenticatedRequest => {
    return {
      user: {
        sub: userId,
        username: "testuser",
        telegramId: 123456789,
      },
    } as unknown as AuthenticatedRequest;
  };

  beforeEach(async () => {
    mockBidsService = {
      getByUser: jest.fn(),
      getByAuction: jest.fn(),
      getActiveByAuction: jest.fn(),
      countByAuction: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BidsController],
      providers: [
        {
          provide: BidsService,
          useValue: mockBidsService,
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
            signAsync: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<BidsController>(BidsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Controller Initialization", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });

    it("should have BidsService injected", () => {
      expect(mockBidsService).toBeDefined();
    });
  });

  describe("GET /bids/my", () => {
    describe("Successful Bid Retrieval", () => {
      it("should return all bids for authenticated user with populated auction", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: {
              _id: mockAuctionId,
              title: "Test Auction",
              status: AuctionStatus.ACTIVE,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            wonRound: null,
            itemNumber: null,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(mockBidsService.getByUser).toHaveBeenCalledWith(
          mockUserId.toString(),
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          id: mockBidId.toString(),
          auctionId: mockAuctionId.toString(),
          auction: {
            id: mockAuctionId.toString(),
            title: "Test Auction",
            status: AuctionStatus.ACTIVE,
          },
          amount: 100,
          status: BidStatus.ACTIVE,
        });
      });

      it("should return bids with unpopulated auction (ObjectId only)", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 50,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          id: mockBidId.toString(),
          auctionId: mockAuctionId.toString(),
          auction: null,
          amount: 50,
          status: BidStatus.ACTIVE,
        });
      });

      it("should return bids with auction as string", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId.toString(),
            userId: mockUserId,
            amount: 75,
            status: BidStatus.WON,
            wonRound: 2,
            itemNumber: 1,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          id: mockBidId.toString(),
          auctionId: mockAuctionId.toString(),
          auction: null,
          amount: 75,
          status: BidStatus.WON,
          wonRound: 2,
          itemNumber: 1,
        });
      });

      it("should return empty array when user has no bids", async () => {
        mockBidsService.getByUser.mockResolvedValue([]);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(mockBidsService.getByUser).toHaveBeenCalledWith(
          mockUserId.toString(),
        );
        expect(result).toEqual([]);
      });

      it("should return multiple bids with mixed auction formats", async () => {
        const bid1Id = new Types.ObjectId();
        const bid2Id = new Types.ObjectId();
        const auction1Id = new Types.ObjectId();
        const auction2Id = new Types.ObjectId();

        const mockBids = [
          {
            _id: bid1Id,
            auctionId: {
              _id: auction1Id,
              title: "Auction 1",
              status: AuctionStatus.ACTIVE,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
          {
            _id: bid2Id,
            auctionId: auction2Id,
            userId: mockUserId,
            amount: 200,
            status: BidStatus.WON,
            wonRound: 1,
            itemNumber: 3,
            createdAt: new Date("2024-01-15T11:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
          id: bid1Id.toString(),
          auctionId: auction1Id.toString(),
          auction: {
            id: auction1Id.toString(),
            title: "Auction 1",
            status: AuctionStatus.ACTIVE,
          },
          amount: 100,
          status: BidStatus.ACTIVE,
        });
        expect(result[1]).toMatchObject({
          id: bid2Id.toString(),
          auctionId: auction2Id.toString(),
          auction: null,
          amount: 200,
          status: BidStatus.WON,
          wonRound: 1,
          itemNumber: 3,
        });
      });
    });

    describe("Bid Status Handling", () => {
      it("should return bid with ACTIVE status", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.status).toBe(BidStatus.ACTIVE);
      });

      it("should return bid with WON status and wonRound", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 150,
            status: BidStatus.WON,
            wonRound: 3,
            itemNumber: 5,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]).toMatchObject({
          status: BidStatus.WON,
          wonRound: 3,
          itemNumber: 5,
        });
      });

      it("should return bid with LOST status", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 50,
            status: BidStatus.LOST,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.status).toBe(BidStatus.LOST);
        expect(result[0]?.wonRound).toBeUndefined();
      });

      it("should return bid with REFUNDED status", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 75,
            status: BidStatus.REFUNDED,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.status).toBe(BidStatus.REFUNDED);
      });

      it("should return bid with CANCELLED status", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 25,
            status: BidStatus.CANCELLED,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.status).toBe(BidStatus.CANCELLED);
      });
    });

    describe("Auction Status Handling", () => {
      it("should include ACTIVE auction status in populated auction", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: {
              _id: mockAuctionId,
              title: "Active Auction",
              status: AuctionStatus.ACTIVE,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.auction?.status).toBe(AuctionStatus.ACTIVE);
      });

      it("should include COMPLETED auction status in populated auction", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: {
              _id: mockAuctionId,
              title: "Completed Auction",
              status: AuctionStatus.COMPLETED,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.LOST,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result).toHaveLength(1);
        expect(result[0]?.auction?.status).toBe(AuctionStatus.COMPLETED);
      });

      it("should include CANCELLED auction status in populated auction", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: {
              _id: mockAuctionId,
              title: "Cancelled Auction",
              status: AuctionStatus.CANCELLED,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.CANCELLED,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.auction?.status).toBe(AuctionStatus.CANCELLED);
      });

      it("should include PENDING auction status in populated auction", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: {
              _id: mockAuctionId,
              title: "Pending Auction",
              status: AuctionStatus.PENDING,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.auction?.status).toBe(AuctionStatus.PENDING);
      });
    });

    describe("Optional Fields Handling", () => {
      it("should handle bid without wonRound and itemNumber", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]).toMatchObject({
          id: mockBidId.toString(),
          auctionId: mockAuctionId.toString(),
          amount: 100,
          status: BidStatus.ACTIVE,
        });
        expect(result[0]?.wonRound).toBeUndefined();
        expect(result[0]?.itemNumber).toBeUndefined();
      });

      it("should handle bid with wonRound but no itemNumber", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.WON,
            wonRound: 5,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]).toMatchObject({
          status: BidStatus.WON,
          wonRound: 5,
        });
        expect(result[0]?.itemNumber).toBeUndefined();
      });

      it("should handle bid with both wonRound and itemNumber", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.WON,
            wonRound: 3,
            itemNumber: 7,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]).toMatchObject({
          status: BidStatus.WON,
          wonRound: 3,
          itemNumber: 7,
        });
      });

      it("should preserve createdAt date", async () => {
        const createdDate = new Date("2024-01-15T14:30:00Z");
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: createdDate,
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.createdAt).toEqual(createdDate);
      });
    });

    describe("Response Format Validation", () => {
      it("should return IBidResponse[] type with all required fields", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: {
              _id: mockAuctionId,
              title: "Test Auction",
              status: AuctionStatus.ACTIVE,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result: IBidResponse[] = await controller.getMyBids(request);

        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("auctionId");
        expect(result[0]).toHaveProperty("auction");
        expect(result[0]).toHaveProperty("amount");
        expect(result[0]).toHaveProperty("status");
        expect(result[0]).toHaveProperty("createdAt");

        expect(typeof result[0]?.id).toBe("string");
        expect(typeof result[0]?.auctionId).toBe("string");
        expect(typeof result[0]?.amount).toBe("number");
        expect(typeof result[0]?.status).toBe("string");
        expect(result[0]?.createdAt).toBeInstanceOf(Date);
      });

      it("should ensure auction field has correct structure when populated", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: {
              _id: mockAuctionId,
              title: "Test Auction",
              status: AuctionStatus.ACTIVE,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.auction).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
          status: expect.any(String),
        });
      });

      it("should convert ObjectId to string for id fields", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.id).toBe(mockBidId.toString());
        expect(result[0]?.auctionId).toBe(mockAuctionId.toString());
        expect(typeof result[0]?.id).toBe("string");
        expect(typeof result[0]?.auctionId).toBe("string");
      });
    });

    describe("Large Dataset Handling", () => {
      it("should handle user with many bids efficiently", async () => {
        const mockBids = Array.from({ length: 100 }, (_, i) => ({
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(),
          userId: mockUserId,
          amount: 100 + i,
          status:
            i % 2 === 0
              ? BidStatus.ACTIVE
              : i % 3 === 0
                ? BidStatus.WON
                : BidStatus.LOST,
          wonRound: i % 3 === 0 ? i : undefined,
          itemNumber: i % 3 === 0 ? i * 2 : undefined,
          createdAt: new Date(`2024-01-${(i % 28) + 1}T10:00:00Z`),
        }));

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result).toHaveLength(100);
        expect(mockBidsService.getByUser).toHaveBeenCalledTimes(1);
      });

      it("should handle bids with various amounts correctly", async () => {
        const amounts = [1, 10, 100, 1000, 10000, 99999];
        const mockBids = amounts.map((amount, _i) => ({
          _id: new Types.ObjectId(),
          auctionId: mockAuctionId,
          userId: mockUserId,
          amount,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-15T10:00:00Z"),
        }));

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result).toHaveLength(amounts.length);
        result.forEach((bid, i) => {
          expect(bid.amount).toBe(amounts[i]);
        });
      });
    });

    describe("Error Handling", () => {
      it("should propagate service errors", async () => {
        const error = new Error("Database connection failed");
        mockBidsService.getByUser.mockRejectedValue(error);

        const request = createMockRequest(mockUserId.toString());

        await expect(controller.getMyBids(request)).rejects.toThrow(
          "Database connection failed",
        );
      });

      it("should handle invalid ObjectId in service response gracefully", async () => {
        const mockBids = [
          {
            _id: "invalid_id",
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.id).toBe("invalid_id");
      });

      it("should handle null values in bid response", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            wonRound: null,
            itemNumber: null,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.wonRound).toBeNull();
        expect(result[0]?.itemNumber).toBeNull();
      });
    });

    describe("Authentication and Authorization", () => {
      it("should use authenticated user ID from request", async () => {
        const specificUserId = new Types.ObjectId().toString();
        mockBidsService.getByUser.mockResolvedValue([]);

        const request = createMockRequest(specificUserId);
        await controller.getMyBids(request);

        expect(mockBidsService.getByUser).toHaveBeenCalledWith(specificUserId);
      });

      it("should call service with exact user ID from JWT payload", async () => {
        const jwtUserId = "507f1f77bcf86cd799439099";
        mockBidsService.getByUser.mockResolvedValue([]);

        const request = createMockRequest(jwtUserId);
        await controller.getMyBids(request);

        expect(mockBidsService.getByUser).toHaveBeenCalledWith(jwtUserId);
        expect(mockBidsService.getByUser).toHaveBeenCalledTimes(1);
      });

      it("should not expose other users bids", async () => {
        const user1Id = new Types.ObjectId().toString();
        const user2Id = new Types.ObjectId().toString();

        const user1Bids = [
          {
            _id: new Types.ObjectId(),
            auctionId: mockAuctionId,
            userId: new Types.ObjectId(user1Id),
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(user1Bids as any);

        const request = createMockRequest(user1Id);
        await controller.getMyBids(request);

        expect(mockBidsService.getByUser).toHaveBeenCalledWith(user1Id);
        expect(mockBidsService.getByUser).not.toHaveBeenCalledWith(user2Id);
      });
    });
  });

  describe("Type Guards", () => {
    describe("isPopulatedAuction", () => {
      it("should identify populated auction with title field", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: {
              _id: mockAuctionId,
              title: "Test Auction",
              status: AuctionStatus.ACTIVE,
            },
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.auction).toBeDefined();
        expect(result[0]?.auction?.title).toBe("Test Auction");
      });

      it("should handle auction without title field", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.auction).toBeNull();
      });
    });

    describe("isObjectId", () => {
      it("should correctly identify ObjectId instance", async () => {
        const mockBids = [
          {
            _id: mockBidId,
            auctionId: mockAuctionId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(result[0]?.auctionId).toBe(mockAuctionId.toString());
      });

      it("should handle BSON ObjectId correctly", async () => {
        const bsonObjectId = {
          _bsontype: "ObjectId",
          id: mockAuctionId.id,
          toString: () => mockAuctionId.toString(),
        };

        const mockBids = [
          {
            _id: mockBidId,
            auctionId: bsonObjectId,
            userId: mockUserId,
            amount: 100,
            status: BidStatus.ACTIVE,
            createdAt: new Date("2024-01-15T10:00:00Z"),
          },
        ];

        mockBidsService.getByUser.mockResolvedValue(mockBids as any);

        const request = createMockRequest(mockUserId.toString());
        const result = await controller.getMyBids(request);

        expect(typeof result[0]?.auctionId).toBe("string");
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle bids with very old createdAt dates", async () => {
      const oldDate = new Date("2020-01-01T00:00:00Z");
      const mockBids = [
        {
          _id: mockBidId,
          auctionId: mockAuctionId,
          userId: mockUserId,
          amount: 100,
          status: BidStatus.LOST,
          createdAt: oldDate,
        },
      ];

      mockBidsService.getByUser.mockResolvedValue(mockBids as any);

      const request = createMockRequest(mockUserId.toString());
      const result = await controller.getMyBids(request);

      expect(result[0]?.createdAt).toEqual(oldDate);
    });

    it("should handle bids with future createdAt dates", async () => {
      const futureDate = new Date("2030-12-31T23:59:59Z");
      const mockBids = [
        {
          _id: mockBidId,
          auctionId: mockAuctionId,
          userId: mockUserId,
          amount: 100,
          status: BidStatus.ACTIVE,
          createdAt: futureDate,
        },
      ];

      mockBidsService.getByUser.mockResolvedValue(mockBids as any);

      const request = createMockRequest(mockUserId.toString());
      const result = await controller.getMyBids(request);

      expect(result[0]?.createdAt).toEqual(futureDate);
    });

    it("should handle bids with zero amount", async () => {
      const mockBids = [
        {
          _id: mockBidId,
          auctionId: mockAuctionId,
          userId: mockUserId,
          amount: 0,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-15T10:00:00Z"),
        },
      ];

      mockBidsService.getByUser.mockResolvedValue(mockBids as any);

      const request = createMockRequest(mockUserId.toString());
      const result = await controller.getMyBids(request);

      expect(result[0]?.amount).toBe(0);
    });

    it("should handle bids with very large amounts", async () => {
      const largeAmount = Number.MAX_SAFE_INTEGER;
      const mockBids = [
        {
          _id: mockBidId,
          auctionId: mockAuctionId,
          userId: mockUserId,
          amount: largeAmount,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-15T10:00:00Z"),
        },
      ];

      mockBidsService.getByUser.mockResolvedValue(mockBids as any);

      const request = createMockRequest(mockUserId.toString());
      const result = await controller.getMyBids(request);

      expect(result[0]?.amount).toBe(largeAmount);
    });

    it("should handle wonRound of 0", async () => {
      const mockBids = [
        {
          _id: mockBidId,
          auctionId: mockAuctionId,
          userId: mockUserId,
          amount: 100,
          status: BidStatus.WON,
          wonRound: 0,
          itemNumber: 0,
          createdAt: new Date("2024-01-15T10:00:00Z"),
        },
      ];

      mockBidsService.getByUser.mockResolvedValue(mockBids as any);

      const request = createMockRequest(mockUserId.toString());
      const result = await controller.getMyBids(request);

      expect(result[0]?.wonRound).toBe(0);
      expect(result[0]?.itemNumber).toBe(0);
    });
  });

  describe("Performance and Concurrency", () => {
    it("should handle concurrent requests correctly", async () => {
      const user1Id = new Types.ObjectId().toString();
      const user2Id = new Types.ObjectId().toString();

      const user1Bids = [
        {
          _id: new Types.ObjectId(),
          auctionId: mockAuctionId,
          userId: new Types.ObjectId(user1Id),
          amount: 100,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-15T10:00:00Z"),
        },
      ];

      const user2Bids = [
        {
          _id: new Types.ObjectId(),
          auctionId: mockAuctionId,
          userId: new Types.ObjectId(user2Id),
          amount: 200,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-15T10:00:00Z"),
        },
      ];

      mockBidsService.getByUser
        .mockResolvedValueOnce(user1Bids as any)
        .mockResolvedValueOnce(user2Bids as any);

      const request1 = createMockRequest(user1Id);
      const request2 = createMockRequest(user2Id);

      const [result1, result2] = await Promise.all([
        controller.getMyBids(request1),
        controller.getMyBids(request2),
      ]);

      expect(result1[0]?.amount).toBe(100);
      expect(result2[0]?.amount).toBe(200);
      expect(mockBidsService.getByUser).toHaveBeenCalledTimes(2);
    });

    it("should not cache results between different users", async () => {
      const user1Id = new Types.ObjectId().toString();
      const user2Id = new Types.ObjectId().toString();

      mockBidsService.getByUser.mockResolvedValue([]);

      const request1 = createMockRequest(user1Id);
      await controller.getMyBids(request1);

      const request2 = createMockRequest(user2Id);
      await controller.getMyBids(request2);

      expect(mockBidsService.getByUser).toHaveBeenCalledWith(user1Id);
      expect(mockBidsService.getByUser).toHaveBeenCalledWith(user2Id);
      expect(mockBidsService.getByUser).toHaveBeenCalledTimes(2);
    });
  });
});
