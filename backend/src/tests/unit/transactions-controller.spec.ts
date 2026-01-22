/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, type TestingModule } from "@nestjs/testing";
import { Types } from "mongoose";
import { TransactionsController } from "@/modules/transactions/transactions.controller";
import { TransactionsService } from "@/modules/transactions/transactions.service";
import { AuthGuard, type AuthenticatedRequest } from "@/common";
import { TransactionType, type TransactionDocument } from "@/schemas";

describe("TransactionsController", () => {
  let controller: TransactionsController;
  let mockTransactionsService: jest.Mocked<TransactionsService>;

  const createMockTransaction = (
    overrides: Partial<TransactionDocument> = {},
  ): TransactionDocument => {
    const now = new Date();
    return {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      type: TransactionType.DEPOSIT,
      amount: 100,
      balanceBefore: 0,
      balanceAfter: 100,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as TransactionDocument;
  };

  const createMockRequest = (
    userId?: string,
    username?: string,
  ): AuthenticatedRequest => {
    return {
      user: {
        sub: userId || new Types.ObjectId().toString(),
        username: username || "testuser",
      },
    } as AuthenticatedRequest;
  };

  beforeEach(async () => {
    mockTransactionsService = {
      getByUser: jest.fn(),
      getByAuction: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        {
          provide: TransactionsService,
          useValue: mockTransactionsService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Controller Initialization", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });

    it("should have getTransactions method", () => {
      expect(controller.getTransactions).toBeDefined();
      expect(typeof controller.getTransactions).toBe("function");
    });

    it("should be protected by AuthGuard", () => {
      const guards = Reflect.getMetadata("__guards__", TransactionsController);
      expect(guards).toBeDefined();
    });
  });

  describe("GET /transactions - Get all transactions with pagination", () => {
    it("should return paginated transactions with default limit (50) and offset (0)", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({ userId: new Types.ObjectId(userId) }),
        createMockTransaction({ userId: new Types.ObjectId(userId) }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        50,
        0,
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("type");
      expect(result[0]).toHaveProperty("amount");
    });

    it("should return transactions with custom limit parameter", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [createMockTransaction()];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, { limit: 10 });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        10,
        0,
      );
      expect(result).toHaveLength(1);
    });

    it("should return transactions with custom offset parameter", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [createMockTransaction()];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, { offset: 20 });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        50,
        20,
      );
      expect(result).toHaveLength(1);
    });

    it("should return transactions with both custom limit and offset", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [createMockTransaction()];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {
        limit: 25,
        offset: 50,
      });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        25,
        50,
      );
      expect(result).toHaveLength(1);
    });

    it("should return empty array when no transactions found", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it("should handle large result sets with maximum limit (100)", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = Array.from({ length: 100 }, () =>
        createMockTransaction(),
      );

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, { limit: 100 });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        100,
        0,
      );
      expect(result).toHaveLength(100);
    });

    it("should handle minimum limit (1)", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [createMockTransaction()];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, { limit: 1 });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        1,
        0,
      );
      expect(result).toHaveLength(1);
    });

    it("should return transactions sorted by most recent first", async () => {
      const userId = new Types.ObjectId().toString();
      const now = new Date();
      const earlier = new Date(now.getTime() - 1000);
      const earliest = new Date(now.getTime() - 2000);

      const mockTransactions = [
        createMockTransaction({ createdAt: now }),
        createMockTransaction({ createdAt: earlier }),
        createMockTransaction({ createdAt: earliest }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result).toHaveLength(3);
      expect(new Date(result[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result[1]!.createdAt).getTime(),
      );
      expect(new Date(result[1]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result[2]!.createdAt).getTime(),
      );
    });
  });

  describe("Response Format Validation", () => {
    it("should format response with all required fields", async () => {
      const userId = new Types.ObjectId().toString();
      const auctionId = new Types.ObjectId();
      const mockTransaction = createMockTransaction({
        userId: new Types.ObjectId(userId),
        type: TransactionType.BID_FREEZE,
        amount: 100,
        balanceBefore: 200,
        balanceAfter: 200,
        frozenBefore: 0,
        frozenAfter: 100,
        auctionId,
        description: "Test bid",
      });

      mockTransactionsService.getByUser.mockResolvedValue([mockTransaction]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]).toEqual({
        id: mockTransaction._id.toString(),
        type: TransactionType.BID_FREEZE,
        amount: 100,
        balanceBefore: 200,
        balanceAfter: 200,
        frozenBefore: 0,
        frozenAfter: 100,
        auctionId: auctionId.toString(),
        description: "Test bid",
        createdAt: mockTransaction.createdAt,
      });
    });

    it("should format response with null auctionId when not present", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransaction = createMockTransaction({
        type: TransactionType.DEPOSIT,
        auctionId: undefined,
      });

      mockTransactionsService.getByUser.mockResolvedValue([mockTransaction]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.auctionId).toBeNull();
    });

    it("should format response with undefined description when not present", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransaction = createMockTransaction({
        description: undefined,
      });

      mockTransactionsService.getByUser.mockResolvedValue([mockTransaction]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.description).toBeUndefined();
    });

    it("should format response with undefined frozen fields when not present", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransaction = createMockTransaction({
        type: TransactionType.DEPOSIT,
        frozenBefore: undefined,
        frozenAfter: undefined,
      });

      mockTransactionsService.getByUser.mockResolvedValue([mockTransaction]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.frozenBefore).toBeUndefined();
      expect(result[0]!.frozenAfter).toBeUndefined();
    });

    it("should convert ObjectId to string in response", async () => {
      const userId = new Types.ObjectId().toString();
      const transactionId = new Types.ObjectId();
      const mockTransaction = createMockTransaction({
        _id: transactionId,
      });

      mockTransactionsService.getByUser.mockResolvedValue([mockTransaction]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.id).toBe(transactionId.toString());
      expect(typeof result[0]!.id).toBe("string");
    });

    it("should preserve Date objects in createdAt field", async () => {
      const userId = new Types.ObjectId().toString();
      const now = new Date();
      const mockTransaction = createMockTransaction({
        createdAt: now,
      });

      mockTransactionsService.getByUser.mockResolvedValue([mockTransaction]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.createdAt).toEqual(now);
      expect(result[0]!.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("Permission Checks - User can only see own transactions", () => {
    it("should use authenticated user ID from request", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId, "testuser");
      await controller.getTransactions(req, {});

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("should not allow querying other users transactions", async () => {
      const user1Id = new Types.ObjectId().toString();
      const user2Id = new Types.ObjectId().toString();

      const user1Transactions = [
        createMockTransaction({ userId: new Types.ObjectId(user1Id) }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(user1Transactions);

      // User 1 is authenticated
      const req = createMockRequest(user1Id);
      const result = await controller.getTransactions(req, {});

      // Service is called with user1Id from authenticated request
      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        user1Id,
        50,
        0,
      );

      // Cannot access user2's transactions through this endpoint
      expect(mockTransactionsService.getByUser).not.toHaveBeenCalledWith(
        user2Id,
        expect.any(Number),
        expect.any(Number),
      );

      // Results only contain user1's transactions
      expect(result).toHaveLength(1);
    });

    it("should extract user ID from JWT payload in request", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId, "john_doe");

      await controller.getTransactions(req, {});

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        50,
        0,
      );
    });

    it("should use req.user.sub as the user identifier", async () => {
      const specificUserId = "507f1f77bcf86cd799439011";
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(specificUserId);
      await controller.getTransactions(req, {});

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        specificUserId,
        50,
        0,
      );
    });
  });

  describe("Transaction Types Filtering", () => {
    it("should return DEPOSIT transactions", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.DEPOSIT,
          amount: 100,
          balanceBefore: 0,
          balanceAfter: 100,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.type).toBe(TransactionType.DEPOSIT);
    });

    it("should return WITHDRAW transactions", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.WITHDRAW,
          amount: 50,
          balanceBefore: 100,
          balanceAfter: 50,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.type).toBe(TransactionType.WITHDRAW);
    });

    it("should return BID_FREEZE transactions", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.BID_FREEZE,
          amount: 100,
          balanceBefore: 200,
          balanceAfter: 200,
          frozenBefore: 0,
          frozenAfter: 100,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.type).toBe(TransactionType.BID_FREEZE);
      expect(result[0]!.frozenAfter).toBe(100);
    });

    it("should return BID_UNFREEZE transactions", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.BID_UNFREEZE,
          amount: 100,
          balanceBefore: 200,
          balanceAfter: 200,
          frozenBefore: 100,
          frozenAfter: 0,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.type).toBe(TransactionType.BID_UNFREEZE);
    });

    it("should return BID_WIN transactions", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.BID_WIN,
          amount: 100,
          balanceBefore: 200,
          balanceAfter: 100,
          frozenBefore: 100,
          frozenAfter: 0,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.type).toBe(TransactionType.BID_WIN);
    });

    it("should return BID_REFUND transactions", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.BID_REFUND,
          amount: 100,
          balanceBefore: 200,
          balanceAfter: 200,
          frozenBefore: 100,
          frozenAfter: 0,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.type).toBe(TransactionType.BID_REFUND);
    });

    it("should return mixed transaction types", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({ type: TransactionType.DEPOSIT }),
        createMockTransaction({ type: TransactionType.WITHDRAW }),
        createMockTransaction({ type: TransactionType.BID_FREEZE }),
        createMockTransaction({ type: TransactionType.BID_WIN }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result).toHaveLength(4);
      expect(result.map((t) => t.type)).toEqual([
        TransactionType.DEPOSIT,
        TransactionType.WITHDRAW,
        TransactionType.BID_FREEZE,
        TransactionType.BID_WIN,
      ]);
    });
  });

  describe("Pagination Edge Cases", () => {
    it("should handle offset larger than total records", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, { offset: 1000 });

      expect(result).toEqual([]);
    });

    it("should handle limit of 0 by passing to service", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      await controller.getTransactions(req, { limit: 0 });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        0,
        0,
      );
    });

    it("should handle negative offset by passing to service", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      await controller.getTransactions(req, { offset: -10 });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        50,
        -10,
      );
    });

    it("should handle undefined limit (default to 50)", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      await controller.getTransactions(req, { limit: undefined });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        50,
        0,
      );
    });

    it("should handle undefined offset (default to 0)", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      await controller.getTransactions(req, { offset: undefined });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        50,
        0,
      );
    });
  });

  describe("Balance and Amount Validation", () => {
    it("should handle transactions with zero balanceBefore", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          amount: 100,
          balanceBefore: 0,
          balanceAfter: 100,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.balanceBefore).toBe(0);
      expect(result[0]!.amount).toBe(100);
    });

    it("should handle transactions with large amounts", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          amount: 1000000,
          balanceBefore: 0,
          balanceAfter: 1000000,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.amount).toBe(1000000);
    });

    it("should handle transactions with minimum amount (1)", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          amount: 1,
          balanceBefore: 10,
          balanceAfter: 11,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.amount).toBe(1);
    });

    it("should preserve exact balance values", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          amount: 75,
          balanceBefore: 125,
          balanceAfter: 50,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.balanceBefore).toBe(125);
      expect(result[0]!.balanceAfter).toBe(50);
    });
  });

  describe("Error Handling", () => {
    it("should propagate service errors", async () => {
      const userId = new Types.ObjectId().toString();
      const error = new Error("Database connection failed");
      mockTransactionsService.getByUser.mockRejectedValue(error);

      const req = createMockRequest(userId);

      await expect(controller.getTransactions(req, {})).rejects.toThrow(
        "Database connection failed",
      );
    });

    it("should handle service returning null", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue(null as any);

      const req = createMockRequest(userId);

      // Should throw when trying to map over null
      await expect(controller.getTransactions(req, {})).rejects.toThrow();
    });

    it("should handle service returning undefined", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue(undefined as any);

      const req = createMockRequest(userId);

      // Should throw when trying to map over undefined
      await expect(controller.getTransactions(req, {})).rejects.toThrow();
    });

    it("should handle malformed transaction data gracefully", async () => {
      const userId = new Types.ObjectId().toString();
      const malformedTransaction = {
        _id: {
          toString: () => {
            throw new Error("Invalid ObjectId");
          },
        },
      } as any as TransactionDocument;

      mockTransactionsService.getByUser.mockResolvedValue([
        malformedTransaction,
      ]);

      const req = createMockRequest(userId);

      // Should throw when trying to convert invalid ObjectId
      await expect(controller.getTransactions(req, {})).rejects.toThrow(
        "Invalid ObjectId",
      );
    });
  });

  describe("Integration - Full Transaction History", () => {
    it("should retrieve full transaction history with multiple pages", async () => {
      const userId = new Types.ObjectId().toString();

      // First page
      const page1Transactions = Array.from({ length: 50 }, (_, i) =>
        createMockTransaction({
          amount: 100 + i,
          createdAt: new Date(Date.now() - i * 1000),
        }),
      );

      // Second page
      const page2Transactions = Array.from({ length: 30 }, (_, i) =>
        createMockTransaction({
          amount: 50 + i,
          createdAt: new Date(Date.now() - (i + 50) * 1000),
        }),
      );

      mockTransactionsService.getByUser
        .mockResolvedValueOnce(page1Transactions)
        .mockResolvedValueOnce(page2Transactions);

      const req = createMockRequest(userId);

      // Get first page
      const result1 = await controller.getTransactions(req, { limit: 50 });
      expect(result1).toHaveLength(50);

      // Get second page
      const result2 = await controller.getTransactions(req, {
        limit: 50,
        offset: 50,
      });
      expect(result2).toHaveLength(30);

      expect(mockTransactionsService.getByUser).toHaveBeenCalledTimes(2);
    });

    it("should handle concurrent transaction history queries", async () => {
      const user1Id = new Types.ObjectId().toString();
      const user2Id = new Types.ObjectId().toString();

      mockTransactionsService.getByUser
        .mockResolvedValueOnce([createMockTransaction()])
        .mockResolvedValueOnce([createMockTransaction()]);

      const req1 = createMockRequest(user1Id);
      const req2 = createMockRequest(user2Id);

      const [result1, result2] = await Promise.all([
        controller.getTransactions(req1, {}),
        controller.getTransactions(req2, {}),
      ]);

      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);
      expect(mockTransactionsService.getByUser).toHaveBeenCalledTimes(2);
    });
  });

  describe("Complex Transaction Scenarios", () => {
    it("should handle transaction with all optional fields populated", async () => {
      const userId = new Types.ObjectId().toString();
      const auctionId = new Types.ObjectId();

      const mockTransaction = createMockTransaction({
        type: TransactionType.BID_WIN,
        amount: 500,
        balanceBefore: 1000,
        balanceAfter: 500,
        frozenBefore: 500,
        frozenAfter: 0,
        auctionId,
        description: "Won auction item #42",
      });

      mockTransactionsService.getByUser.mockResolvedValue([mockTransaction]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]).toMatchObject({
        type: TransactionType.BID_WIN,
        amount: 500,
        balanceBefore: 1000,
        balanceAfter: 500,
        frozenBefore: 500,
        frozenAfter: 0,
        auctionId: auctionId.toString(),
        description: "Won auction item #42",
      });
    });

    it("should handle multiple transactions for same auction", async () => {
      const userId = new Types.ObjectId().toString();
      const auctionId = new Types.ObjectId();

      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.BID_FREEZE,
          auctionId,
          amount: 100,
        }),
        createMockTransaction({
          type: TransactionType.BID_UNFREEZE,
          auctionId,
          amount: 100,
        }),
        createMockTransaction({
          type: TransactionType.BID_FREEZE,
          auctionId,
          amount: 150,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result).toHaveLength(3);
      result.forEach((transaction) => {
        expect(transaction.auctionId).toBe(auctionId.toString());
      });
    });

    it("should handle user with only deposit transactions", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.DEPOSIT,
          amount: 100,
        }),
        createMockTransaction({
          type: TransactionType.DEPOSIT,
          amount: 200,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result).toHaveLength(2);
      expect(result.every((t) => t.type === TransactionType.DEPOSIT)).toBe(
        true,
      );
    });

    it("should handle user with no auction-related transactions", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTransactions = [
        createMockTransaction({
          type: TransactionType.DEPOSIT,
          auctionId: undefined,
        }),
        createMockTransaction({
          type: TransactionType.WITHDRAW,
          auctionId: undefined,
        }),
      ];

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result).toHaveLength(2);
      expect(result.every((t) => t.auctionId === null)).toBe(true);
    });
  });

  describe("Date and Timestamp Handling", () => {
    it("should preserve transaction timestamps accurately", async () => {
      const userId = new Types.ObjectId().toString();
      const specificDate = new Date("2024-01-15T10:30:00Z");

      const mockTransaction = createMockTransaction({
        createdAt: specificDate,
      });

      mockTransactionsService.getByUser.mockResolvedValue([mockTransaction]);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result[0]!.createdAt).toEqual(specificDate);
      expect(result[0]!.createdAt.toISOString()).toBe(
        "2024-01-15T10:30:00.000Z",
      );
    });

    it("should handle transactions created at different times", async () => {
      const userId = new Types.ObjectId().toString();
      const dates = [
        new Date("2024-01-01T00:00:00Z"),
        new Date("2024-01-02T12:00:00Z"),
        new Date("2024-01-03T23:59:59Z"),
      ];

      const mockTransactions = dates.map((date) =>
        createMockTransaction({ createdAt: date }),
      );

      mockTransactionsService.getByUser.mockResolvedValue(mockTransactions);

      const req = createMockRequest(userId);
      const result = await controller.getTransactions(req, {});

      expect(result).toHaveLength(3);
      result.forEach((transaction, index) => {
        expect(transaction.createdAt).toEqual(dates[index]);
      });
    });
  });

  describe("Service Method Invocation", () => {
    it("should call getByUser with correct parameters", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      await controller.getTransactions(req, { limit: 25, offset: 10 });

      expect(mockTransactionsService.getByUser).toHaveBeenCalledTimes(1);
      expect(mockTransactionsService.getByUser).toHaveBeenCalledWith(
        userId,
        25,
        10,
      );
    });

    it("should only call service once per request", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      await controller.getTransactions(req, {});

      expect(mockTransactionsService.getByUser).toHaveBeenCalledTimes(1);
    });

    it("should not call service methods other than getByUser", async () => {
      const userId = new Types.ObjectId().toString();
      mockTransactionsService.getByUser.mockResolvedValue([]);

      const req = createMockRequest(userId);
      await controller.getTransactions(req, {});

      expect(mockTransactionsService.getByAuction).not.toHaveBeenCalled();
    });
  });
});
