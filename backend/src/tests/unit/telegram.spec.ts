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
import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";
import { TelegramBotService } from "@/modules/telegram/telegram-bot.service";
import { User } from "@/schemas";

// Define the mock bot interface
interface MockBotType {
  api: {
    getMe: ReturnType<typeof vi.fn>;
    setMyCommands: ReturnType<typeof vi.fn>;
    setWebhook: ReturnType<typeof vi.fn>;
    deleteWebhook: ReturnType<typeof vi.fn>;
  };
  command: ReturnType<typeof vi.fn>;
  callbackQuery: ReturnType<typeof vi.fn>;
  catch: ReturnType<typeof vi.fn>;
  use: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

// Define context interface for telegram handlers
interface TelegramContext {
  from?: { id: number; language_code?: string };
  lang?: string;
  reply?: Mock;
  callbackQuery?: { data: string };
  answerCallbackQuery?: Mock;
  editMessageText?: Mock;
}

// Define command handler type
type CommandHandler = (ctx: TelegramContext) => Promise<void>;

// Define callback handler type
type CallbackHandler = (ctx: TelegramContext) => Promise<void>;

// Define middleware type
type Middleware = (
  ctx: TelegramContext,
  next: () => Promise<void>,
) => Promise<void>;

// Define error handler type
type ErrorHandler = (err: Error) => void;

// Define mock request/reply types for webhook
interface MockRequest {
  headers?: Record<string, string>;
  body?: unknown;
}

interface MockReply {
  send?: Mock;
  status?: Mock;
}

// Mock Grammy Bot with a proper class that can be constructed
vi.mock("grammy", async (importOriginal) => {
  // Import to get types but we won't use the actual implementation
  await importOriginal();

  // Create a proper class for the mock - this must be self-contained
  class MockBot {
    api = {
      getMe: vi.fn(),
      setMyCommands: vi.fn(),
      setWebhook: vi.fn(),
      deleteWebhook: vi.fn(),
    };
    command = vi.fn();
    callbackQuery = vi.fn();
    catch = vi.fn();
    use = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  }

  return {
    Bot: MockBot,
    webhookCallback: vi.fn(),
    Context: class {},
  };
});

describe("TelegramBotService", () => {
  let service: TelegramBotService;
  let mockUserModel: {
    findOne: Mock;
    findOneAndUpdate: Mock;
  };
  let mockConfigService: { get: Mock };
  let mockI18nService: { t: Mock };

  // Typed helper constants to avoid no-unsafe-assignment warnings
  const anyFunction = expect.any(Function) as unknown as () => void;
  const anyString = expect.any(String) as unknown as string;
  const anyArray = expect.any(Array) as unknown as unknown[];

  // Helper function for partial object matching
  function partialMatch<T>(obj: Partial<T>): T {
    return expect.objectContaining(obj) as unknown as T;
  }

  // Helper to get the mock bot instance from the service
  const getMockBot = () => service.getBot() as unknown as MockBotType;

  beforeEach(async () => {
    // Clear mocks before each test
    vi.clearAllMocks();

    mockUserModel = {
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
    };

    mockConfigService = {
      get: vi.fn((key: string) => {
        const config: Record<string, string> = {
          BOT_TOKEN: "test_bot_token",
          WEBHOOK_SECRET: "test_webhook_secret",
          MINI_APP_URL: "https://example.com",
          NODE_ENV: "test",
        };
        return config[key];
      }),
    };

    mockI18nService = {
      t: vi.fn((key: string, _lang?: string) => {
        // Handle complex translation keys with dots
        const translations: Record<string, string> = {
          "bot.welcome.title": "Welcome to CryptoBot",
          "bot.welcome.description": "This is an auction platform",
          "bot.welcome.notifications": "Enable notifications",
          "bot.welcome.button": "Open App",
          "bot.help.title": "Help",
          "bot.help.description": "Auction platform help",
          "bot.language.title": "Select Language",
          "errors.invalid_language": "Invalid language",
        };
        return translations[key] || `translated_${key}`;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramBotService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: I18nService,
          useValue: mockI18nService,
        },
      ],
    }).compile();

    service = module.get<TelegramBotService>(TelegramBotService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should create bot with token from config", () => {
      // Bot was instantiated with the config service providing the token
      // The service should have a bot instance
      expect(service.getBot()).toBeDefined();
    });

    it("should setup middleware and handlers on construction", () => {
      expect(getMockBot().use).toHaveBeenCalled();
      expect(getMockBot().command).toHaveBeenCalledWith("start", anyFunction);
      expect(getMockBot().command).toHaveBeenCalledWith("help", anyFunction);
      expect(getMockBot().command).toHaveBeenCalledWith(
        "language",
        anyFunction,
      );
      expect(getMockBot().callbackQuery).toHaveBeenCalled();
      expect(getMockBot().catch).toHaveBeenCalled();
    });
  });

