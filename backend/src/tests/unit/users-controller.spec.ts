/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, type TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { UsersController } from "@/modules/users/users.controller";
import { UsersService } from "@/modules/users/users.service";
import { AuthGuard, type AuthenticatedRequest } from "@/common";
import type {
  IBalance,
  IBalanceResponse,
  ILanguageUpdate,
} from "@/modules/users/dto";
import type { UserDocument } from "@/schemas";

describe("UsersController", () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUserId = "507f1f77bcf86cd799439011";
  const mockUser: Partial<UserDocument> = {
    _id: mockUserId as any,
    username: "testuser",
    balance: 1000,
    frozenBalance: 200,
    languageCode: "en",
    isBot: false,
    version: 1,
  };

  const mockAuthenticatedRequest = {
    user: { sub: mockUserId, username: "testuser" },
  } as AuthenticatedRequest;

  const mockUsersService = {
    getBalance: jest.fn(),
    deposit: jest.fn(),
    withdraw: jest.fn(),
    updateLanguage: jest.fn(),
    findById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /users/balance", () => {
    it("should get user balance with valid JWT", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 1000,
        frozenBalance: 200,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(result).toEqual(expectedResponse);
      expect(service.getBalance).toHaveBeenCalledWith(mockUserId);
      expect(service.getBalance).toHaveBeenCalledTimes(1);
    });

    it("should return balance with zero values", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 0,
        frozenBalance: 0,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(result).toEqual(expectedResponse);
      expect(result.balance).toBe(0);
      expect(result.frozenBalance).toBe(0);
    });

    it("should throw NotFoundException when user not found", async () => {
      mockUsersService.getBalance.mockRejectedValue(
        new NotFoundException("User not found"),
      );

      await expect(
        controller.getBalance(mockAuthenticatedRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return balance with large values", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 999999999,
        frozenBalance: 888888888,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(result).toEqual(expectedResponse);
      expect(result.balance).toBe(999999999);
      expect(result.frozenBalance).toBe(888888888);
    });

    it("should return response with correct structure", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 1000,
        frozenBalance: 200,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(result).toHaveProperty("balance");
      expect(result).toHaveProperty("frozenBalance");
      expect(typeof result.balance).toBe("number");
      expect(typeof result.frozenBalance).toBe("number");
    });

    it("should extract user ID from JWT payload", async () => {
      const customRequest = {
        user: { sub: "123456789012345678901234", username: "custom" },
      } as AuthenticatedRequest;
      const expectedResponse: IBalanceResponse = {
        balance: 500,
        frozenBalance: 100,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      await controller.getBalance(customRequest);

      expect(service.getBalance).toHaveBeenCalledWith(
        "123456789012345678901234",
      );
    });
  });

  describe("PUT /users/language", () => {
    it("should update language to English successfully", async () => {
      const body: ILanguageUpdate = { language: "en" };
      mockUsersService.updateLanguage.mockResolvedValue("en");

      const result = await controller.updateLanguage(
        mockAuthenticatedRequest,
        body,
      );

      expect(result).toEqual({ languageCode: "en" });
      expect(service.updateLanguage).toHaveBeenCalledWith(mockUserId, "en");
    });

    it("should update language to Russian successfully", async () => {
      const body: ILanguageUpdate = { language: "ru" };
      mockUsersService.updateLanguage.mockResolvedValue("ru");

      const result = await controller.updateLanguage(
        mockAuthenticatedRequest,
        body,
      );

      expect(result).toEqual({ languageCode: "ru" });
      expect(service.updateLanguage).toHaveBeenCalledWith(mockUserId, "ru");
    });

    it("should throw NotFoundException when user not found", async () => {
      const body: ILanguageUpdate = { language: "en" };
      mockUsersService.updateLanguage.mockRejectedValue(
        new NotFoundException("User not found"),
      );

      await expect(
        controller.updateLanguage(mockAuthenticatedRequest, body),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return correct response structure", async () => {
      const body: ILanguageUpdate = { language: "en" };
      mockUsersService.updateLanguage.mockResolvedValue("en");

      const result = await controller.updateLanguage(
        mockAuthenticatedRequest,
        body,
      );

      expect(result).toHaveProperty("languageCode");
      expect(typeof result.languageCode).toBe("string");
    });

    it("should handle service returning default language", async () => {
      const body: ILanguageUpdate = { language: "en" };
      mockUsersService.updateLanguage.mockResolvedValue("en");

      const result = await controller.updateLanguage(
        mockAuthenticatedRequest,
        body,
      );

      expect(result.languageCode).toBe("en");
    });
  });

  describe("POST /users/deposit", () => {
    it("should deposit funds successfully with valid amount", async () => {
      const body: IBalance = { amount: 500 };
      const updatedUser = { ...mockUser, balance: 1500 } as UserDocument;
      mockUsersService.deposit.mockResolvedValue(updatedUser);

      const result = await controller.deposit(mockAuthenticatedRequest, body);

      expect(result).toEqual({
        balance: 1500,
        frozenBalance: 200,
      });
      expect(service.deposit).toHaveBeenCalledWith(mockUserId, 500);
    });

    it("should throw BadRequestException for zero amount", async () => {
      const body: IBalance = { amount: 0 };
      mockUsersService.deposit.mockRejectedValue(
        new BadRequestException("Amount must be a positive integer"),
      );

      await expect(
        controller.deposit(mockAuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for negative amount", async () => {
      const body: IBalance = { amount: -100 };
      mockUsersService.deposit.mockRejectedValue(
        new BadRequestException("Amount must be a positive integer"),
      );

      await expect(
        controller.deposit(mockAuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle large deposit amounts", async () => {
      const body: IBalance = { amount: 1000000 };
      const updatedUser = { ...mockUser, balance: 1001000 } as UserDocument;
      mockUsersService.deposit.mockResolvedValue(updatedUser);

      const result = await controller.deposit(mockAuthenticatedRequest, body);

      expect(result.balance).toBe(1001000);
    });

    it("should verify balance update after deposit", async () => {
      const body: IBalance = { amount: 250 };
      const initialBalance = 1000;
      const updatedUser = {
        ...mockUser,
        balance: initialBalance + body.amount,
      } as UserDocument;
      mockUsersService.deposit.mockResolvedValue(updatedUser);

      const result = await controller.deposit(mockAuthenticatedRequest, body);

      expect(result.balance).toBe(1250);
      expect(result.frozenBalance).toBe(200);
    });

    it("should throw NotFoundException when user not found", async () => {
      const body: IBalance = { amount: 100 };
      mockUsersService.deposit.mockRejectedValue(
        new NotFoundException("User not found"),
      );

      await expect(
        controller.deposit(mockAuthenticatedRequest, body),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("POST /users/withdraw", () => {
    it("should withdraw funds successfully with sufficient balance", async () => {
      const body: IBalance = { amount: 300 };
      const updatedUser = { ...mockUser, balance: 700 } as UserDocument;
      mockUsersService.withdraw.mockResolvedValue(updatedUser);

      const result = await controller.withdraw(mockAuthenticatedRequest, body);

      expect(result).toEqual({
        balance: 700,
        frozenBalance: 200,
      });
      expect(service.withdraw).toHaveBeenCalledWith(mockUserId, 300);
    });

    it("should throw BadRequestException for insufficient balance", async () => {
      const body: IBalance = { amount: 2000 };
      mockUsersService.withdraw.mockRejectedValue(
        new BadRequestException("Insufficient balance"),
      );

      await expect(
        controller.withdraw(mockAuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for negative amount", async () => {
      const body: IBalance = { amount: -50 };
      mockUsersService.withdraw.mockRejectedValue(
        new BadRequestException("Amount must be a positive integer"),
      );

      await expect(
        controller.withdraw(mockAuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for zero amount", async () => {
      const body: IBalance = { amount: 0 };
      mockUsersService.withdraw.mockRejectedValue(
        new BadRequestException("Amount must be a positive integer"),
      );

      await expect(
        controller.withdraw(mockAuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it("should verify balance update after withdrawal", async () => {
      const body: IBalance = { amount: 100 };
      const initialBalance = 1000;
      const updatedUser = {
        ...mockUser,
        balance: initialBalance - body.amount,
      } as UserDocument;
      mockUsersService.withdraw.mockResolvedValue(updatedUser);

      const result = await controller.withdraw(mockAuthenticatedRequest, body);

      expect(result.balance).toBe(900);
      expect(result.frozenBalance).toBe(200);
    });

    it("should throw ConflictException for concurrent withdrawal", async () => {
      const body: IBalance = { amount: 100 };
      mockUsersService.withdraw.mockRejectedValue(
        new ConflictException(
          "Concurrent modification or insufficient balance",
        ),
      );

      await expect(
        controller.withdraw(mockAuthenticatedRequest, body),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("Balance Operations", () => {
    it("should return available balance correctly", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 1000,
        frozenBalance: 200,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(result.balance).toBe(1000);
    });

    it("should return frozen balance correctly", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 1000,
        frozenBalance: 200,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(result.frozenBalance).toBe(200);
    });

    it("should calculate total balance correctly", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 1000,
        frozenBalance: 200,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);
      const totalBalance = result.balance + result.frozenBalance;

      expect(totalBalance).toBe(1200);
    });

    it("should handle balance updates after deposit transaction", async () => {
      const depositAmount = 500;
      const updatedUser = {
        ...mockUser,
        balance: mockUser.balance! + depositAmount,
      } as UserDocument;
      mockUsersService.deposit.mockResolvedValue(updatedUser);

      const result = await controller.deposit(mockAuthenticatedRequest, {
        amount: depositAmount,
      });

      expect(result.balance).toBe(1500);
    });

    it("should handle float precision for balance operations", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 999999999,
        frozenBalance: 1,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(Number.isInteger(result.balance)).toBe(true);
      expect(Number.isInteger(result.frozenBalance)).toBe(true);
    });

    it("should handle large balance values", async () => {
      const largeBalance = 999999999;
      const expectedResponse: IBalanceResponse = {
        balance: largeBalance,
        frozenBalance: largeBalance,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(result.balance).toBe(largeBalance);
      expect(result.frozenBalance).toBe(largeBalance);
    });
  });

  describe("Error Scenarios", () => {
    it("should handle 400 Bad Request validation errors", async () => {
      const body: IBalance = { amount: -100 };
      mockUsersService.deposit.mockRejectedValue(
        new BadRequestException("Amount must be a positive integer"),
      );

      await expect(
        controller.deposit(mockAuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle 404 Not Found errors", async () => {
      mockUsersService.getBalance.mockRejectedValue(
        new NotFoundException("User not found"),
      );

      await expect(
        controller.getBalance(mockAuthenticatedRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it("should handle 409 Conflict errors for concurrent modifications", async () => {
      const body: IBalance = { amount: 100 };
      mockUsersService.withdraw.mockRejectedValue(
        new ConflictException("Concurrent modification detected"),
      );

      await expect(
        controller.withdraw(mockAuthenticatedRequest, body),
      ).rejects.toThrow(ConflictException);
    });

    it("should propagate service errors correctly", async () => {
      const errorMessage = "Database connection failed";
      mockUsersService.getBalance.mockRejectedValue(new Error(errorMessage));

      await expect(
        controller.getBalance(mockAuthenticatedRequest),
      ).rejects.toThrow(errorMessage);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle full user lifecycle with multiple operations", async () => {
      // Initial balance check
      const initialResponse: IBalanceResponse = {
        balance: 1000,
        frozenBalance: 0,
      };
      mockUsersService.getBalance.mockResolvedValue(initialResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);
      expect(result.balance).toBe(1000);

      // Deposit
      const depositUser = { ...mockUser, balance: 1500 } as UserDocument;
      mockUsersService.deposit.mockResolvedValue(depositUser);

      const depositResult = await controller.deposit(mockAuthenticatedRequest, {
        amount: 500,
      });
      expect(depositResult.balance).toBe(1500);

      // Withdraw
      const withdrawUser = { ...mockUser, balance: 1200 } as UserDocument;
      mockUsersService.withdraw.mockResolvedValue(withdrawUser);

      const withdrawResult = await controller.withdraw(
        mockAuthenticatedRequest,
        {
          amount: 300,
        },
      );
      expect(withdrawResult.balance).toBe(1200);

      // Language update
      mockUsersService.updateLanguage.mockResolvedValue("ru");
      const langResult = await controller.updateLanguage(
        mockAuthenticatedRequest,
        {
          language: "ru",
        },
      );
      expect(langResult.languageCode).toBe("ru");
    });

    it("should handle concurrent deposit operations correctly", async () => {
      const depositAmount = 100;
      const firstDeposit = { ...mockUser, balance: 1100 } as UserDocument;
      const secondDeposit = { ...mockUser, balance: 1200 } as UserDocument;

      mockUsersService.deposit
        .mockResolvedValueOnce(firstDeposit)
        .mockResolvedValueOnce(secondDeposit);

      const result1 = await controller.deposit(mockAuthenticatedRequest, {
        amount: depositAmount,
      });
      expect(result1.balance).toBe(1100);

      const result2 = await controller.deposit(mockAuthenticatedRequest, {
        amount: depositAmount,
      });
      expect(result2.balance).toBe(1200);
    });
  });

  describe("Request Validation", () => {
    it("should validate deposit amount is positive integer", async () => {
      const body: IBalance = { amount: -50 };
      mockUsersService.deposit.mockRejectedValue(
        new BadRequestException("Amount must be a positive integer"),
      );

      await expect(
        controller.deposit(mockAuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it("should validate withdraw amount is positive integer", async () => {
      const body: IBalance = { amount: 0 };
      mockUsersService.withdraw.mockRejectedValue(
        new BadRequestException("Amount must be a positive integer"),
      );

      await expect(
        controller.withdraw(mockAuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it("should accept valid language codes", async () => {
      const body: ILanguageUpdate = { language: "en" };
      mockUsersService.updateLanguage.mockResolvedValue("en");

      const result = await controller.updateLanguage(
        mockAuthenticatedRequest,
        body,
      );

      expect(result.languageCode).toBe("en");
    });

    it("should extract user ID from request correctly", async () => {
      const customRequest = {
        user: { sub: "custom-user-id", username: "custom" },
      } as AuthenticatedRequest;
      const expectedResponse: IBalanceResponse = {
        balance: 500,
        frozenBalance: 50,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      await controller.getBalance(customRequest);

      expect(service.getBalance).toHaveBeenCalledWith("custom-user-id");
    });
  });

  describe("Response Structure", () => {
    it("should return IBalanceResponse with correct structure for getBalance", async () => {
      const expectedResponse: IBalanceResponse = {
        balance: 1000,
        frozenBalance: 200,
      };
      mockUsersService.getBalance.mockResolvedValue(expectedResponse);

      const result = await controller.getBalance(mockAuthenticatedRequest);

      expect(result).toMatchObject({
        balance: expect.any(Number),
        frozenBalance: expect.any(Number),
      });
    });

    it("should return IBalanceResponse with correct structure for deposit", async () => {
      const updatedUser = { ...mockUser, balance: 1500 } as UserDocument;
      mockUsersService.deposit.mockResolvedValue(updatedUser);

      const result = await controller.deposit(mockAuthenticatedRequest, {
        amount: 500,
      });

      expect(result).toMatchObject({
        balance: expect.any(Number),
        frozenBalance: expect.any(Number),
      });
    });

    it("should return IBalanceResponse with correct structure for withdraw", async () => {
      const updatedUser = { ...mockUser, balance: 700 } as UserDocument;
      mockUsersService.withdraw.mockResolvedValue(updatedUser);

      const result = await controller.withdraw(mockAuthenticatedRequest, {
        amount: 300,
      });

      expect(result).toMatchObject({
        balance: expect.any(Number),
        frozenBalance: expect.any(Number),
      });
    });

    it("should return ILanguageResponse with correct structure", async () => {
      mockUsersService.updateLanguage.mockResolvedValue("en");

      const result = await controller.updateLanguage(mockAuthenticatedRequest, {
        language: "en",
      });

      expect(result).toMatchObject({
        languageCode: expect.any(String),
      });
    });
  });
});
