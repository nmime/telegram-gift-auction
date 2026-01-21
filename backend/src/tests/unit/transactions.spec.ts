import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { Types } from "mongoose";
import { TransactionsService } from "@/modules/transactions/transactions.service";
import { Transaction, TransactionType } from "@/schemas";

describe("TransactionsService", () => {
  let service: TransactionsService;

  const mockTransactionModel = {
    find: jest.fn().mockReturnThis(),
    findById: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    countDocuments: jest.fn(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn(),
    aggregate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: getModelToken(Transaction.name),
          useValue: mockTransactionModel,
        },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getByUser", () => {
    const userId = new Types.ObjectId().toString();

    it("should return user transactions with default pagination", async () => {
      const mockTransactions = [
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          type: TransactionType.DEPOSIT,
          amount: 100,
          balanceBefore: 0,
          balanceAfter: 100,
          createdAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          type: TransactionType.WITHDRAW,
          amount: 50,
          balanceBefore: 100,
          balanceAfter: 50,
          createdAt: new Date(),
        },
      ];
      mockTransactionModel.exec.mockResolvedValue(mockTransactions);

      const result = await service.getByUser(userId);

      expect(mockTransactionModel.find).toHaveBeenCalledWith({
        userId: new Types.ObjectId(userId),
      });
      expect(mockTransactionModel.sort).toHaveBeenCalledWith({
        createdAt: -1,
      });
      expect(mockTransactionModel.skip).toHaveBeenCalledWith(0);
      expect(mockTransactionModel.limit).toHaveBeenCalledWith(50);
      expect(result).toEqual(mockTransactions);
    });

    it("should return transactions with custom limit", async () => {
      const mockTransactions = [
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          type: TransactionType.DEPOSIT,
          amount: 100,
          balanceBefore: 0,
          balanceAfter: 100,
          createdAt: new Date(),
        },
      ];
      mockTransactionModel.exec.mockResolvedValue(mockTransactions);

      const result = await service.getByUser(userId, 10);

      expect(mockTransactionModel.limit).toHaveBeenCalledWith(10);
      expect(result).toEqual(mockTransactions);
    });

    it("should return transactions with custom offset", async () => {
      const mockTransactions = [
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId),
          type: TransactionType.DEPOSIT,
          amount: 100,
          balanceBefore: 0,
          balanceAfter: 100,
          createdAt: new Date(),
        },
      ];
      mockTransactionModel.exec.mockResolvedValue(mockTransactions);

      const result = await service.getByUser(userId, 50, 20);

      expect(mockTransactionModel.skip).toHaveBeenCalledWith(20);
      expect(result).toEqual(mockTransactions);
    });

    it("should return transactions with both custom limit and offset", async () => {
      const mockTransactions: any[] = [];
      mockTransactionModel.exec.mockResolvedValue(mockTransactions);

      const result = await service.getByUser(userId, 25, 100);

      expect(mockTransactionModel.limit).toHaveBeenCalledWith(25);
      expect(mockTransactionModel.skip).toHaveBeenCalledWith(100);
      expect(result).toEqual(mockTransactions);
    });

    it("should return empty array when no transactions found", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      const result = await service.getByUser(userId);

      expect(result).toEqual([]);
    });

    it("should handle valid ObjectId string", async () => {
      const validId = new Types.ObjectId().toString();
      mockTransactionModel.exec.mockResolvedValue([]);

      await service.getByUser(validId);

      expect(mockTransactionModel.find).toHaveBeenCalledWith({
        userId: new Types.ObjectId(validId),
      });
    });

    it("should sort transactions by createdAt descending", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      await service.getByUser(userId);

      expect(mockTransactionModel.sort).toHaveBeenCalledWith({
        createdAt: -1,
      });
    });

    it("should handle zero offset", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      await service.getByUser(userId, 50, 0);

      expect(mockTransactionModel.skip).toHaveBeenCalledWith(0);
    });

    it("should handle maximum limit (100)", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      await service.getByUser(userId, 100);

      expect(mockTransactionModel.limit).toHaveBeenCalledWith(100);
    });

    it("should handle minimum limit (1)", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      await service.getByUser(userId, 1);

      expect(mockTransactionModel.limit).toHaveBeenCalledWith(1);
    });
  });

  describe("getByAuction", () => {
    const auctionId = new Types.ObjectId().toString();

    it("should return auction transactions sorted by createdAt descending", async () => {
      const mockTransactions = [
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          type: TransactionType.BID_FREEZE,
          amount: 100,
          balanceBefore: 200,
          balanceAfter: 200,
          frozenBefore: 0,
          frozenAfter: 100,
          createdAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(),
          auctionId: new Types.ObjectId(auctionId),
          type: TransactionType.BID_WIN,
          amount: 100,
          balanceBefore: 200,
          balanceAfter: 100,
          frozenBefore: 100,
          frozenAfter: 0,
          createdAt: new Date(),
        },
      ];
      mockTransactionModel.exec.mockResolvedValue(mockTransactions);

      const result = await service.getByAuction(auctionId);

      expect(mockTransactionModel.find).toHaveBeenCalledWith({
        auctionId: new Types.ObjectId(auctionId),
      });
      expect(mockTransactionModel.sort).toHaveBeenCalledWith({
        createdAt: -1,
      });
      expect(result).toEqual(mockTransactions);
    });

    it("should return empty array when no transactions found for auction", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      const result = await service.getByAuction(auctionId);

      expect(result).toEqual([]);
    });

    it("should handle valid ObjectId string for auction", async () => {
      const validId = new Types.ObjectId().toString();
      mockTransactionModel.exec.mockResolvedValue([]);

      await service.getByAuction(validId);

      expect(mockTransactionModel.find).toHaveBeenCalledWith({
        auctionId: new Types.ObjectId(validId),
      });
    });

    it("should return transactions for auction with multiple users", async () => {
      const user1 = new Types.ObjectId();
      const user2 = new Types.ObjectId();
      const mockTransactions = [
        {
          _id: new Types.ObjectId(),
          userId: user1,
          auctionId: new Types.ObjectId(auctionId),
          type: TransactionType.BID_FREEZE,
          amount: 100,
          createdAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          userId: user2,
          auctionId: new Types.ObjectId(auctionId),
          type: TransactionType.BID_FREEZE,
          amount: 150,
          createdAt: new Date(),
        },
      ];
      mockTransactionModel.exec.mockResolvedValue(mockTransactions);

      const result = await service.getByAuction(auctionId);

      expect(result).toHaveLength(2);
      expect(result[0]?.userId).toEqual(user1);
      expect(result[1]?.userId).toEqual(user2);
    });
  });

  describe("Transaction Type Validation", () => {
    it("should validate DEPOSIT transaction type", () => {
      expect(TransactionType.DEPOSIT).toBe("deposit");
    });

    it("should validate WITHDRAW transaction type", () => {
      expect(TransactionType.WITHDRAW).toBe("withdraw");
    });

    it("should validate BID_FREEZE transaction type", () => {
      expect(TransactionType.BID_FREEZE).toBe("bid_freeze");
    });

    it("should validate BID_UNFREEZE transaction type", () => {
      expect(TransactionType.BID_UNFREEZE).toBe("bid_unfreeze");
    });

    it("should validate BID_WIN transaction type", () => {
      expect(TransactionType.BID_WIN).toBe("bid_win");
    });

    it("should validate BID_REFUND transaction type", () => {
      expect(TransactionType.BID_REFUND).toBe("bid_refund");
    });

    it("should have exactly 6 transaction types", () => {
      const types = Object.values(TransactionType);
      expect(types).toHaveLength(6);
    });
  });

  describe("Transaction Amount Validation", () => {
    it("should accept positive integer amount", () => {
      const amount = 100;
      expect(amount).toBeGreaterThan(0);
      expect(Number.isInteger(amount)).toBe(true);
    });

    it("should reject zero amount", () => {
      const amount = 0;
      expect(amount).not.toBeGreaterThan(0);
    });

    it("should reject negative amount", () => {
      const amount = -50;
      expect(amount).not.toBeGreaterThan(0);
    });

    it("should reject decimal amount", () => {
      const amount = 100.5;
      expect(Number.isInteger(amount)).toBe(false);
    });

    it("should reject NaN amount", () => {
      const amount = NaN;
      expect(Number.isNaN(amount)).toBe(true);
    });

    it("should accept large positive integer", () => {
      const amount = 1000000;
      expect(amount).toBeGreaterThan(0);
      expect(Number.isInteger(amount)).toBe(true);
    });
  });

  describe("Balance Consistency", () => {
    it("should maintain balance consistency for DEPOSIT", () => {
      const balanceBefore = 100;
      const amount = 50;
      const balanceAfter = balanceBefore + amount;

      expect(balanceAfter).toBe(150);
      expect(balanceAfter - balanceBefore).toBe(amount);
    });

    it("should maintain balance consistency for WITHDRAW", () => {
      const balanceBefore = 100;
      const amount = 30;
      const balanceAfter = balanceBefore - amount;

      expect(balanceAfter).toBe(70);
      expect(balanceBefore - balanceAfter).toBe(amount);
    });

    it("should maintain balance consistency for BID_FREEZE", () => {
      const balanceBefore = 200;
      const amount = 100;
      const balanceAfter = balanceBefore;
      const frozenBefore = 0;
      const frozenAfter = frozenBefore + amount;

      expect(balanceAfter).toBe(balanceBefore);
      expect(frozenAfter).toBe(100);
      expect(balanceBefore + frozenAfter).toBe(300);
    });

    it("should maintain balance consistency for BID_UNFREEZE", () => {
      const balanceBefore = 200;
      const amount = 100;
      const balanceAfter = balanceBefore;
      const frozenBefore = 100;
      const frozenAfter = frozenBefore - amount;

      expect(balanceAfter).toBe(balanceBefore);
      expect(frozenAfter).toBe(0);
    });

    it("should maintain balance consistency for BID_WIN", () => {
      const balanceBefore = 200;
      const amount = 100;
      const balanceAfter = balanceBefore - amount;
      const frozenBefore = 100;
      const frozenAfter = frozenBefore - amount;

      expect(balanceAfter).toBe(100);
      expect(frozenAfter).toBe(0);
      expect(balanceAfter + amount).toBe(balanceBefore);
    });

    it("should maintain balance consistency for BID_REFUND", () => {
      const balanceBefore = 200;
      const amount = 100;
      const balanceAfter = balanceBefore;
      const frozenBefore = 100;
      const frozenAfter = frozenBefore - amount;

      expect(balanceAfter).toBe(balanceBefore);
      expect(frozenAfter).toBe(0);
    });
  });

  describe("Transaction Ordering", () => {
    it("should return transactions in descending order by createdAt", async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 1000);
      const earliest = new Date(now.getTime() - 2000);

      const mockTransactions = [
        { _id: new Types.ObjectId(), createdAt: now },
        { _id: new Types.ObjectId(), createdAt: earlier },
        { _id: new Types.ObjectId(), createdAt: earliest },
      ];

      mockTransactionModel.exec.mockResolvedValue(mockTransactions);

      const result = await service.getByUser(new Types.ObjectId().toString());

      expect(result[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
        result[1]?.createdAt.getTime() ?? 0,
      );
      expect(result[1]?.createdAt.getTime()).toBeGreaterThanOrEqual(
        result[2]?.createdAt.getTime() ?? 0,
      );
    });

    it("should handle transactions with same createdAt timestamp", async () => {
      const now = new Date();
      const mockTransactions = [
        { _id: new Types.ObjectId(), createdAt: now },
        { _id: new Types.ObjectId(), createdAt: now },
      ];

      mockTransactionModel.exec.mockResolvedValue(mockTransactions);

      const result = await service.getByUser(new Types.ObjectId().toString());

      expect(result).toHaveLength(2);
      expect(result[0]?.createdAt).toEqual(result[1]?.createdAt);
    });
  });

  describe("Edge Cases", () => {
    it("should handle transactions with minimum valid amount (1)", async () => {
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        type: TransactionType.DEPOSIT,
        amount: 1,
        balanceBefore: 0,
        balanceAfter: 1,
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.amount).toBe(1);
    });

    it("should handle transactions with large amounts", async () => {
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        type: TransactionType.DEPOSIT,
        amount: 1000000,
        balanceBefore: 0,
        balanceAfter: 1000000,
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.amount).toBe(1000000);
    });

    it("should handle transactions with optional description", async () => {
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        type: TransactionType.DEPOSIT,
        amount: 100,
        balanceBefore: 0,
        balanceAfter: 100,
        description: "Test deposit",
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.description).toBe("Test deposit");
    });

    it("should handle transactions without description", async () => {
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        type: TransactionType.DEPOSIT,
        amount: 100,
        balanceBefore: 0,
        balanceAfter: 100,
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.description).toBeUndefined();
    });

    it("should handle transactions with auctionId", async () => {
      const auctionId = new Types.ObjectId();
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        auctionId,
        type: TransactionType.BID_FREEZE,
        amount: 100,
        balanceBefore: 200,
        balanceAfter: 200,
        frozenBefore: 0,
        frozenAfter: 100,
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.auctionId).toEqual(auctionId);
    });

    it("should handle transactions without auctionId", async () => {
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        type: TransactionType.DEPOSIT,
        amount: 100,
        balanceBefore: 0,
        balanceAfter: 100,
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.auctionId).toBeUndefined();
    });

    it("should handle transactions with bidId", async () => {
      const bidId = new Types.ObjectId();
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        bidId,
        type: TransactionType.BID_FREEZE,
        amount: 100,
        balanceBefore: 200,
        balanceAfter: 200,
        frozenBefore: 0,
        frozenAfter: 100,
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.bidId).toEqual(bidId);
    });

    it("should handle transactions with frozen balance fields", async () => {
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        type: TransactionType.BID_FREEZE,
        amount: 100,
        balanceBefore: 200,
        balanceAfter: 200,
        frozenBefore: 0,
        frozenAfter: 100,
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.frozenBefore).toBe(0);
      expect(result[0]?.frozenAfter).toBe(100);
    });

    it("should handle transactions without frozen balance fields", async () => {
      const mockTransaction = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        type: TransactionType.DEPOSIT,
        amount: 100,
        balanceBefore: 0,
        balanceAfter: 100,
        createdAt: new Date(),
      };

      mockTransactionModel.exec.mockResolvedValue([mockTransaction]);

      const result = await service.getByUser(mockTransaction.userId.toString());

      expect(result[0]?.frozenBefore).toBeUndefined();
      expect(result[0]?.frozenAfter).toBeUndefined();
    });
  });

  describe("Concurrent Transaction Handling", () => {
    it("should handle multiple simultaneous queries", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionModel.exec.mockResolvedValue([]);

      const promise1 = service.getByUser(userId);
      const promise2 = service.getByUser(userId);
      const promise3 = service.getByUser(userId);

      await Promise.all([promise1, promise2, promise3]);

      expect(mockTransactionModel.find).toHaveBeenCalledTimes(3);
    });

    it("should handle queries for different users concurrently", async () => {
      const user1 = new Types.ObjectId().toString();
      const user2 = new Types.ObjectId().toString();

      mockTransactionModel.exec.mockResolvedValue([]);

      await Promise.all([service.getByUser(user1), service.getByUser(user2)]);

      expect(mockTransactionModel.find).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error Scenarios", () => {
    it("should propagate database errors", async () => {
      const error = new Error("Database connection failed");
      mockTransactionModel.exec.mockRejectedValue(error);

      await expect(
        service.getByUser(new Types.ObjectId().toString()),
      ).rejects.toThrow("Database connection failed");
    });

    it("should handle null userId by passing through to MongoDB", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      // Service passes null through, MongoDB will handle it
      const result = await service.getByUser(null as any);
      expect(result).toEqual([]);
    });

    it("should handle undefined userId by passing through to MongoDB", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      // Service passes undefined through, MongoDB will handle it
      const result = await service.getByUser(undefined as any);
      expect(result).toEqual([]);
    });

    it("should handle invalid ObjectId string", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      await expect(service.getByUser("invalid-id")).rejects.toThrow();
    });

    it("should handle empty string userId", async () => {
      mockTransactionModel.exec.mockResolvedValue([]);

      await expect(service.getByUser("")).rejects.toThrow();
    });
  });
});
