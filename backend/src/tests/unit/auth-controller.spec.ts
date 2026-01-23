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
import { JwtService } from "@nestjs/jwt";
import { UnauthorizedException } from "@nestjs/common";
import { AuthController } from "@/modules/auth/auth.controller";
import { AuthService } from "@/modules/auth/auth.service";
import { TelegramService } from "@/modules/auth/telegram.service";
import type { AuthenticatedRequest } from "@/common";
import type {
  ILoginResponse,
  ITelegramWidgetAuth,
  ITelegramWebAppAuth,
} from "@/modules/auth/dto";

// Type interfaces for mock objects
interface MockAuthService {
  loginWithTelegramWidget: Mock;
  loginWithTelegramMiniApp: Mock;
  validateUser: Mock;
  validateToken: Mock;
  getUser: Mock;
}

interface MockTelegramService {
  validateWidgetAuth: Mock;
  validateWebAppInitData: Mock;
}

interface MockJwtService {
  verifyAsync: Mock;
  signAsync: Mock;
}

interface UserDocument {
  _id: string | { toString: () => string };
  username: string;
  balance: number;
  frozenBalance: number;
  telegramId?: number;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  languageCode?: string;
  isPremium?: boolean;
}

interface ValidatedWebAppData {
  query_id: string;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
  auth_date: number;
  hash: string;
}

// Typed helpers for expect.any() to avoid no-unsafe-assignment warnings
const anyNumber = expect.any(Number) as unknown as number;
const anyString = expect.any(String) as unknown as string;