  describe("Module Lifecycle", () => {
    it("should initialize bot on module init", async () => {
      getMockBot().api.getMe.mockResolvedValue({ username: "test_bot" });
      getMockBot().api.deleteWebhook.mockResolvedValue(true);

      await service.onModuleInit();

      expect(getMockBot().api.getMe).toHaveBeenCalled();
    });

    it("should throw if BOT_TOKEN not configured", async () => {
      mockConfigService.get.mockReturnValue(undefined);

      // The service constructor throws when BOT_TOKEN is not configured
      await expect(
        Test.createTestingModule({
          providers: [
            TelegramBotService,
            {
              provide: getModelToken(User.name),
              useValue: mockUserModel,
            },
            {
              provide: ConfigService,
              useValue: mockConfigService,
            },
            {
              provide: I18nService,
              useValue: mockI18nService,
            },
          ],
        }).compile(),
      ).rejects.toThrow("BOT_TOKEN is required");
    });

    it("should setup bot commands in multiple languages", async () => {
      getMockBot().api.getMe.mockResolvedValue({ username: "test_bot" });
      getMockBot().api.setMyCommands.mockResolvedValue(true);
      getMockBot().api.deleteWebhook.mockResolvedValue(true);

      await service.onModuleInit();

      // Should be called for default, en, and ru
      expect(getMockBot().api.setMyCommands).toHaveBeenCalledTimes(3);
    });

    it("should handle bot initialization errors gracefully", async () => {
      getMockBot().api.getMe.mockRejectedValue(new Error("Network error"));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should call onModuleDestroy without errors", async () => {
      // onModuleDestroy only calls stopPolling if isRunning is true
      // Since we don't actually start polling in tests, this just ensures no errors
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe("Webhook Management", () => {
    it("should set webhook with URL and secret", async () => {
      getMockBot().api.setWebhook.mockResolvedValue(true);

      await service.setWebhook("https://example.com/webhook");

      expect(getMockBot().api.setWebhook).toHaveBeenCalledWith(
        "https://example.com/webhook",
        { secret_token: "test_webhook_secret" },
      );
    });

    it("should delete webhook", async () => {
      getMockBot().api.deleteWebhook.mockResolvedValue(true);

      await service.deleteWebhook();

      expect(getMockBot().api.deleteWebhook).toHaveBeenCalled();
    });

    it("should throw error if webhook setup fails", async () => {
      getMockBot().api.setWebhook.mockRejectedValue(new Error("Invalid URL"));

      await expect(
        service.setWebhook("https://example.com/webhook"),
      ).rejects.toThrow("Invalid URL");
    });

    it("should handle webhook deletion errors", async () => {
      getMockBot().api.deleteWebhook.mockRejectedValue(new Error("API error"));

      await expect(service.deleteWebhook()).rejects.toThrow("API error");
    });
  });

  describe("Middleware Logic", () => {
    let middlewareFn: Middleware;

    beforeEach(() => {
      const useCalls = getMockBot().use.mock.calls;
      middlewareFn = useCalls[0][0] as Middleware;
    });

    it("should use stored user language if available", async () => {
      const ctx = {
        from: { id: 12345, language_code: "en" },
        lang: "",
      };

      mockUserModel.findOne.mockResolvedValue({
        telegramId: 12345,
        languageCode: "ru",
      });

      const next = vi.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("ru");
      expect(next).toHaveBeenCalled();
    });

    it("should detect Russian from user language code", async () => {
      const ctx = {
        from: { id: 12345, language_code: "ru" },
        lang: "",
      };

      mockUserModel.findOne.mockResolvedValue(null);

      const next = vi.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("ru");
    });

    it("should detect Russian from Ukrainian language code", async () => {
      const ctx = {
        from: { id: 12345, language_code: "uk" },
        lang: "",
      };

      mockUserModel.findOne.mockResolvedValue(null);

      const next = vi.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("ru");
    });

    it("should default to English for other languages", async () => {
      const ctx = {
        from: { id: 12345, language_code: "es" },
        lang: "",
      };

      mockUserModel.findOne.mockResolvedValue(null);

      const next = vi.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("en");
    });

    it("should default to English if no language code", async () => {
      const ctx = {
        from: { id: 12345 },
        lang: "",
      };

      mockUserModel.findOne.mockResolvedValue(null);

      const next = vi.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("en");
    });
  });

  describe("Command Handlers", () => {
    describe("/start command", () => {
      let startHandler: CommandHandler | undefined;

      beforeEach(() => {
        const commandCalls = getMockBot().command.mock.calls;
        const startCall = commandCalls.find(
          (call: unknown[]) => call[0] === "start",
        );
        startHandler = startCall?.[1] as CommandHandler | undefined;
      });

      it("should send welcome message with inline button for HTTPS URL", async () => {
        const ctx = {
          lang: "en",
          reply: vi.fn(),
        };

        if (startHandler) await startHandler(ctx);

        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining("translated_"),
          partialMatch<{ parse_mode: string; reply_markup: unknown }>({
            parse_mode: "HTML",
            reply_markup: partialMatch<{ inline_keyboard: unknown[] }>({
              inline_keyboard: anyArray,
            }),
          }),
        );
      });

      it("should send welcome message for /start command", async () => {
        const commandCalls = getMockBot().command.mock.calls;
        const startCall = commandCalls.find(
          (call: unknown[]) => call[0] === "start",
        );
        const handler = startCall?.[1] as
          | ((ctx: {
              lang: string;
              reply: ReturnType<typeof vi.fn>;
            }) => Promise<void>)
          | undefined;

        const ctx = {
          lang: "en",
          reply: vi.fn(),
        };

        if (handler) await handler(ctx);

        expect(ctx.reply).toHaveBeenCalled();
        const callArgs = ctx.reply.mock.calls[0] as [
          string,
          { parse_mode?: string },
        ];
        expect(callArgs[1]?.parse_mode).toBe("HTML");
        // Check that the welcome message was sent with proper formatting
        expect(callArgs[0]).toContain("Welcome");
      });

      it("should use i18n for translations", async () => {
        const ctx = {
          lang: "ru",
          reply: vi.fn(),
        };

        if (startHandler) await startHandler(ctx);

        expect(mockI18nService.t).toHaveBeenCalledWith("bot.welcome.title", {
          lang: "ru",
          args: undefined,
        });
      });
    });

    describe("/help command", () => {
      let helpHandler: CommandHandler | undefined;

      beforeEach(() => {
        const commandCalls = getMockBot().command.mock.calls;
        const helpCall = commandCalls.find(
          (call: unknown[]) => call[0] === "help",
        );
        helpHandler = helpCall?.[1] as CommandHandler | undefined;
      });

      it("should send help message with commands and instructions", async () => {
        const ctx = {
          lang: "en",
          reply: vi.fn(),
        };

        if (helpHandler) await helpHandler(ctx);

        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining("translated_"),
          partialMatch<{ parse_mode: string }>({
            parse_mode: "HTML",
          }),
        );
        expect(mockI18nService.t).toHaveBeenCalledWith("bot.help.title", {
          lang: "en",
          args: undefined,
        });
      });
    });

    describe("/language command", () => {
      let languageHandler: CommandHandler | undefined;

      beforeEach(() => {
        const commandCalls = getMockBot().command.mock.calls;
        const langCall = commandCalls.find(
          (call: unknown[]) => call[0] === "language",
        );
        languageHandler = langCall?.[1] as CommandHandler | undefined;
      });

      it("should send language selection keyboard", async () => {
        const ctx = {
          lang: "en",
          reply: vi.fn(),
        };

        if (languageHandler) await languageHandler(ctx);

        expect(ctx.reply).toHaveBeenCalledWith(
          anyString,
          partialMatch<{ reply_markup: unknown }>({
            reply_markup: {
              inline_keyboard: [
                [
                  { text: anyString, callback_data: "lang_en" },
                  { text: anyString, callback_data: "lang_ru" },
                ],
              ],
            },
          }),
        );
      });
    });
  });

  describe("Callback Query Handlers", () => {
    let callbackHandler: CallbackHandler;

    beforeEach(() => {
      const callbackCalls = getMockBot().callbackQuery.mock.calls;
      callbackHandler = callbackCalls[0]?.[1] as CallbackHandler;
    });

    it("should update user language preference", async () => {
      const ctx = {
        from: { id: 12345 },
        callbackQuery: { data: "lang_ru" },
        answerCallbackQuery: vi.fn(),
        editMessageText: vi.fn(),
      };

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        telegramId: 12345,
        languageCode: "ru",
      });

      await callbackHandler(ctx);

      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        { telegramId: 12345 },
        { languageCode: "ru" },
        { upsert: false },
      );
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalled();
    });

    it("should handle English language selection", async () => {
      const ctx = {
        from: { id: 12345 },
        callbackQuery: { data: "lang_en" },
        answerCallbackQuery: vi.fn(),
        editMessageText: vi.fn(),
      };

      mockUserModel.findOneAndUpdate.mockResolvedValue({
        telegramId: 12345,
        languageCode: "en",
      });

      await callbackHandler(ctx);

      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        { telegramId: 12345 },
        { languageCode: "en" },
        { upsert: false },
      );
    });

