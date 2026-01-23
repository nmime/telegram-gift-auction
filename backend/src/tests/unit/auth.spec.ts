import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
  type Mocked,
} from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { JwtService } from "@nestjs/jwt";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "@/modules/auth/auth.service";
import { TelegramService } from "@/modules/auth/telegram.service";
import { AuthController } from "@/modules/auth/auth.controller";
import { AuthGuard } from "@/common/guards/auth.guard";
import type { AuthenticatedRequest } from "@/common/types";
import { User } from "@/schemas";

// Mock object interfaces for proper typing
interface ConfigServiceMock {
  get: Mock<(key: string) => unknown>;
}

interface MockRequest {
  headers: {
    authorization?: string;
  };
  user?: Record<string, unknown> | null;
}

// Typed helpers for expect.any() to avoid no-unsafe-assignment warnings
const anyNumber = expect.any(Number) as unknown as number;
const anyString = expect.any(String) as unknown as string;

// Mock @grammyjs/validator
vi.mock("@grammyjs/validator", () => ({
  validateWebAppData: vi.fn(),
  checkSignature: vi.fn(),
}));

import * as grammyValidator from "@grammyjs/validator";

describe("Auth Module", () => {
  const mockValidator = vi.mocked(grammyValidator);
  const checkSignature = mockValidator.checkSignature as unknown as Mock;
  describe("AuthService", () => {
    let service: AuthService;
    let mockUserModel: {
      findOne: Mock;
      create: Mock;
      findById: Mock;
    };
    let mockJwtService: Mocked<Pick<JwtService, "signAsync" | "verifyAsync">>;

    beforeEach(async () => {
      mockUserModel = {
        findOne: vi.fn(),
        create: vi.fn(),
        findById: vi.fn(),
      };

      mockJwtService = {
        signAsync: vi.fn(),
        verifyAsync: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          {
            provide: getModelToken(User.name),
            useValue: mockUserModel,
          },
          {
            provide: JwtService,
            useValue: mockJwtService,
          },
        ],
      }).compile();

      service = module.get<AuthService>(AuthService);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    describe("Service Initialization", () => {
      it("should be defined", () => {
        expect(service).toBeDefined();
      });
    });

    describe("loginWithTelegramWidget", () => {
      const mockTelegramUser = {
        id: 123456789,
        first_name: "John",
        last_name: "Doe",
        username: "johndoe",
        photo_url: "https://example.com/photo.jpg",
        language_code: "en",
        is_premium: true,
        auth_date: Math.floor(Date.now() / 1000),
        hash: "mock_hash",
      };

      it("should create new user if not exists", async () => {
        mockUserModel.findOne.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue({
          _id: "user_id_123",
          username: "johndoe",
          telegramId: 123456789,
          firstName: "John",
          lastName: "Doe",
          photoUrl: "https://example.com/photo.jpg",
          languageCode: "en",
          isPremium: true,
          balance: 0,
          frozenBalance: 0,
        });
        mockJwtService.signAsync.mockResolvedValue("mock_access_token");

        const result = await service.loginWithTelegramWidget(mockTelegramUser);

        expect(mockUserModel.findOne).toHaveBeenCalledWith({
          telegramId: 123456789,
        });
        expect(mockUserModel.create).toHaveBeenCalledWith({
          username: "johndoe",
          telegramId: 123456789,
          firstName: "John",
          lastName: "Doe",
          photoUrl: "https://example.com/photo.jpg",
          languageCode: "en",
          isPremium: true,
        });
        expect(result.accessToken).toBe("mock_access_token");
        expect(result.user.username).toBe("johndoe");
      });

      it("should generate username from telegram ID if username not provided", async () => {
        const userWithoutUsername = {
          ...mockTelegramUser,
          username: undefined,
        };
        mockUserModel.findOne.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue({
          _id: "user_id_123",
          username: "tg_123456789",
          telegramId: 123456789,
          firstName: "John",
          balance: 0,
          frozenBalance: 0,
        });
        mockJwtService.signAsync.mockResolvedValue("mock_token");

        await service.loginWithTelegramWidget(userWithoutUsername);

        expect(mockUserModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            username: "tg_123456789",
          }),
        );
      });

      it("should use tg_ID format if username already exists", async () => {
        mockUserModel.findOne
          .mockResolvedValueOnce(null) // First call for telegramId
          .mockResolvedValueOnce({ username: "johndoe" }); // Second call for username check

        mockUserModel.create.mockResolvedValue({
          _id: "user_id_123",
          username: "tg_123456789",
          telegramId: 123456789,
          firstName: "John",
          balance: 0,
          frozenBalance: 0,
        });
        mockJwtService.signAsync.mockResolvedValue("mock_token");

        await service.loginWithTelegramWidget(mockTelegramUser);

        expect(mockUserModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            username: "tg_123456789",
          }),
        );
      });

      it("should update existing user fields on login", async () => {
        const existingUser = {
          _id: "user_id_123",
          username: "oldusername",
          telegramId: 123456789,
          firstName: "OldFirst",
          lastName: "OldLast",
          photoUrl: "old_photo.jpg",
          languageCode: "ru",
          isPremium: false,
          balance: 100,
          frozenBalance: 50,
          save: vi.fn().mockResolvedValue(true),
        };

        mockUserModel.findOne.mockResolvedValue(existingUser);
        mockJwtService.signAsync.mockResolvedValue("mock_token");

        await service.loginWithTelegramWidget(mockTelegramUser);

        expect(existingUser.firstName).toBe("John");
        expect(existingUser.lastName).toBe("Doe");
        expect(existingUser.photoUrl).toBe("https://example.com/photo.jpg");
        expect(existingUser.languageCode).toBe("en");
        expect(existingUser.isPremium).toBe(true);
        expect(existingUser.username).toBe("johndoe");
        expect(existingUser.save).toHaveBeenCalled();
      });

      it("should not update username if not provided in telegram data", async () => {
        const userWithoutUsername = {
          ...mockTelegramUser,
          username: undefined,
        };
        const existingUser = {
          _id: "user_id_123",
          username: "oldusername",
          telegramId: 123456789,
          firstName: "OldFirst",
          balance: 100,
          frozenBalance: 50,
          save: vi.fn().mockResolvedValue(true),
        };

        mockUserModel.findOne.mockResolvedValue(existingUser);
        mockJwtService.signAsync.mockResolvedValue("mock_token");

        await service.loginWithTelegramWidget(userWithoutUsername);

        expect(existingUser.username).toBe("oldusername");
      });

      it("should generate valid JWT payload", async () => {
        const existingUser = {
          _id: "user_id_123",
          username: "johndoe",
          telegramId: 123456789,
          balance: 100,
          frozenBalance: 50,
          save: vi.fn().mockResolvedValue(true),
        };

        mockUserModel.findOne.mockResolvedValue(existingUser);
        mockJwtService.signAsync.mockResolvedValue("mock_token");

        await service.loginWithTelegramWidget(mockTelegramUser);

        expect(mockJwtService.signAsync).toHaveBeenCalledWith({
          sub: "user_id_123",
          username: "johndoe",
          telegramId: 123456789,
        });
      });

      it("should return correct AuthResponse structure", async () => {
        const existingUser = {
          _id: "user_id_123",
          username: "johndoe",
          telegramId: 123456789,
          firstName: "John",
          lastName: "Doe",
          photoUrl: "https://example.com/photo.jpg",
          balance: 100,
          frozenBalance: 50,
          save: vi.fn().mockResolvedValue(true),
        };

        mockUserModel.findOne.mockResolvedValue(existingUser);
        mockJwtService.signAsync.mockResolvedValue("mock_token");

        const result = await service.loginWithTelegramWidget(mockTelegramUser);

        expect(result).toEqual({
          user: {
            id: "user_id_123",
            username: "johndoe",
            balance: 100,
            frozenBalance: 50,
            telegramId: 123456789,
            firstName: "John",
            lastName: "Doe",
            photoUrl: "https://example.com/photo.jpg",
          },
          accessToken: "mock_token",
        });
      });

      it("should handle is_premium false or undefined", async () => {
        const userWithoutPremium = {
          ...mockTelegramUser,
          is_premium: undefined,
        };

        mockUserModel.findOne.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue({
          _id: "user_id_123",
          username: "johndoe",
          isPremium: false,
          balance: 0,
          frozenBalance: 0,
        });
        mockJwtService.signAsync.mockResolvedValue("mock_token");

        await service.loginWithTelegramWidget(userWithoutPremium);

        expect(mockUserModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            isPremium: false,
          }),
        );
      });
    });

    describe("loginWithTelegramMiniApp", () => {
      const mockInitData = {
        query_id: "query_123",
        user: {
          id: 123456789,
          first_name: "Jane",
          last_name: "Smith",
          username: "janesmith",
          language_code: "ru",
          is_premium: false,
          photo_url: "https://example.com/jane.jpg",
        },
        auth_date: Math.floor(Date.now() / 1000),
        hash: "mock_hash",
      };

      it("should login with valid init data", async () => {
        mockUserModel.findOne.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue({
          _id: "user_id_456",
          username: "janesmith",
          telegramId: 123456789,
          firstName: "Jane",
          lastName: "Smith",
          balance: 0,
          frozenBalance: 0,
        });
        mockJwtService.signAsync.mockResolvedValue("mini_app_token");

        const result = await service.loginWithTelegramMiniApp(mockInitData);

        expect(result.accessToken).toBe("mini_app_token");
        expect(result.user.username).toBe("janesmith");
      });

      it("should throw UnauthorizedException if user data not in init data", async () => {
        const invalidInitData = {
          auth_date: Math.floor(Date.now() / 1000),
          hash: "mock_hash",
        } as unknown;

        await expect(
          service.loginWithTelegramMiniApp(invalidInitData),
        ).rejects.toThrow(UnauthorizedException);
      });

      it("should convert mini app user data to telegram user format", async () => {
        mockUserModel.findOne.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue({
          _id: "user_id_456",
          username: "janesmith",
          telegramId: 123456789,
          balance: 0,
          frozenBalance: 0,
        });
        mockJwtService.signAsync.mockResolvedValue("token");

        await service.loginWithTelegramMiniApp(mockInitData);

        expect(mockUserModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            telegramId: 123456789,
            firstName: "Jane",
            lastName: "Smith",
            username: "janesmith",
            languageCode: "ru",
            isPremium: false,
            photoUrl: "https://example.com/jane.jpg",
          }),
        );
      });
    });

    describe("validateToken", () => {
      it("should validate valid token", async () => {
        const mockPayload = {
          sub: "user_id_123",
          username: "johndoe",
          telegramId: 123456789,
        };

        mockJwtService.verifyAsync.mockResolvedValue(mockPayload);

        const result = await service.validateToken("valid_token");

        expect(result).toEqual(mockPayload);
        expect(mockJwtService.verifyAsync).toHaveBeenCalledWith("valid_token");
      });

      it("should throw UnauthorizedException for expired token", async () => {
        mockJwtService.verifyAsync.mockRejectedValue(
          new Error("Token expired"),
        );

        await expect(service.validateToken("expired_token")).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it("should throw UnauthorizedException for invalid signature", async () => {
        mockJwtService.verifyAsync.mockRejectedValue(
          new Error("Invalid signature"),
        );

        await expect(
          service.validateToken("invalid_signature_token"),
        ).rejects.toThrow(UnauthorizedException);
      });

      it("should throw UnauthorizedException for malformed token", async () => {
        mockJwtService.verifyAsync.mockRejectedValue(
          new Error("Malformed token"),
        );

        await expect(service.validateToken("malformed.token")).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it("should handle missing token", async () => {
        mockJwtService.verifyAsync.mockRejectedValue(new Error("No token"));

        await expect(service.validateToken("")).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it("should throw UnauthorizedException with message 'Invalid token'", async () => {
        mockJwtService.verifyAsync.mockRejectedValue(new Error("Any error"));

        await expect(service.validateToken("token")).rejects.toThrow(
          "Invalid token",
        );
      });
    });

    describe("validateUser", () => {
      it("should return user if found", async () => {
        const mockUser = {
          _id: "user_id_123",
          username: "johndoe",
          balance: 100,
        };

        mockUserModel.findById.mockResolvedValue(mockUser);

        const result = await service.validateUser("user_id_123");

        expect(result).toEqual(mockUser);
        expect(mockUserModel.findById).toHaveBeenCalledWith("user_id_123");
      });

      it("should return null if user not found", async () => {
        mockUserModel.findById.mockResolvedValue(null);

        const result = await service.validateUser("non_existent_id");

        expect(result).toBeNull();
      });

      it("should handle database errors gracefully", async () => {
        mockUserModel.findById.mockRejectedValue(new Error("DB error"));

        await expect(service.validateUser("user_id")).rejects.toThrow(
          "DB error",
        );
      });
    });

    describe("getUser", () => {
      it("should return user if found", async () => {
        const mockUser = {
          _id: "user_id_123",
          username: "johndoe",
          balance: 100,
        };

        mockUserModel.findById.mockResolvedValue(mockUser);

        const result = await service.getUser("user_id_123");

        expect(result).toEqual(mockUser);
      });

      it("should throw UnauthorizedException if user not found", async () => {
        mockUserModel.findById.mockResolvedValue(null);

        await expect(service.getUser("non_existent_id")).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it("should throw UnauthorizedException with message 'User not found'", async () => {
        mockUserModel.findById.mockResolvedValue(null);

        await expect(service.getUser("invalid_id")).rejects.toThrow(
          "User not found",
        );
      });
    });
  });

  describe("TelegramService", () => {
    let service: TelegramService;
    let mockConfigService: ConfigServiceMock;
    let validateWebAppData: Mock;
    let checkSignature: Mock;

    beforeEach(async () => {
      // Get mocked functions from vi.mock at top of file
      validateWebAppData = mockValidator.validateWebAppData as Mock;
      checkSignature = mockValidator.checkSignature as Mock;

      mockConfigService = {
        get: vi.fn((key: string) => {
          if (key === "BOT_TOKEN") return "test_bot_token_123";
          return undefined;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TelegramService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      service = module.get<TelegramService>(TelegramService);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    describe("Service Initialization", () => {
      it("should be defined", () => {
        expect(service).toBeDefined();
      });

      it("should load bot token from config", () => {
        expect(mockConfigService.get).toHaveBeenCalledWith("BOT_TOKEN");
      });
    });

    describe("validateWidgetAuth", () => {
      const validPayload = {
        id: 123456789,
        first_name: "John",
        last_name: "Doe",
        username: "johndoe",
        photo_url: "https://example.com/photo.jpg",
        language_code: "en",
        is_premium: true,
        auth_date: Math.floor(Date.now() / 1000),
        hash: "valid_hash",
      };

      it("should validate correct widget auth data", () => {
        checkSignature.mockReturnValue(true);

        const result = service.validateWidgetAuth(validPayload);

        expect(result).toEqual(validPayload);
        expect(checkSignature).toHaveBeenCalledWith(
          "test_bot_token_123",
          expect.objectContaining({
            id: "123456789",
            first_name: "John",
            auth_date: anyString,
            hash: "valid_hash",
          }),
        );
      });

      it("should throw UnauthorizedException for invalid signature", () => {
        checkSignature.mockReturnValue(false);

        expect(() => service.validateWidgetAuth(validPayload)).toThrow(
          UnauthorizedException,
        );
      });

      it("should throw if bot token not configured", () => {
        mockConfigService.get.mockReturnValue(undefined);

        // Constructor throws when BOT_TOKEN is not configured
        expect(
          () =>
            new TelegramService(mockConfigService as unknown as ConfigService),
        ).toThrow("BOT_TOKEN is not configured");
      });

      it("should throw if auth_date is too old (>24 hours)", () => {
        const oldPayload = {
          ...validPayload,
          auth_date: Math.floor(Date.now() / 1000) - 86401, // >24 hours ago
        };

        expect(() => service.validateWidgetAuth(oldPayload)).toThrow(
          "Auth data expired",
        );
      });

      it("should accept auth_date within 24 hours", () => {
        checkSignature.mockReturnValue(true);

        const recentPayload = {
          ...validPayload,
          auth_date: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        };

        const result = service.validateWidgetAuth(recentPayload);

        expect(result).toEqual(recentPayload);
      });

      it("should handle optional fields correctly", () => {
        checkSignature.mockReturnValue(true);

        const minimalPayload = {
          id: 123456789,
          first_name: "John",
          auth_date: Math.floor(Date.now() / 1000),
          hash: "valid_hash",
        };

        const result = service.validateWidgetAuth(minimalPayload);

        expect(result).toEqual(minimalPayload);
      });

      it("should include all optional fields in signature check when present", () => {
        checkSignature.mockReturnValue(true);

        service.validateWidgetAuth(validPayload);

        expect(checkSignature).toHaveBeenCalledWith(
          "test_bot_token_123",
          expect.objectContaining({
            last_name: "Doe",
            username: "johndoe",
            photo_url: "https://example.com/photo.jpg",
            language_code: "en",
            is_premium: "true",
          }),
        );
      });

      it("should handle is_premium as boolean string", () => {
        checkSignature.mockReturnValue(true);

        const payloadWithPremium = {
          ...validPayload,
          is_premium: false,
        };

        service.validateWidgetAuth(payloadWithPremium);

        expect(checkSignature).toHaveBeenCalledWith(
          "test_bot_token_123",
          expect.objectContaining({
            is_premium: "false",
          }),
        );
      });
    });

    describe("validateWebAppInitData", () => {
      const validInitData = new URLSearchParams({
        user: JSON.stringify({
          id: 123456789,
          first_name: "Jane",
          last_name: "Smith",
          username: "janesmith",
          language_code: "ru",
          is_premium: false,
        }),
        auth_date: String(Math.floor(Date.now() / 1000)),
        hash: "valid_hash",
      }).toString();

      it("should validate correct init data", () => {
        validateWebAppData.mockReturnValue(true);

        const result = service.validateWebAppInitData(validInitData);

        expect(result).toMatchObject({
          user: {
            id: 123456789,
            first_name: "Jane",
            last_name: "Smith",
            username: "janesmith",
          },
          auth_date: anyNumber,
          hash: "valid_hash",
        });
      });

      it("should throw if bot token not configured", () => {
        mockConfigService.get.mockReturnValue(undefined);

        // Constructor throws when BOT_TOKEN is not configured
        expect(
          () =>
            new TelegramService(mockConfigService as unknown as ConfigService),
        ).toThrow("BOT_TOKEN is not configured");
      });

      it("should throw if init data too large (>4096 bytes)", () => {
        const largeData = "a".repeat(4097);

        expect(() => service.validateWebAppInitData(largeData)).toThrow(
          "Init data too large",
        );
      });

      it("should throw if validation fails", () => {
        validateWebAppData.mockReturnValue(false);

        expect(() => service.validateWebAppInitData(validInitData)).toThrow(
          "Invalid Web App init data",
        );
      });

      it("should throw if auth_date missing", () => {
        validateWebAppData.mockReturnValue(true);

        const invalidData = new URLSearchParams({
          user: JSON.stringify({ id: 123 }),
          hash: "hash",
        }).toString();

        expect(() => service.validateWebAppInitData(invalidData)).toThrow(
          "Missing required fields in init data",
        );
      });

      it("should throw if hash missing", () => {
        validateWebAppData.mockReturnValue(true);

        const invalidData = new URLSearchParams({
          user: JSON.stringify({ id: 123 }),
          auth_date: String(Math.floor(Date.now() / 1000)),
        }).toString();

        expect(() => service.validateWebAppInitData(invalidData)).toThrow(
          "Missing required fields in init data",
        );
      });

      it("should throw if auth_date expired (>24 hours)", () => {
        validateWebAppData.mockReturnValue(true);

        const expiredData = new URLSearchParams({
          user: JSON.stringify({ id: 123 }),
          auth_date: String(Math.floor(Date.now() / 1000) - 86401),
          hash: "hash",
        }).toString();

        expect(() => service.validateWebAppInitData(expiredData)).toThrow(
          "Auth data expired",
        );
      });

      it("should throw if user data has invalid JSON format", () => {
        validateWebAppData.mockReturnValue(true);

        const invalidUserData = new URLSearchParams({
          user: "invalid_json",
          auth_date: String(Math.floor(Date.now() / 1000)),
          hash: "hash",
        }).toString();

        expect(() => service.validateWebAppInitData(invalidUserData)).toThrow(
          "Invalid user data format",
        );
      });

      it("should handle init data without user field", () => {
        validateWebAppData.mockReturnValue(true);

        const noUserData = new URLSearchParams({
          query_id: "query_123",
          auth_date: String(Math.floor(Date.now() / 1000)),
          hash: "hash",
        }).toString();

        const result = service.validateWebAppInitData(noUserData);

        expect(result.user).toBeUndefined();
      });

      it("should parse query_id if present", () => {
        validateWebAppData.mockReturnValue(true);

        const dataWithQueryId = new URLSearchParams({
          query_id: "query_xyz_123",
          user: JSON.stringify({ id: 123 }),
          auth_date: String(Math.floor(Date.now() / 1000)),
          hash: "hash",
        }).toString();

        const result = service.validateWebAppInitData(dataWithQueryId);

        expect(result.query_id).toBe("query_xyz_123");
      });
    });
  });

  describe("AuthController", () => {
    let controller: AuthController;
    let mockAuthService: {
      loginWithTelegramWidget: Mock;
      loginWithTelegramMiniApp: Mock;
      validateUser: Mock;
    };
    let mockTelegramService: {
      validateWidgetAuth: Mock;
      validateWebAppInitData: Mock;
    };

    beforeEach(async () => {
      mockAuthService = {
        loginWithTelegramWidget: vi.fn(),
        loginWithTelegramMiniApp: vi.fn(),
        validateUser: vi.fn(),
      };

      mockTelegramService = {
        validateWidgetAuth: vi.fn(),
        validateWebAppInitData: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          {
            provide: AuthService,
            useValue: mockAuthService,
          },
          {
            provide: TelegramService,
            useValue: mockTelegramService,
          },
          {
            provide: JwtService,
            useValue: {
              verifyAsync: vi.fn(),
              signAsync: vi.fn(),
            },
          },
        ],
      }).compile();

      controller = module.get<AuthController>(AuthController);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    describe("Controller Initialization", () => {
      it("should be defined", () => {
        expect(controller).toBeDefined();
      });
    });

    describe("POST /auth/telegram/widget", () => {
      const widgetAuthData = {
        id: 123456789,
        first_name: "John",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "hash",
      };

      it("should login with valid widget data", async () => {
        const validatedUser = { ...widgetAuthData };
        const authResponse = {
          user: {
            id: "user_123",
            username: "johndoe",
            balance: 0,
            frozenBalance: 0,
            telegramId: 123456789,
          },
          accessToken: "token_abc",
        };

        mockTelegramService.validateWidgetAuth.mockReturnValue(validatedUser);
        mockAuthService.loginWithTelegramWidget.mockResolvedValue(authResponse);

        const result = await controller.loginWithTelegramWidget(widgetAuthData);

        expect(mockTelegramService.validateWidgetAuth).toHaveBeenCalledWith(
          widgetAuthData,
        );
        expect(mockAuthService.loginWithTelegramWidget).toHaveBeenCalledWith(
          validatedUser,
        );
        expect(result).toEqual(authResponse);
      });

      it("should throw UnauthorizedException for invalid widget data", async () => {
        mockTelegramService.validateWidgetAuth.mockImplementation(() => {
          throw new UnauthorizedException("Invalid Telegram auth data");
        });

        await expect(
          controller.loginWithTelegramWidget(widgetAuthData),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    describe("POST /auth/telegram/webapp", () => {
      const webAppAuthData = {
        initData: "user=%7B%22id%22%3A123%7D&auth_date=123456&hash=hash",
      };

      it("should login with valid webapp data", async () => {
        const validatedData = {
          user: { id: 123, first_name: "Jane" },
          auth_date: 123456,
          hash: "hash",
        };
        const authResponse = {
          user: {
            id: "user_456",
            username: "janesmith",
            balance: 0,
            frozenBalance: 0,
          },
          accessToken: "token_xyz",
        };

        mockTelegramService.validateWebAppInitData.mockReturnValue(
          validatedData,
        );
        mockAuthService.loginWithTelegramMiniApp.mockResolvedValue(
          authResponse,
        );

        const result =
          await controller.loginWithTelegramMiniApp(webAppAuthData);

        expect(mockTelegramService.validateWebAppInitData).toHaveBeenCalledWith(
          webAppAuthData.initData,
        );
        expect(mockAuthService.loginWithTelegramMiniApp).toHaveBeenCalledWith(
          validatedData,
        );
        expect(result).toEqual(authResponse);
      });

      it("should throw UnauthorizedException for invalid webapp data", async () => {
        mockTelegramService.validateWebAppInitData.mockImplementation(() => {
          throw new UnauthorizedException("Invalid Web App init data");
        });

        await expect(
          controller.loginWithTelegramMiniApp(webAppAuthData),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    describe("POST /auth/logout", () => {
      it("should return success on logout", () => {
        const result = controller.logout();

        expect(result).toEqual({ success: true });
      });

      it("should always return success regardless of user state", () => {
        const result1 = controller.logout();
        const result2 = controller.logout();

        expect(result1).toEqual({ success: true });
        expect(result2).toEqual({ success: true });
      });
    });

    describe("GET /auth/me", () => {
      const mockRequest = {
        user: {
          sub: "user_id_123",
          username: "johndoe",
        },
      } as unknown as MockRequest;

      it("should return current user data", async () => {
        const mockUser = {
          _id: "user_id_123",
          username: "johndoe",
          balance: 100,
          frozenBalance: 25,
          telegramId: 123456789,
          firstName: "John",
          lastName: "Doe",
          photoUrl: "https://example.com/photo.jpg",
          languageCode: "en",
        };

        mockAuthService.validateUser.mockResolvedValue(mockUser as unknown);

        const result = await controller.me(
          mockRequest as unknown as AuthenticatedRequest,
        );

        expect(mockAuthService.validateUser).toHaveBeenCalledWith(
          "user_id_123",
        );
        expect(result).toEqual({
          id: "user_id_123",
          username: "johndoe",
          balance: 100,
          frozenBalance: 25,
          telegramId: 123456789,
          firstName: "John",
          lastName: "Doe",
          photoUrl: "https://example.com/photo.jpg",
          languageCode: "en",
        });
      });

      it("should return null if user not found", async () => {
        mockAuthService.validateUser.mockResolvedValue(null);

        const result = await controller.me(mockRequest);

        expect(result).toBeNull();
      });

      it("should handle optional fields correctly", async () => {
        const mockUser = {
          _id: "user_id_123",
          username: "johndoe",
          balance: 0,
          frozenBalance: 0,
        };

        mockAuthService.validateUser.mockResolvedValue(mockUser as unknown);

        const result = await controller.me(
          mockRequest as unknown as AuthenticatedRequest,
        );

        expect(result).toMatchObject({
          id: "user_id_123",
          username: "johndoe",
          balance: 0,
          frozenBalance: 0,
        });
      });
    });
  });

  describe("AuthGuard", () => {
    let guard: AuthGuard;
    let mockJwtService: { verifyAsync: Mock };

    beforeEach(async () => {
      mockJwtService = {
        verifyAsync: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthGuard,
          {
            provide: JwtService,
            useValue: mockJwtService,
          },
        ],
      }).compile();

      guard = module.get<AuthGuard>(AuthGuard);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    describe("Guard Initialization", () => {
      it("should be defined", () => {
        expect(guard).toBeDefined();
      });
    });

    describe("canActivate", () => {
      const createMockExecutionContext = (
        authHeader?: string,
      ): ExecutionContext => {
        return {
          switchToHttp: () => ({
            getRequest: () => ({
              headers: {
                authorization: authHeader,
              },
              user: null,
            }),
          }),
        } as unknown as ExecutionContext;
      };

      it("should allow request with valid Bearer token", async () => {
        const mockPayload = {
          sub: "user_123",
          username: "johndoe",
        };

        mockJwtService.verifyAsync.mockResolvedValue(mockPayload);

        const context = createMockExecutionContext("Bearer valid_token");
        const result = await guard.canActivate(context);

        expect(result).toBe(true);
        expect(mockJwtService.verifyAsync).toHaveBeenCalledWith("valid_token");
      });

      it("should throw UnauthorizedException if no authorization header", async () => {
        const context = createMockExecutionContext();

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
        await expect(guard.canActivate(context)).rejects.toThrow(
          "Missing authorization header",
        );
      });

      it("should throw UnauthorizedException if authorization header does not start with Bearer", async () => {
        const context = createMockExecutionContext("Basic invalid_auth");

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it("should throw UnauthorizedException for invalid token", async () => {
        mockJwtService.verifyAsync.mockRejectedValue(
          new Error("Invalid token"),
        );

        const context = createMockExecutionContext("Bearer invalid_token");

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
        await expect(guard.canActivate(context)).rejects.toThrow(
          "Invalid token",
        );
      });

      it("should throw UnauthorizedException for expired token", async () => {
        mockJwtService.verifyAsync.mockRejectedValue(
          new Error("Token expired"),
        );

        const context = createMockExecutionContext("Bearer expired_token");

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it("should attach user payload to request", async () => {
        const mockPayload = {
          sub: "user_123",
          username: "johndoe",
          telegramId: 123456789,
        };

        mockJwtService.verifyAsync.mockResolvedValue(mockPayload);

        const mockRequest = {
          headers: { authorization: "Bearer valid_token" },
          user: null,
        };

        const context = {
          switchToHttp: () => ({
            getRequest: () => mockRequest,
          }),
        } as unknown as ExecutionContext;

        await guard.canActivate(context);

        expect(mockRequest.user).toEqual(mockPayload);
      });

      it("should handle malformed Bearer token", async () => {
        const context = createMockExecutionContext("Bearer ");

        mockJwtService.verifyAsync.mockRejectedValue(new Error("Malformed"));

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it("should handle multiple Bearer keywords", async () => {
        const context = createMockExecutionContext("Bearer Bearer some_token");

        mockJwtService.verifyAsync.mockRejectedValue(new Error("Invalid"));

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
      });
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    describe("Null and Undefined Handling", () => {
      let service: AuthService;
      let mockUserModel: {
        findOne: Mock;
        create: Mock;
        findById: Mock;
      };
      let mockJwtService: {
        signAsync: Mock;
        verifyAsync: Mock;
      };

      beforeEach(async () => {
        mockUserModel = {
          findOne: vi.fn(),
          create: vi.fn(),
          findById: vi.fn(),
        };

        mockJwtService = {
          signAsync: vi.fn(),
          verifyAsync: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
          providers: [
            AuthService,
            {
              provide: getModelToken(User.name),
              useValue: mockUserModel,
            },
            {
              provide: JwtService,
              useValue: mockJwtService,
            },
          ],
        }).compile();

        service = module.get<AuthService>(AuthService);
      });

      it("should handle null user data gracefully", async () => {
        mockUserModel.findById.mockResolvedValue(null);

        const result = await service.validateUser("non_existent");

        expect(result).toBeNull();
      });

      it("should handle empty string token", async () => {
        mockJwtService.verifyAsync.mockRejectedValue(new Error("Empty"));

        await expect(service.validateToken("")).rejects.toThrow(
          UnauthorizedException,
        );
      });
    });

    describe("Clock Skew and Timezone Handling", () => {
      let telegramService: TelegramService;

      beforeEach(async () => {
        const mockConfigService: { get: Mock } = {
          get: vi.fn(() => "test_bot_token"),
        };

        const module: TestingModule = await Test.createTestingModule({
          providers: [
            TelegramService,
            {
              provide: ConfigService,
              useValue: mockConfigService,
            },
          ],
        }).compile();

        telegramService = module.get<TelegramService>(TelegramService);
      });

      it("should accept auth_date at exactly 24 hours boundary", () => {
        checkSignature.mockReturnValue(true);

        const payload = {
          id: 123,
          first_name: "Test",
          auth_date: Math.floor(Date.now() / 1000) - 86400, // Exactly 24h
          hash: "hash",
        };

        const result = telegramService.validateWidgetAuth(payload);

        expect(result).toEqual(payload);
      });

      it("should reject auth_date at 24 hours + 1 second", () => {
        const payload = {
          id: 123,
          first_name: "Test",
          auth_date: Math.floor(Date.now() / 1000) - 86401,
          hash: "hash",
        };

        expect(() => telegramService.validateWidgetAuth(payload)).toThrow(
          "Auth data expired",
        );
      });
    });
  });
});
