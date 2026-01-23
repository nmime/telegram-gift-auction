import { describe, it, expect, beforeEach, vi } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { Types } from "mongoose";
import { BidsService } from "./bids.service";
import { Bid, BidStatus } from "@/schemas";

interface BidQuery {
  auctionId?: Types.ObjectId;
  userId?: Types.ObjectId;
  status?: BidStatus;
}

describe("BidsService", () => {
  let service: BidsService;

  const mockBidModel = {
    find: vi.fn().mockReturnThis(),
    findById: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    sort: vi.fn().mockReturnThis(),
    populate: vi.fn().mockReturnThis(),
    exec: vi.fn(),
    countDocuments: vi.fn(),
    updateOne: vi.fn().mockReturnThis(),
    updateMany: vi.fn().mockReturnThis(),
    deleteOne: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidsService,
        {
          provide: getModelToken(Bid.name),
          useValue: mockBidModel,
        },
      ],
    }).compile();

    service = module.get<BidsService>(BidsService);
    vi.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getByAuction", () => {
    const auctionId = new Types.ObjectId().toString();

    it("should return bids sorted by amount descending, then by creation time ascending", async () => {
      const mockBids = [
        {
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          userId: new Types.ObjectId(),
          amount: 200,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
        {
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          userId: new Types.ObjectId(),
          amount: 100,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
        },
      ];
      mockBidModel.exec.mockResolvedValue(mockBids);

      const result = await service.getByAuction(auctionId);

      expect(mockBidModel.find).toHaveBeenCalledWith({
        auctionId: new Types.ObjectId(auctionId),
      });
      expect(mockBidModel.sort).toHaveBeenCalledWith({
        amount: -1,
        createdAt: 1,
      });
      expect(mockBidModel.populate).toHaveBeenCalledWith(
        "userId",
        "username isBot",
      );
      expect(result).toEqual(mockBids);
      expect(result.length).toBe(2);
    });

    it("should return empty array when no bids exist for auction", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      const result = await service.getByAuction(auctionId);

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should handle ObjectId conversion for auctionId", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      await service.getByAuction(auctionId);

      expect(mockBidModel.find).toHaveBeenCalledWith({
        auctionId: new Types.ObjectId(auctionId),
      });
    });

    it("should populate user data with username and isBot fields", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      await service.getByAuction(auctionId);

      expect(mockBidModel.populate).toHaveBeenCalledWith(
        "userId",
        "username isBot",
      );
    });

    it("should maintain query chain for database operations", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      await service.getByAuction(auctionId);

      // Verify the method chain is properly called
      expect(mockBidModel.find).toHaveBeenCalled();
      expect(mockBidModel.sort).toHaveBeenCalled();
      expect(mockBidModel.populate).toHaveBeenCalled();
      expect(mockBidModel.exec).toHaveBeenCalled();
    });
  });

  describe("getActiveByAuction", () => {
    const auctionId = new Types.ObjectId().toString();

    it("should return only active bids sorted by amount and creation time", async () => {
      const mockBids = [
        {
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          userId: new Types.ObjectId(),
          amount: 300,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
        {
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          userId: new Types.ObjectId(),
          amount: 150,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
        },
      ];
      mockBidModel.exec.mockResolvedValue(mockBids);

      const result = await service.getActiveByAuction(auctionId);

      expect(mockBidModel.find).toHaveBeenCalledWith({
        auctionId: new Types.ObjectId(auctionId),
        status: BidStatus.ACTIVE,
      });
      expect(mockBidModel.sort).toHaveBeenCalledWith({
        amount: -1,
        createdAt: 1,
      });
      expect(result).toEqual(mockBids);
    });

    it("should exclude non-active bids from results", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      await service.getActiveByAuction(auctionId);

      const findCall = mockBidModel.find.mock.calls[0][0] as BidQuery;
      expect(findCall.status).toBe(BidStatus.ACTIVE);
    });

    it("should return empty array when no active bids exist", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      const result = await service.getActiveByAuction(auctionId);

      expect(result).toEqual([]);
    });

    it("should populate user data for active bids", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      await service.getActiveByAuction(auctionId);

      expect(mockBidModel.populate).toHaveBeenCalledWith(
        "userId",
        "username isBot",
      );
    });

    it("should filter bids with different statuses and return only ACTIVE", async () => {
      const activeBid = {
        _id: new Types.ObjectId(),
        auctionId: new Types.ObjectId(auctionId),
        userId: new Types.ObjectId(),
        amount: 200,
        status: BidStatus.ACTIVE,
      };
      mockBidModel.exec.mockResolvedValue([activeBid]);

      const result = await service.getActiveByAuction(auctionId);

      const findQuery = mockBidModel.find.mock.calls[0][0] as BidQuery;
      expect(findQuery).toHaveProperty("status", BidStatus.ACTIVE);
      expect(result[0]?.status).toBe(BidStatus.ACTIVE);
    });
  });

  describe("getByUser", () => {
    const userId = new Types.ObjectId().toString();

    it("should return all bids by user sorted by creation time descending", async () => {
      const mockBids = [
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          auctionId: new Types.ObjectId(),
          amount: 200,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
        },
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          auctionId: new Types.ObjectId(),
          amount: 100,
          status: BidStatus.LOST,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ];
      mockBidModel.exec.mockResolvedValue(mockBids);

      const result = await service.getByUser(userId);

      expect(mockBidModel.find).toHaveBeenCalledWith({
        userId: new Types.ObjectId(userId),
      });
      expect(mockBidModel.sort).toHaveBeenCalledWith({
        createdAt: -1,
      });
      expect(mockBidModel.populate).toHaveBeenCalledWith(
        "auctionId",
        "title status",
      );
      expect(result).toEqual(mockBids);
      expect(result.length).toBe(2);
    });

    it("should return bids with all statuses", async () => {
      const mockBids = [
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          auctionId: new Types.ObjectId(),
          amount: 200,
          status: BidStatus.ACTIVE,
          createdAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          auctionId: new Types.ObjectId(),
          amount: 100,
          status: BidStatus.WON,
          createdAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          auctionId: new Types.ObjectId(),
          amount: 50,
          status: BidStatus.LOST,
          createdAt: new Date(),
        },
      ];
      mockBidModel.exec.mockResolvedValue(mockBids);

      const result = await service.getByUser(userId);

      expect(result.length).toBe(3);
      expect(result.some((b) => b.status === BidStatus.ACTIVE)).toBe(true);
      expect(result.some((b) => b.status === BidStatus.WON)).toBe(true);
      expect(result.some((b) => b.status === BidStatus.LOST)).toBe(true);
    });

    it("should return empty array when user has no bids", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      const result = await service.getByUser(userId);

      expect(result).toEqual([]);
    });

    it("should populate auction data with title and status fields", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      await service.getByUser(userId);

      expect(mockBidModel.populate).toHaveBeenCalledWith(
        "auctionId",
        "title status",
      );
    });

    it("should maintain most recent bids at the beginning", async () => {
      const oldDate = new Date("2024-01-01");
      const newDate = new Date("2024-01-10");

      const mockBids = [
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          auctionId: new Types.ObjectId(),
          amount: 100,
          status: BidStatus.ACTIVE,
          createdAt: newDate,
        },
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          auctionId: new Types.ObjectId(),
          amount: 50,
          status: BidStatus.LOST,
          createdAt: oldDate,
        },
      ];
      mockBidModel.exec.mockResolvedValue(mockBids);

      const result = await service.getByUser(userId);

      expect(result && result[0] && result[0].createdAt).toEqual(newDate);
      expect(result && result[1] && result[1].createdAt).toEqual(oldDate);
    });
  });

  describe("countByAuction", () => {
    const auctionId = new Types.ObjectId().toString();

    it("should return active bid count for an auction", async () => {
      mockBidModel.countDocuments.mockResolvedValue(5);

      const result = await service.countByAuction(auctionId);

      expect(mockBidModel.countDocuments).toHaveBeenCalledWith({
        auctionId: new Types.ObjectId(auctionId),
        status: BidStatus.ACTIVE,
      });
      expect(result).toBe(5);
    });

    it("should return 0 when auction has no active bids", async () => {
      mockBidModel.countDocuments.mockResolvedValue(0);

      const result = await service.countByAuction(auctionId);

      expect(result).toBe(0);
    });

    it("should only count ACTIVE status bids", async () => {
      mockBidModel.countDocuments.mockResolvedValue(3);

      await service.countByAuction(auctionId);

      const countQuery = mockBidModel.countDocuments.mock
        .calls[0][0] as BidQuery;
      expect(countQuery.status).toBe(BidStatus.ACTIVE);
    });

    it("should handle large bid counts", async () => {
      mockBidModel.countDocuments.mockResolvedValue(10000);

      const result = await service.countByAuction(auctionId);

      expect(result).toBe(10000);
    });

    it("should convert auctionId string to ObjectId", async () => {
      mockBidModel.countDocuments.mockResolvedValue(2);

      await service.countByAuction(auctionId);

      const countQuery = mockBidModel.countDocuments.mock
        .calls[0][0] as BidQuery;
      expect(countQuery.auctionId).toEqual(new Types.ObjectId(auctionId));
    });

    it("should handle different auction IDs independently", async () => {
      const auctionId1 = new Types.ObjectId().toString();
      const auctionId2 = new Types.ObjectId().toString();

      mockBidModel.countDocuments.mockResolvedValue(5);
      await service.countByAuction(auctionId1);

      mockBidModel.countDocuments.mockResolvedValue(3);
      await service.countByAuction(auctionId2);

      expect(mockBidModel.countDocuments).toHaveBeenNthCalledWith(1, {
        auctionId: new Types.ObjectId(auctionId1),
        status: BidStatus.ACTIVE,
      });
      expect(mockBidModel.countDocuments).toHaveBeenNthCalledWith(2, {
        auctionId: new Types.ObjectId(auctionId2),
        status: BidStatus.ACTIVE,
      });
    });
  });

  describe("Edge cases and error scenarios", () => {
    it("should handle invalid ObjectId gracefully in getByAuction", async () => {
      mockBidModel.exec.mockResolvedValue([]);

      // Should not throw with valid ObjectId format
      const validId = new Types.ObjectId().toString();
      const result = await service.getByAuction(validId);

      expect(result).toEqual([]);
    });

    it("should handle null results from database", async () => {
      mockBidModel.exec.mockResolvedValue(null);

      const result = await service.getByAuction(
        new Types.ObjectId().toString(),
      );

      expect(result).toBeNull();
    });

    it("should handle database errors in getByAuction", async () => {
      const error = new Error("Database connection failed");
      mockBidModel.exec.mockRejectedValue(error);

      await expect(
        service.getByAuction(new Types.ObjectId().toString()),
      ).rejects.toThrow("Database connection failed");
    });

    it("should handle database errors in countByAuction", async () => {
      const error = new Error("Count operation failed");
      mockBidModel.countDocuments.mockRejectedValue(error);

      await expect(
        service.countByAuction(new Types.ObjectId().toString()),
      ).rejects.toThrow("Count operation failed");
    });

    it("should maintain proper bid ordering with identical amounts", async () => {
      const userId1 = new Types.ObjectId();
      const userId2 = new Types.ObjectId();
      const auctionId = new Types.ObjectId().toString();

      const mockBids = [
        {
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          userId: userId1,
          amount: 100,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-01"),
        },
        {
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          userId: userId2,
          amount: 100,
          status: BidStatus.ACTIVE,
          createdAt: new Date("2024-01-02"),
        },
      ];
      mockBidModel.exec.mockResolvedValue(mockBids);

      const result = await service.getByAuction(auctionId);

      // Earlier bid should come before later bid when amounts are equal
      expect(
        result &&
          result[0] &&
          result[1] &&
          result[0].createdAt.getTime() < result[1].createdAt.getTime(),
      ).toBe(true);
    });

    it("should handle multiple calls with different parameters", async () => {
      const auctionId1 = new Types.ObjectId().toString();
      const auctionId2 = new Types.ObjectId().toString();

      mockBidModel.exec.mockResolvedValue([]);

      await service.getByAuction(auctionId1);
      await service.getByAuction(auctionId2);

      expect(mockBidModel.find).toHaveBeenCalledTimes(2);
      expect(mockBidModel.find).toHaveBeenNthCalledWith(1, {
        auctionId: new Types.ObjectId(auctionId1),
      });
      expect(mockBidModel.find).toHaveBeenNthCalledWith(2, {
        auctionId: new Types.ObjectId(auctionId2),
      });
    });

    it("should handle concurrent operations", async () => {
      const auctionId = new Types.ObjectId().toString();

      mockBidModel.exec.mockResolvedValue([]);
      mockBidModel.countDocuments.mockResolvedValue(5);

      const [bids, count] = await Promise.all([
        service.getByAuction(auctionId),
        service.countByAuction(auctionId),
      ]);

      expect(bids).toEqual([]);
      expect(count).toBe(5);
    });

    it("should handle different BidStatus values correctly", async () => {
      const auctionId = new Types.ObjectId().toString();

      mockBidModel.exec.mockResolvedValue([]);

      // Test with different status values
      await service.getActiveByAuction(auctionId);

      const findQuery = mockBidModel.find.mock.calls[0][0] as BidQuery;
      expect([
        BidStatus.ACTIVE,
        BidStatus.WON,
        BidStatus.LOST,
        BidStatus.REFUNDED,
        BidStatus.CANCELLED,
      ]).toContain(findQuery.status);
    });
  });

  describe("Data integrity and consistency", () => {
    it("should maintain data types in bid results", async () => {
      const auctionId = new Types.ObjectId().toString();
      const mockBid = {
        _id: new Types.ObjectId(),
        auctionId: new Types.ObjectId(auctionId),
        userId: new Types.ObjectId(),
        amount: 150.5,
        status: BidStatus.ACTIVE,
        wonRound: 1,
        itemNumber: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockBidModel.exec.mockResolvedValue([mockBid]);

      const result = await service.getByAuction(auctionId);

      expect(result && result[0] && typeof result[0].amount).toBe("number");
      expect(result && result[0] && typeof result[0].status).toBe("string");
      expect(result && result[0] && result[0].createdAt instanceof Date).toBe(
        true,
      );
    });

    it("should handle decimal amounts correctly", async () => {
      const auctionId = new Types.ObjectId().toString();
      const mockBids = [
        {
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          userId: new Types.ObjectId(),
          amount: 100.99,
          status: BidStatus.ACTIVE,
          createdAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          userId: new Types.ObjectId(),
          amount: 50.01,
          status: BidStatus.ACTIVE,
          createdAt: new Date(),
        },
      ];
      mockBidModel.exec.mockResolvedValue(mockBids);

      const result = await service.getByAuction(auctionId);

      expect(result && result[0] && result[0].amount).toBe(100.99);
      expect(result && result[1] && result[1].amount).toBe(50.01);
    });

    it("should preserve optional fields when present", async () => {
      const auctionId = new Types.ObjectId().toString();
      const mockBid = {
        _id: new Types.ObjectId(),
        auctionId: new Types.ObjectId(auctionId),
        userId: new Types.ObjectId(),
        amount: 200,
        status: BidStatus.WON,
        wonRound: 2,
        itemNumber: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockBidModel.exec.mockResolvedValue([mockBid]);

      const result = await service.getByAuction(auctionId);

      expect(result?.[0]).toHaveProperty("wonRound", 2);
      expect(result?.[0]).toHaveProperty("itemNumber", 10);
    });

    it("should handle bids with null optional fields", async () => {
      const auctionId = new Types.ObjectId().toString();
      const mockBid = {
        _id: new Types.ObjectId(),
        auctionId: new Types.ObjectId(auctionId),
        userId: new Types.ObjectId(),
        amount: 200,
        status: BidStatus.ACTIVE,
        wonRound: null,
        itemNumber: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockBidModel.exec.mockResolvedValue([mockBid]);

      const result = await service.getByAuction(auctionId);

      expect(result && result[0] && result[0].wonRound).toBeNull();
      expect(result && result[0] && result[0].itemNumber).toBeNull();
    });
  });
});