    it("should ignore invalid callback data", async () => {
      const ctx = {
        from: { id: 12345 },
        callbackQuery: { data: "invalid_callback" },
        answerCallbackQuery: vi.fn(),
      };

      await callbackHandler(ctx);

      expect(mockUserModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    let errorHandler: ErrorHandler;

    beforeEach(() => {
      const catchCalls = getMockBot().catch.mock.calls;
      errorHandler = catchCalls[0]?.[0] as ErrorHandler;
    });

    it("should catch bot errors without throwing", () => {
      const error = new Error("Test error");

      // Error handler should not throw - it catches and logs internally
      expect(() => errorHandler(error)).not.toThrow();
    });
  });

  describe("Production vs Development Mode", () => {
    it("should use webhook in production mode", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "NODE_ENV") return "production";
        if (key === "BOT_TOKEN") return "test_token";
        if (key === "MINI_APP_URL") return "https://example.com";
        return undefined;
      });

      const newModule = await Test.createTestingModule({
        providers: [
          TelegramBotService,
          {
            provide: getModelToken(User.name),
            useValue: mockUserModel,
          },
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
          {
            provide: I18nService,
            useValue: mockI18nService,
          },
        ],
      }).compile();

      const newService = newModule.get<TelegramBotService>(TelegramBotService);
      const newBot = newService.getBot() as unknown as MockBotType;

      newBot.api.getMe.mockResolvedValue({ username: "test_bot" });
      newBot.api.setWebhook.mockResolvedValue(true);
      newBot.api.setMyCommands.mockResolvedValue(true);

      await newService.onModuleInit();

      expect(newBot.api.setWebhook).toHaveBeenCalled();
      const webhookCall = (newBot.api.setWebhook as Mock).mock.calls[0];
      expect(webhookCall[0]).toBe("https://example.com/api/telegram/webhook");
    });

    it("should use polling in development mode", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "NODE_ENV") return "development";
        if (key === "BOT_TOKEN") return "test_token";
        if (key === "MINI_APP_URL") return "https://example.com";
        return undefined;
      });

      const newModule = await Test.createTestingModule({
        providers: [
          TelegramBotService,
          {
            provide: getModelToken(User.name),
            useValue: mockUserModel,
          },
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
          {
            provide: I18nService,
            useValue: mockI18nService,
          },
        ],
      }).compile();

      const newService = newModule.get<TelegramBotService>(TelegramBotService);
      const newBot = newService.getBot() as unknown as MockBotType;

      newBot.api.getMe.mockResolvedValue({ username: "test_bot" });
      newBot.api.deleteWebhook.mockResolvedValue(true);
      newBot.api.setMyCommands.mockResolvedValue(true);

      await newService.onModuleInit();

      expect(newBot.api.deleteWebhook).toHaveBeenCalled();
      expect(newBot.start).toHaveBeenCalled();
    });
  });

  describe("Bot Instance Access", () => {
    it("should return bot instance", () => {
      const bot = service.getBot();

      expect(bot).toBe(getMockBot());
    });
  });

  describe("Webhook Callback", () => {
    it("should create webhook callback with secret token", async () => {
      const { webhookCallback } = await import("grammy");

      service.getWebhookCallback();

      expect(webhookCallback).toHaveBeenCalledWith(getMockBot(), "fastify", {
        secretToken: "test_webhook_secret",
      });
    });

    it("should handle webhook requests", async () => {
      const mockRequest = {} as MockRequest;
      const mockReply = {} as MockReply;
      const mockCallback = vi.fn();

      const { webhookCallback } = await import("grammy");
      (webhookCallback as Mock).mockReturnValue(mockCallback);

      await service.handleWebhook(mockRequest as unknown, mockReply as unknown);

      expect(mockCallback).toHaveBeenCalledWith(mockRequest, mockReply);
    });
  });
});