describe("AuthController", () => {
  let controller: AuthController;
  let mockAuthService: MockAuthService;
  let mockTelegramService: MockTelegramService;
  let mockJwtService: MockJwtService;

  beforeEach(async () => {
    mockAuthService = {
      loginWithTelegramWidget: vi.fn(),
      loginWithTelegramMiniApp: vi.fn(),
      validateUser: vi.fn(),
      validateToken: vi.fn(),
      getUser: vi.fn(),
    };

    mockTelegramService = {
      validateWidgetAuth: vi.fn(),
      validateWebAppInitData: vi.fn(),
    };

    mockJwtService = {
      verifyAsync: vi.fn(),
      signAsync: vi.fn(),
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
          useValue: mockJwtService,
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

    it("should inject AuthService", () => {
      expect(
        (controller as unknown as { authService: MockAuthService }).authService,
      ).toBe(mockAuthService);
    });

    it("should inject TelegramService", () => {
      expect(
        (controller as unknown as { telegramService: MockTelegramService })
          .telegramService,
      ).toBe(mockTelegramService);
    });
  });

  describe("POST /auth/telegram/widget - loginWithTelegramWidget", () => {
    const validWidgetAuth: ITelegramWidgetAuth = {
      id: 123456789,
      first_name: "John",
      last_name: "Doe",
      username: "johndoe",
      photo_url: "https://example.com/photo.jpg",
      language_code: "en",
      is_premium: true,
      auth_date: Math.floor(Date.now() / 1000),
      hash: "valid_hash_abc123",
    };

    const expectedLoginResponse: ILoginResponse = {
      user: {
        id: "user_id_123",
        username: "johndoe",
        balance: 0,
        frozenBalance: 0,
        telegramId: 123456789,
        firstName: "John",
        lastName: "Doe",
        photoUrl: "https://example.com/photo.jpg",
        languageCode: "en",
      },
      accessToken: "jwt_token_abc123",
    };

    it("should successfully login with valid widget data", async () => {
      mockTelegramService.validateWidgetAuth.mockReturnValue(validWidgetAuth);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue(
        expectedLoginResponse,
      );

      const result = await controller.loginWithTelegramWidget(validWidgetAuth);

      expect(mockTelegramService.validateWidgetAuth).toHaveBeenCalledWith(
        validWidgetAuth,
      );
      expect(mockTelegramService.validateWidgetAuth).toHaveBeenCalledTimes(1);
      expect(mockAuthService.loginWithTelegramWidget).toHaveBeenCalledWith(
        validWidgetAuth,
      );
      expect(mockAuthService.loginWithTelegramWidget).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedLoginResponse);
    });

    it("should return correct response structure", async () => {
      mockTelegramService.validateWidgetAuth.mockReturnValue(validWidgetAuth);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue(
        expectedLoginResponse,
      );

      const result = await controller.loginWithTelegramWidget(validWidgetAuth);

      expect(result).toHaveProperty("user");
      expect(result).toHaveProperty("accessToken");
      expect(result.user).toHaveProperty("id");
      expect(result.user).toHaveProperty("username");
      expect(result.user).toHaveProperty("balance");
      expect(result.user).toHaveProperty("frozenBalance");
    });

    it("should throw UnauthorizedException when telegram validation fails", async () => {
      mockTelegramService.validateWidgetAuth.mockImplementation(() => {
        throw new UnauthorizedException("Invalid Telegram signature");
      });

      await expect(
        controller.loginWithTelegramWidget(validWidgetAuth),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        controller.loginWithTelegramWidget(validWidgetAuth),
      ).rejects.toThrow("Invalid Telegram signature");

      expect(mockAuthService.loginWithTelegramWidget).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException when auth data is expired", async () => {
      mockTelegramService.validateWidgetAuth.mockImplementation(() => {
        throw new UnauthorizedException("Auth data expired");
      });

      await expect(
        controller.loginWithTelegramWidget(validWidgetAuth),
      ).rejects.toThrow("Auth data expired");
    });

    it("should handle minimal widget data (only required fields)", async () => {
      const minimalWidgetAuth: ITelegramWidgetAuth = {
        id: 987654321,
        first_name: "Jane",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "minimal_hash",
      };

      const minimalResponse: ILoginResponse = {
        user: {
          id: "user_id_456",
          username: "tg_987654321",
          balance: 0,
          frozenBalance: 0,
          telegramId: 987654321,
          firstName: "Jane",
        },
        accessToken: "jwt_token_xyz",
      };

      mockTelegramService.validateWidgetAuth.mockReturnValue(minimalWidgetAuth);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue(
        minimalResponse,
      );

      const result =
        await controller.loginWithTelegramWidget(minimalWidgetAuth);

      expect(result).toEqual(minimalResponse);
      expect(result.user.username).toBe("tg_987654321");
    });

    it("should propagate database errors from service", async () => {
      mockTelegramService.validateWidgetAuth.mockReturnValue(validWidgetAuth);
      mockAuthService.loginWithTelegramWidget.mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(
        controller.loginWithTelegramWidget(validWidgetAuth),
      ).rejects.toThrow("Database connection failed");
    });

    it("should handle service returning null token", async () => {
      mockTelegramService.validateWidgetAuth.mockReturnValue(validWidgetAuth);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue({
        user: expectedLoginResponse.user,
        accessToken: "",
      });

      const result = await controller.loginWithTelegramWidget(validWidgetAuth);

      expect(result.accessToken).toBe("");
    });

    it("should handle premium user flag correctly", async () => {
      const premiumWidgetAuth = { ...validWidgetAuth, is_premium: true };
      mockTelegramService.validateWidgetAuth.mockReturnValue(premiumWidgetAuth);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue(
        expectedLoginResponse,
      );

      await controller.loginWithTelegramWidget(premiumWidgetAuth);

      expect(mockAuthService.loginWithTelegramWidget).toHaveBeenCalledWith(
        expect.objectContaining({
          is_premium: true,
        }) as ITelegramWidgetAuth,
      );
    });
  });

  describe("POST /auth/telegram/webapp - loginWithTelegramMiniApp", () => {
    const validWebAppAuth: ITelegramWebAppAuth = {
      initData:
        "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Jane%22%7D&auth_date=1234567890&hash=webapp_hash",
    };

    const validatedWebAppData = {
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      user: {
        id: 123456789,
        first_name: "Jane",
        last_name: "Smith",
        username: "janesmith",
        language_code: "ru",
        is_premium: false,
      },
      auth_date: 1234567890,
      hash: "webapp_hash",
    };

    const expectedWebAppResponse: ILoginResponse = {
      user: {
        id: "user_id_789",
        username: "janesmith",
        balance: 100,
        frozenBalance: 25,
        telegramId: 123456789,
        firstName: "Jane",
        lastName: "Smith",
      },
      accessToken: "webapp_jwt_token",
    };

    it("should successfully login with valid webapp data", async () => {
      mockTelegramService.validateWebAppInitData.mockReturnValue(
        validatedWebAppData,
      );
      mockAuthService.loginWithTelegramMiniApp.mockResolvedValue(
        expectedWebAppResponse,
      );

      const result = await controller.loginWithTelegramMiniApp(validWebAppAuth);

      expect(mockTelegramService.validateWebAppInitData).toHaveBeenCalledWith(
        validWebAppAuth.initData,
      );
      expect(mockAuthService.loginWithTelegramMiniApp).toHaveBeenCalledWith(
        validatedWebAppData,
      );
      expect(result).toEqual(expectedWebAppResponse);
    });

    it("should return correct response structure for webapp", async () => {
      mockTelegramService.validateWebAppInitData.mockReturnValue(
        validatedWebAppData,
      );
      mockAuthService.loginWithTelegramMiniApp.mockResolvedValue(
        expectedWebAppResponse,
      );

      const result = await controller.loginWithTelegramMiniApp(validWebAppAuth);

      expect(result).toHaveProperty("user");
      expect(result).toHaveProperty("accessToken");
      expect(typeof result.accessToken).toBe("string");
      expect(result.user.id).toBeDefined();
    });

    it("should throw UnauthorizedException when initData validation fails", async () => {
      mockTelegramService.validateWebAppInitData.mockImplementation(() => {
        throw new UnauthorizedException("Invalid Web App init data");
      });

      await expect(
        controller.loginWithTelegramMiniApp(validWebAppAuth),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        controller.loginWithTelegramMiniApp(validWebAppAuth),
      ).rejects.toThrow("Invalid Web App init data");

      expect(mockAuthService.loginWithTelegramMiniApp).not.toHaveBeenCalled();
    });

    it("should throw when initData is too large", async () => {
      mockTelegramService.validateWebAppInitData.mockImplementation(() => {
        throw new UnauthorizedException("Init data too large");
      });

      await expect(
        controller.loginWithTelegramMiniApp(validWebAppAuth),
      ).rejects.toThrow("Init data too large");
    });

    it("should throw when user data is missing in initData", async () => {
      mockTelegramService.validateWebAppInitData.mockReturnValue({
        auth_date: 1234567890,
        hash: "hash",
      } as unknown as ValidatedWebAppData);
      mockAuthService.loginWithTelegramMiniApp.mockRejectedValue(
        new UnauthorizedException("User data not found in init data"),
      );

      await expect(
        controller.loginWithTelegramMiniApp(validWebAppAuth),
      ).rejects.toThrow("User data not found in init data");
    });

    it("should handle malformed initData string", async () => {
      const malformedWebAppAuth: ITelegramWebAppAuth = {
        initData: "malformed_data",
      };

      mockTelegramService.validateWebAppInitData.mockImplementation(() => {
        throw new UnauthorizedException("Invalid init data format");
      });

      await expect(
        controller.loginWithTelegramMiniApp(malformedWebAppAuth),
      ).rejects.toThrow("Invalid init data format");
    });

    it("should handle empty initData", async () => {
      const emptyWebAppAuth: ITelegramWebAppAuth = {
        initData: "",
      };

      mockTelegramService.validateWebAppInitData.mockImplementation(() => {
        throw new UnauthorizedException("Missing required fields");
      });

      await expect(
        controller.loginWithTelegramMiniApp(emptyWebAppAuth),
      ).rejects.toThrow("Missing required fields");
    });

    it("should propagate service errors", async () => {
      mockTelegramService.validateWebAppInitData.mockReturnValue(
        validatedWebAppData,
      );
      mockAuthService.loginWithTelegramMiniApp.mockRejectedValue(
        new Error("Service error"),
      );

      await expect(
        controller.loginWithTelegramMiniApp(validWebAppAuth),
      ).rejects.toThrow("Service error");
    });
  });

  describe("POST /auth/logout - logout", () => {
    it("should return success status on logout", () => {
      const result = controller.logout();

      expect(result).toEqual({ success: true });
      expect(result.success).toBe(true);
    });

    it("should always return success regardless of state", () => {
      const result1 = controller.logout();
      const result2 = controller.logout();
      const result3 = controller.logout();

      expect(result1).toEqual({ success: true });
      expect(result2).toEqual({ success: true });
      expect(result3).toEqual({ success: true });
    });

    it("should not throw errors", () => {
      // Simply ensure the method completes without throwing
      const result = controller.logout();
      expect(result).toBeDefined();
    });

    it("should return correct response structure", () => {
      const result = controller.logout();

      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("GET /auth/me - me", () => {
    const mockRequest: AuthenticatedRequest = {
      user: {
        sub: "user_id_123",
        username: "johndoe",
        telegramId: 123456789,
      },
    } as unknown as AuthenticatedRequest;

    const mockUserDocument = {
      _id: "user_id_123",
      username: "johndoe",
      balance: 500,
      frozenBalance: 100,
      telegramId: 123456789,
      firstName: "John",
      lastName: "Doe",
      photoUrl: "https://example.com/photo.jpg",
      languageCode: "en",
      isPremium: true,
    };

    it("should return current user data when user exists", async () => {
      mockAuthService.validateUser.mockResolvedValue(
        mockUserDocument as unknown as UserDocument,
      );

      const result = await controller.me(mockRequest);

      expect(mockAuthService.validateUser).toHaveBeenCalledWith("user_id_123");
      expect(result).toEqual({
        id: "user_id_123",
        username: "johndoe",
        balance: 500,
        frozenBalance: 100,
        telegramId: 123456789,
        firstName: "John",
        lastName: "Doe",
        photoUrl: "https://example.com/photo.jpg",
        languageCode: "en",
      });
    });

    it("should return null when user not found", async () => {
      mockAuthService.validateUser.mockResolvedValue(null);

      const result = await controller.me(mockRequest);

      expect(result).toBeNull();
      expect(mockAuthService.validateUser).toHaveBeenCalledWith("user_id_123");
    });

    it("should handle user with minimal fields", async () => {
      const minimalUser = {
        _id: "user_id_456",
        username: "minimaluser",
        balance: 0,
        frozenBalance: 0,
      };

      mockAuthService.validateUser.mockResolvedValue(
        minimalUser as unknown as UserDocument,
      );

      const result = await controller.me({
        user: { sub: "user_id_456", username: "minimaluser" },
      } as unknown as AuthenticatedRequest);

      expect(result).toMatchObject({
        id: "user_id_456",
        username: "minimaluser",
        balance: 0,
        frozenBalance: 0,
      });
      expect(result?.telegramId).toBeUndefined();
      expect(result?.firstName).toBeUndefined();
    });

    it("should correctly convert _id to id string", async () => {
      const userWithObjectId = {
        _id: { toString: () => "converted_id_789" },
        username: "testuser",
        balance: 250,
        frozenBalance: 50,
      };

      mockAuthService.validateUser.mockResolvedValue(
        userWithObjectId as unknown as UserDocument,
      );

      const result = await controller.me(mockRequest);

      expect(result?.id).toBe("converted_id_789");
    });

    it("should handle all optional Telegram fields", async () => {
      const fullUser = {
        _id: "user_id_full",
        username: "fulluser",
        balance: 1000,
        frozenBalance: 200,
        telegramId: 999888777,
        firstName: "Full",
        lastName: "User",
        photoUrl: "https://example.com/full.jpg",
        languageCode: "ru",
      };

      mockAuthService.validateUser.mockResolvedValue(
        fullUser as unknown as UserDocument,
      );

      const result = await controller.me({
        user: { sub: "user_id_full", username: "fulluser" },
      } as unknown as AuthenticatedRequest);

      expect(result).toEqual({
        id: "user_id_full",
        username: "fulluser",
        balance: 1000,
        frozenBalance: 200,
        telegramId: 999888777,
        firstName: "Full",
        lastName: "User",
        photoUrl: "https://example.com/full.jpg",
        languageCode: "ru",
      });
    });

    it("should propagate service errors", async () => {
      mockAuthService.validateUser.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(controller.me(mockRequest)).rejects.toThrow(
        "Database error",
      );
    });

    it("should use user ID from JWT payload", async () => {
      const differentRequest: AuthenticatedRequest = {
        user: {
          sub: "different_user_id",
          username: "differentuser",
        },
      } as unknown as AuthenticatedRequest;

      mockAuthService.validateUser.mockResolvedValue(null);

      await controller.me(differentRequest);

      expect(mockAuthService.validateUser).toHaveBeenCalledWith(
        "different_user_id",
      );
      expect(mockAuthService.validateUser).not.toHaveBeenCalledWith(
        "user_id_123",
      );
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle unexpected service exceptions gracefully", async () => {
      const widgetAuth: ITelegramWidgetAuth = {
        id: 123,
        first_name: "Test",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "hash",
      };

      mockTelegramService.validateWidgetAuth.mockReturnValue(widgetAuth);
      mockAuthService.loginWithTelegramWidget.mockRejectedValue(
        new Error("Unexpected error"),
      );

      await expect(
        controller.loginWithTelegramWidget(widgetAuth),
      ).rejects.toThrow("Unexpected error");
    });

    it("should handle null/undefined inputs appropriately", async () => {
      mockTelegramService.validateWidgetAuth.mockImplementation(() => {
        throw new UnauthorizedException("Invalid input");
      });

      await expect(
        controller.loginWithTelegramWidget(
          null as unknown as ITelegramWidgetAuth,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should handle concurrent requests correctly", async () => {
      const widgetAuth: ITelegramWidgetAuth = {
        id: 123,
        first_name: "Concurrent",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "hash",
      };

      const response: ILoginResponse = {
        user: {
          id: "concurrent_user",
          username: "concurrent",
          balance: 0,
          frozenBalance: 0,
        },
        accessToken: "token",
      };

      mockTelegramService.validateWidgetAuth.mockReturnValue(widgetAuth);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue(response);

      const promise1 = controller.loginWithTelegramWidget(widgetAuth);
      const promise2 = controller.loginWithTelegramWidget(widgetAuth);
      const promise3 = controller.loginWithTelegramWidget(widgetAuth);

      const results = await Promise.all([promise1, promise2, promise3]);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toEqual(response);
      });
      expect(mockAuthService.loginWithTelegramWidget).toHaveBeenCalledTimes(3);
    });
  });

  describe("Response Format Validation", () => {
    it("should ensure ILoginResponse format for widget login", async () => {
      const widgetAuth: ITelegramWidgetAuth = {
        id: 123,
        first_name: "Format",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "hash",
      };

      const response: ILoginResponse = {
        user: {
          id: "format_user",
          username: "formattest",
          balance: 0,
          frozenBalance: 0,
        },
        accessToken: "format_token",
      };

      mockTelegramService.validateWidgetAuth.mockReturnValue(widgetAuth);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue(response);

      const result = await controller.loginWithTelegramWidget(widgetAuth);

      expect(result).toMatchObject({
        user: {
          id: anyString,
          username: anyString,
          balance: anyNumber,
          frozenBalance: anyNumber,
        },
        accessToken: anyString,
      });
    });

    it("should ensure IUserResponse format for me endpoint", async () => {
      const mockUser = {
        _id: "format_id",
        username: "formatuser",
        balance: 100,
        frozenBalance: 20,
      };

      mockAuthService.validateUser.mockResolvedValue(
        mockUser as unknown as UserDocument,
      );

      const result = await controller.me({
        user: { sub: "format_id", username: "formatuser" },
      } as unknown as AuthenticatedRequest);

      expect(result).toMatchObject({
        id: anyString,
        username: anyString,
        balance: anyNumber,
        frozenBalance: anyNumber,
      });
    });

    it("should ensure balance types are numbers", async () => {
      const mockUser = {
        _id: "balance_id",
        username: "balanceuser",
        balance: 500.5,
        frozenBalance: 100.25,
      };

      mockAuthService.validateUser.mockResolvedValue(
        mockUser as unknown as UserDocument,
      );

      const result = await controller.me({
        user: { sub: "balance_id", username: "balanceuser" },
      } as unknown as AuthenticatedRequest);

      expect(typeof result?.balance).toBe("number");
      expect(typeof result?.frozenBalance).toBe("number");
      expect(result?.balance).toBe(500.5);
      expect(result?.frozenBalance).toBe(100.25);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle full widget login flow", async () => {
      const widgetAuth: ITelegramWidgetAuth = {
        id: 555666777,
        first_name: "Integration",
        last_name: "Test",
        username: "integrationtest",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "integration_hash",
      };

      const validatedUser = { ...widgetAuth };
      const loginResponse: ILoginResponse = {
        user: {
          id: "integration_user_id",
          username: "integrationtest",
          balance: 0,
          frozenBalance: 0,
          telegramId: 555666777,
          firstName: "Integration",
          lastName: "Test",
        },
        accessToken: "integration_jwt_token",
      };

      mockTelegramService.validateWidgetAuth.mockReturnValue(validatedUser);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue(loginResponse);

      const result = await controller.loginWithTelegramWidget(widgetAuth);

      expect(mockTelegramService.validateWidgetAuth).toHaveBeenCalledWith(
        widgetAuth,
      );
      expect(mockAuthService.loginWithTelegramWidget).toHaveBeenCalledWith(
        validatedUser,
      );
      expect(result.accessToken).toBe("integration_jwt_token");
      expect(result.user.telegramId).toBe(555666777);
    });

    it("should handle full webapp login flow", async () => {
      const webAppAuth: ITelegramWebAppAuth = {
        initData:
          "query_id=test&user=%7B%22id%22%3A888%7D&auth_date=123&hash=h",
      };

      const validatedData = {
        query_id: "test",
        user: { id: 888, first_name: "WebApp" },
        auth_date: 123,
        hash: "h",
      };

      const loginResponse: ILoginResponse = {
        user: {
          id: "webapp_user_id",
          username: "tg_888",
          balance: 0,
          frozenBalance: 0,
          telegramId: 888,
          firstName: "WebApp",
        },
        accessToken: "webapp_jwt_token",
      };

      mockTelegramService.validateWebAppInitData.mockReturnValue(validatedData);
      mockAuthService.loginWithTelegramMiniApp.mockResolvedValue(loginResponse);

      const result = await controller.loginWithTelegramMiniApp(webAppAuth);

      expect(mockTelegramService.validateWebAppInitData).toHaveBeenCalledWith(
        webAppAuth.initData,
      );
      expect(mockAuthService.loginWithTelegramMiniApp).toHaveBeenCalledWith(
        validatedData,
      );
      expect(result.accessToken).toBe("webapp_jwt_token");
    });

    it("should handle login followed by me request", async () => {
      // Login
      const widgetAuth: ITelegramWidgetAuth = {
        id: 999,
        first_name: "Sequential",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "hash",
      };

      const loginResponse: ILoginResponse = {
        user: {
          id: "sequential_user_id",
          username: "sequential",
          balance: 200,
          frozenBalance: 50,
          telegramId: 999,
        },
        accessToken: "sequential_token",
      };

      mockTelegramService.validateWidgetAuth.mockReturnValue(widgetAuth);
      mockAuthService.loginWithTelegramWidget.mockResolvedValue(loginResponse);

      const loginResult = await controller.loginWithTelegramWidget(widgetAuth);

      // Me request
      const meRequest: AuthenticatedRequest = {
        user: {
          sub: "sequential_user_id",
          username: "sequential",
          telegramId: 999,
        },
      } as unknown as AuthenticatedRequest;

      const userDocument = {
        _id: "sequential_user_id",
        username: "sequential",
        balance: 200,
        frozenBalance: 50,
        telegramId: 999,
        firstName: "Sequential",
      };

      mockAuthService.validateUser.mockResolvedValue(
        userDocument as unknown as UserDocument,
      );

      const meResult = await controller.me(meRequest);

      expect(loginResult.user.id).toBe(meResult?.id);
      expect(loginResult.user.username).toBe(meResult?.username);
      expect(meResult?.balance).toBe(200);
    });
  });
});
