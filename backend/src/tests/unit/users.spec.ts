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
import { getModelToken, getConnectionToken } from "@nestjs/mongoose";
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { UsersService } from "@/modules/users/users.service";
import { User, Transaction, TransactionType } from "@/schemas";
import { Types } from "mongoose";

describe("UsersService", () => {
  let service: UsersService;
  let mockUserModel: {
    findById: Mock;
    findOne: Mock;
    findByIdAndUpdate: Mock;
    findOneAndUpdate: Mock;
    create: Mock;
  };
  let mockTransactionModel: { create: Mock };
  let mockConnection: { startSession: Mock };
  let mockSession: {
    startTransaction: Mock;
    commitTransaction: Mock;
    abortTransaction: Mock;
    endSession: Mock;
  };

  const mockUserId = new Types.ObjectId();
  const mockAuctionId = new Types.ObjectId();
  const mockBidId = new Types.ObjectId();

  beforeEach(async () => {
    // Mock session
    mockSession = {
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      endSession: vi.fn(),
    };

    // Mock connection
    mockConnection = {
      startSession: vi.fn().mockResolvedValue(mockSession),
    };

    // Mock UserModel
    mockUserModel = {
      findById: vi.fn(),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOneAndUpdate: vi.fn(),
      create: vi.fn(),
    };

    // Mock TransactionModel
    mockTransactionModel = {
      create: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Transaction.name),
          useValue: mockTransactionModel,
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });
  });

  describe("getBalance", () => {
    it("should return user balance and frozen balance for valid user", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 200,
      };

      mockUserModel.findById.mockResolvedValue(mockUser);

      const result = await service.getBalance(mockUserId.toString());

      expect(result).toEqual({
        balance: 1000,
        frozenBalance: 200,
      });
      expect(mockUserModel.findById).toHaveBeenCalledWith(
        mockUserId.toString(),
      );
    });

    it("should throw NotFoundException when user does not exist", async () => {
      mockUserModel.findById.mockResolvedValue(null);

      await expect(service.getBalance(mockUserId.toString())).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getBalance(mockUserId.toString())).rejects.toThrow(
        "User not found",
      );
    });

    it("should handle user with zero balance", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 0,
        frozenBalance: 0,
      };

      mockUserModel.findById.mockResolvedValue(mockUser);

      const result = await service.getBalance(mockUserId.toString());

      expect(result).toEqual({
        balance: 0,
        frozenBalance: 0,
      });
    });

    it("should handle large balance values", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: Number.MAX_SAFE_INTEGER,
        frozenBalance: 999999999,
      };

      mockUserModel.findById.mockResolvedValue(mockUser);

      const result = await service.getBalance(mockUserId.toString());

      expect(result).toEqual({
        balance: Number.MAX_SAFE_INTEGER,
        frozenBalance: 999999999,
      });
    });
  });

  describe("deposit", () => {
    it("should successfully deposit valid amount", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 1500,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      const result = await service.deposit(mockUserId.toString(), 500);

      expect(result).toEqual(mockUpdatedUser);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: mockUserId,
            type: TransactionType.DEPOSIT,
            amount: 500,
            balanceBefore: 1000,
            balanceAfter: 1500,
          }),
        ],
        { session: mockSession },
      );
    });

    it("should throw BadRequestException for zero amount", async () => {
      await expect(service.deposit(mockUserId.toString(), 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deposit(mockUserId.toString(), 0)).rejects.toThrow(
        "Amount must be a positive integer",
      );
    });

    it("should throw BadRequestException for negative amount", async () => {
      await expect(
        service.deposit(mockUserId.toString(), -100),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for non-integer amount", async () => {
      await expect(
        service.deposit(mockUserId.toString(), 123.45),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when user does not exist", async () => {
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      });

      await expect(service.deposit(mockUserId.toString(), 100)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it("should throw ConflictException on concurrent modification", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.deposit(mockUserId.toString(), 100)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.deposit(mockUserId.toString(), 100)).rejects.toThrow(
        "Concurrent modification detected",
      );
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should rollback transaction on error", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(
        service.deposit(mockUserId.toString(), 100),
      ).rejects.toThrow();
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it("should handle large deposit amounts", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        version: 1,
      };
      const largeAmount = 999999999;
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 1000 + largeAmount,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      const result = await service.deposit(mockUserId.toString(), largeAmount);

      expect(result.balance).toBe(1000 + largeAmount);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });
  });

  describe("withdraw", () => {
    it("should successfully withdraw valid amount", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 700,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      const result = await service.withdraw(mockUserId.toString(), 300);

      expect(result).toEqual(mockUpdatedUser);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: mockUserId,
            type: TransactionType.WITHDRAW,
            amount: 300,
            balanceBefore: 1000,
            balanceAfter: 700,
          }),
        ],
        { session: mockSession },
      );
    });

    it("should throw BadRequestException for zero amount", async () => {
      await expect(service.withdraw(mockUserId.toString(), 0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException for negative amount", async () => {
      await expect(
        service.withdraw(mockUserId.toString(), -100),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for non-integer amount", async () => {
      await expect(
        service.withdraw(mockUserId.toString(), 50.75),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when user does not exist", async () => {
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.withdraw(mockUserId.toString(), 100),
      ).rejects.toThrow(NotFoundException);
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should throw BadRequestException for insufficient balance", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 100,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      await expect(
        service.withdraw(mockUserId.toString(), 500),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.withdraw(mockUserId.toString(), 500),
      ).rejects.toThrow("Insufficient balance");
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should throw ConflictException on concurrent modification", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.withdraw(mockUserId.toString(), 100),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.withdraw(mockUserId.toString(), 100),
      ).rejects.toThrow("Concurrent modification or insufficient balance");
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it("should handle withdrawal leaving zero balance", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 0,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      const result = await service.withdraw(mockUserId.toString(), 1000);

      expect(result.balance).toBe(0);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it("should handle withdrawal of exact available balance", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 150,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 0,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      const result = await service.withdraw(mockUserId.toString(), 150);

      expect(result.balance).toBe(0);
    });
  });

  describe("updateLanguage", () => {
    it("should update language to valid code (en)", async () => {
      const mockUser = {
        _id: mockUserId,
        languageCode: "en",
      };

      mockUserModel.findByIdAndUpdate.mockResolvedValue(mockUser);

      const result = await service.updateLanguage(mockUserId.toString(), "en");

      expect(result).toBe("en");
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockUserId.toString(),
        { languageCode: "en" },
        { new: true },
      );
    });

    it("should update language to valid code (ru)", async () => {
      const mockUser = {
        _id: mockUserId,
        languageCode: "ru",
      };

      mockUserModel.findByIdAndUpdate.mockResolvedValue(mockUser);

      const result = await service.updateLanguage(mockUserId.toString(), "ru");

      expect(result).toBe("ru");
    });

    it("should default to 'en' for invalid language code", async () => {
      const mockUser = {
        _id: mockUserId,
        languageCode: "en",
      };

      mockUserModel.findByIdAndUpdate.mockResolvedValue(mockUser);

      const result = await service.updateLanguage(mockUserId.toString(), "fr");

      expect(result).toBe("en");
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockUserId.toString(),
        { languageCode: "en" },
        { new: true },
      );
    });

    it("should default to 'en' for empty string", async () => {
      const mockUser = {
        _id: mockUserId,
        languageCode: "en",
      };

      mockUserModel.findByIdAndUpdate.mockResolvedValue(mockUser);

      const result = await service.updateLanguage(mockUserId.toString(), "");

      expect(result).toBe("en");
    });

    it("should throw NotFoundException when user does not exist", async () => {
      mockUserModel.findByIdAndUpdate.mockResolvedValue(null);

      await expect(
        service.updateLanguage(mockUserId.toString(), "en"),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateLanguage(mockUserId.toString(), "en"),
      ).rejects.toThrow("User not found");
    });

    it("should handle user with undefined languageCode", async () => {
      const mockUser = {
        _id: mockUserId,
        languageCode: undefined,
      };

      mockUserModel.findByIdAndUpdate.mockResolvedValue(mockUser);

      const result = await service.updateLanguage(mockUserId.toString(), "ru");

      expect(result).toBe("en");
    });
  });

  describe("freezeBalance", () => {
    it("should successfully freeze balance", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.freezeBalance(
        mockUserId,
        300,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: mockUserId,
          version: 1,
          balance: { $gte: 300 },
        },
        {
          $inc: {
            balance: -300,
            frozenBalance: 300,
            version: 1,
          },
        },
        { new: true, session: mockSession },
      );
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: TransactionType.BID_FREEZE,
            amount: 300,
          }),
        ],
        { session: mockSession },
      );
    });

    it("should throw NotFoundException when user does not exist", async () => {
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.freezeBalance(
          mockUserId,
          100,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException for insufficient balance", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 50,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      await expect(
        service.freezeBalance(
          mockUserId,
          100,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.freezeBalance(
          mockUserId,
          100,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow("Insufficient balance");
    });

    it("should throw ConflictException when freeze fails", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.freezeBalance(
          mockUserId,
          100,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.freezeBalance(
          mockUserId,
          100,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow("Failed to freeze balance");
    });

    it("should work without session parameter", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.freezeBalance(mockUserId, 300, mockAuctionId, mockBidId);

      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalled();
    });
  });

  describe("unfreezeBalance", () => {
    it("should successfully unfreeze balance", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.unfreezeBalance(
        mockUserId,
        300,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: mockUserId,
          version: 1,
          frozenBalance: { $gte: 300 },
        },
        {
          $inc: {
            frozenBalance: -300,
            balance: 300,
            version: 1,
          },
        },
        { new: true, session: mockSession },
      );
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: TransactionType.BID_UNFREEZE,
            amount: 300,
          }),
        ],
        { session: mockSession },
      );
    });

    it("should throw NotFoundException when user does not exist", async () => {
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.unfreezeBalance(
          mockUserId,
          100,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException when unfreeze fails", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.unfreezeBalance(
          mockUserId,
          400,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.unfreezeBalance(
          mockUserId,
          400,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow("Failed to unfreeze balance");
    });
  });

  describe("confirmBidWin", () => {
    it("should successfully confirm bid win", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 0,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.confirmBidWin(
        mockUserId,
        300,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: mockUserId,
          version: 1,
          frozenBalance: { $gte: 300 },
        },
        {
          $inc: {
            frozenBalance: -300,
            version: 1,
          },
        },
        { new: true, session: mockSession },
      );
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: TransactionType.BID_WIN,
            amount: 300,
          }),
        ],
        { session: mockSession },
      );
    });

    it("should throw NotFoundException when user does not exist", async () => {
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.confirmBidWin(
          mockUserId,
          100,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException when confirmation fails", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.confirmBidWin(
          mockUserId,
          500,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.confirmBidWin(
          mockUserId,
          500,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow("Failed to confirm bid win");
    });
  });

  describe("refundBid", () => {
    it("should successfully refund bid", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.refundBid(
        mockUserId,
        300,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: mockUserId,
          version: 1,
          frozenBalance: { $gte: 300 },
        },
        {
          $inc: {
            frozenBalance: -300,
            balance: 300,
            version: 1,
          },
        },
        { new: true, session: mockSession },
      );
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: TransactionType.BID_REFUND,
            amount: 300,
          }),
        ],
        { session: mockSession },
      );
    });

    it("should throw NotFoundException when user does not exist", async () => {
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.refundBid(
          mockUserId,
          100,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException when refund fails", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 1,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.refundBid(
          mockUserId,
          500,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.refundBid(
          mockUserId,
          500,
          mockAuctionId,
          mockBidId,
          mockSession,
        ),
      ).rejects.toThrow("Failed to refund bid");
    });
  });

  describe("createBot", () => {
    it("should successfully create bot with valid data", async () => {
      const mockBot = {
        _id: mockUserId,
        username: "TestBot",
        balance: 10000,
        frozenBalance: 0,
        isBot: true,
        version: 0,
      };

      mockUserModel.create.mockResolvedValue(mockBot);

      const result = await service.createBot("TestBot", 10000);

      expect(result).toEqual(mockBot);
      expect(mockUserModel.create).toHaveBeenCalledWith({
        username: "TestBot",
        balance: 10000,
        frozenBalance: 0,
        isBot: true,
        version: 0,
      });
    });

    it("should create bot with zero balance", async () => {
      const mockBot = {
        _id: mockUserId,
        username: "PoorBot",
        balance: 0,
        frozenBalance: 0,
        isBot: true,
        version: 0,
      };

      mockUserModel.create.mockResolvedValue(mockBot);

      const result = await service.createBot("PoorBot", 0);

      expect(result.balance).toBe(0);
    });
  });

  describe("findById", () => {
    it("should find user by valid id", async () => {
      const mockUser = {
        _id: mockUserId,
        username: "TestUser",
        balance: 1000,
      };

      mockUserModel.findById.mockResolvedValue(mockUser);

      const result = await service.findById(mockUserId);

      expect(result).toEqual(mockUser);
      expect(mockUserModel.findById).toHaveBeenCalledWith(mockUserId);
    });

    it("should return null when user not found", async () => {
      mockUserModel.findById.mockResolvedValue(null);

      const result = await service.findById(mockUserId);

      expect(result).toBeNull();
    });

    it("should accept string userId", async () => {
      const mockUser = {
        _id: mockUserId,
        username: "TestUser",
      };

      mockUserModel.findById.mockResolvedValue(mockUser);

      const result = await service.findById(mockUserId.toString());

      expect(result).toEqual(mockUser);
    });
  });

  describe("findByIdForUpdate", () => {
    it("should find user by id with session", async () => {
      const mockUser = {
        _id: mockUserId,
        username: "TestUser",
        balance: 1000,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });

      const result = await service.findByIdForUpdate(mockUserId, mockSession);

      expect(result).toEqual(mockUser);
    });

    it("should return null when user not found", async () => {
      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(null),
      });

      const result = await service.findByIdForUpdate(mockUserId, mockSession);

      expect(result).toBeNull();
    });
  });

  describe("Balance Consistency", () => {
    it("should maintain balance consistency after multiple deposits", async () => {
      const initialBalance = 1000;
      let currentBalance = initialBalance;

      for (let i = 0; i < 3; i++) {
        const depositAmount = 100 * (i + 1);
        const mockUser = {
          _id: mockUserId,
          balance: currentBalance,
          version: i + 1,
        };
        currentBalance += depositAmount;
        const mockUpdatedUser = {
          _id: mockUserId,
          balance: currentBalance,
          version: i + 2,
        };

        mockUserModel.findById.mockReturnValue({
          session: vi.fn().mockResolvedValue(mockUser),
        });
        mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
        mockTransactionModel.create.mockResolvedValue([{}]);

        const result = await service.deposit(
          mockUserId.toString(),
          depositAmount,
        );
        expect(result.balance).toBe(currentBalance);
      }

      expect(currentBalance).toBe(initialBalance + 100 + 200 + 300);
    });

    it("should maintain balance consistency with frozen balance operations", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        frozenBalance: 0,
        version: 1,
      };

      // Freeze 300
      const mockUserAfterFreeze = {
        _id: mockUserId,
        balance: 700,
        frozenBalance: 300,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUserAfterFreeze);
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.freezeBalance(
        mockUserId,
        300,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(
        mockUserAfterFreeze.balance + mockUserAfterFreeze.frozenBalance,
      ).toBe(1000);
    });
  });

  describe("Edge Cases and Race Conditions", () => {
    it("should handle rapid concurrent deposits with version control", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 1000,
        version: 1,
      };

      // First attempt succeeds
      mockUserModel.findById.mockReturnValueOnce({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValueOnce({
        _id: mockUserId,
        balance: 1100,
        version: 2,
      });
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.deposit(mockUserId.toString(), 100);

      // Second concurrent attempt fails due to version mismatch
      mockUserModel.findById.mockReturnValueOnce({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValueOnce(null);

      await expect(service.deposit(mockUserId.toString(), 50)).rejects.toThrow(
        ConflictException,
      );
    });

    it("should handle edge case of withdrawing minimum amount (1)", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: 10,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: 9,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      const result = await service.withdraw(mockUserId.toString(), 1);

      expect(result.balance).toBe(9);
    });

    it("should handle edge case of maximum balance near Number.MAX_SAFE_INTEGER", async () => {
      const mockUser = {
        _id: mockUserId,
        balance: Number.MAX_SAFE_INTEGER - 1000,
        version: 1,
      };
      const mockUpdatedUser = {
        _id: mockUserId,
        balance: Number.MAX_SAFE_INTEGER - 900,
        version: 2,
      };

      mockUserModel.findById.mockReturnValue({
        session: vi.fn().mockResolvedValue(mockUser),
      });
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUpdatedUser);
      mockTransactionModel.create.mockResolvedValue([{}]);

      const result = await service.deposit(mockUserId.toString(), 100);

      expect(result.balance).toBe(Number.MAX_SAFE_INTEGER - 900);
    });
  });

  describe("recordTransaction", () => {
    it("should record bid_freeze transaction", async () => {
      const anyObjectId = expect.any(
        Types.ObjectId,
      ) as unknown as Types.ObjectId;

      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.recordTransaction(
        mockUserId.toString(),
        "bid_freeze",
        100,
        1000,
        900,
        0,
        100,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: anyObjectId,
            type: TransactionType.BID_FREEZE,
            amount: 100,
            balanceBefore: 1000,
            balanceAfter: 900,
            frozenBefore: 0,
            frozenAfter: 100,
            auctionId: mockAuctionId,
            bidId: mockBidId,
            description: "Bid placed: 100 Stars frozen",
          }),
        ],
        { session: mockSession },
      );
    });

    it("should record bid_unfreeze transaction", async () => {
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.recordTransaction(
        mockUserId.toString(),
        "bid_unfreeze",
        100,
        900,
        1000,
        100,
        0,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: TransactionType.BID_UNFREEZE,
            description: "Bid cancelled: 100 Stars unfrozen",
          }),
        ],
        { session: mockSession },
      );
    });

    it("should record bid_win transaction", async () => {
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.recordTransaction(
        mockUserId.toString(),
        "bid_win",
        100,
        1000,
        1000,
        100,
        0,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: TransactionType.BID_WIN,
            description: "Won auction item for 100 Stars",
          }),
        ],
        { session: mockSession },
      );
    });

    it("should record bid_refund transaction", async () => {
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.recordTransaction(
        mockUserId.toString(),
        "bid_refund",
        100,
        900,
        1000,
        100,
        0,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: TransactionType.BID_REFUND,
            description: "Bid refunded: 100 Stars returned",
          }),
        ],
        { session: mockSession },
      );
    });

    it("should default to DEPOSIT for unknown transaction type", async () => {
      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.recordTransaction(
        mockUserId.toString(),
        "unknown_type",
        100,
        1000,
        1100,
        0,
        0,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: TransactionType.DEPOSIT,
            description: "Transaction of 100 Stars",
          }),
        ],
        { session: mockSession },
      );
    });

    it("should handle string userId by converting to ObjectId", async () => {
      const anyObjectId = expect.any(
        Types.ObjectId,
      ) as unknown as Types.ObjectId;

      mockTransactionModel.create.mockResolvedValue([{}]);

      await service.recordTransaction(
        mockUserId.toString(),
        "bid_freeze",
        100,
        1000,
        900,
        0,
        100,
        mockAuctionId,
        mockBidId,
        mockSession,
      );

      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: anyObjectId,
          }),
        ],
        { session: mockSession },
      );
    });
  });
});
