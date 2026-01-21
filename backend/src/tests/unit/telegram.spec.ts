import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";
import { TelegramBotService } from "@/modules/telegram/telegram-bot.service";
import { User } from "@/schemas";
import { Bot } from "grammy";

// Mock Grammy Bot
jest.mock("grammy", () => ({
  Bot: jest.fn(),
  webhookCallback: jest.fn(),
}));

describe("TelegramBotService", () => {
  let service: TelegramBotService;
  let mockUserModel: any;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockI18nService: jest.Mocked<I18nService>;
  let mockBot: any;

  beforeEach(async () => {
    // Mock Bot instance
    mockBot = {
      api: {
        getMe: jest.fn(),
        setMyCommands: jest.fn(),
        setWebhook: jest.fn(),
        deleteWebhook: jest.fn(),
      },
      command: jest.fn(),
      callbackQuery: jest.fn(),
      catch: jest.fn(),
      use: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    };

    (Bot as jest.Mock).mockReturnValue(mockBot);

    mockUserModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          BOT_TOKEN: "test_bot_token",
          WEBHOOK_SECRET: "test_webhook_secret",
          MINI_APP_URL: "https://example.com",
          NODE_ENV: "test",
        };
        return config[key];
      }),
    } as any;

    mockI18nService = {
      t: jest.fn((key: string, _lang?: string) => {
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
    } as any;

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
    jest.clearAllMocks();
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should create bot with token from config", () => {
      expect(Bot).toHaveBeenCalledWith("test_bot_token");
    });

    it("should setup middleware and handlers on construction", () => {
      expect(mockBot.use).toHaveBeenCalled();
      expect(mockBot.command).toHaveBeenCalledWith("start", expect.any(Function));
      expect(mockBot.command).toHaveBeenCalledWith("help", expect.any(Function));
      expect(mockBot.command).toHaveBeenCalledWith(
        "language",
        expect.any(Function),
      );
      expect(mockBot.callbackQuery).toHaveBeenCalled();
      expect(mockBot.catch).toHaveBeenCalled();
    });
  });

  describe("Module Lifecycle", () => {
    it("should initialize bot on module init", async () => {
      mockBot.api.getMe.mockResolvedValue({ username: "test_bot" });
      mockBot.api.deleteWebhook.mockResolvedValue(true);

      await service.onModuleInit();

      expect(mockBot.api.getMe).toHaveBeenCalled();
    });

    it("should warn if BOT_TOKEN not configured", async () => {
      mockConfigService.get.mockReturnValue(undefined);

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

      await expect(newService.onModuleInit()).resolves.not.toThrow();
    });

    it("should setup bot commands in multiple languages", async () => {
      mockBot.api.getMe.mockResolvedValue({ username: "test_bot" });
      mockBot.api.setMyCommands.mockResolvedValue(true);
      mockBot.api.deleteWebhook.mockResolvedValue(true);

      await service.onModuleInit();

      // Should be called for default, en, and ru
      expect(mockBot.api.setMyCommands).toHaveBeenCalledTimes(3);
    });

    it("should handle bot initialization errors gracefully", async () => {
      mockBot.api.getMe.mockRejectedValue(new Error("Network error"));

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
      mockBot.api.setWebhook.mockResolvedValue(true);

      await service.setWebhook("https://example.com/webhook");

      expect(mockBot.api.setWebhook).toHaveBeenCalledWith(
        "https://example.com/webhook",
        { secret_token: "test_webhook_secret" },
      );
    });

    it("should delete webhook", async () => {
      mockBot.api.deleteWebhook.mockResolvedValue(true);

      await service.deleteWebhook();

      expect(mockBot.api.deleteWebhook).toHaveBeenCalled();
    });

    it("should throw error if webhook setup fails", async () => {
      mockBot.api.setWebhook.mockRejectedValue(new Error("Invalid URL"));

      await expect(
        service.setWebhook("https://example.com/webhook"),
      ).rejects.toThrow("Invalid URL");
    });

    it("should handle webhook deletion errors", async () => {
      mockBot.api.deleteWebhook.mockRejectedValue(new Error("API error"));

      await expect(service.deleteWebhook()).rejects.toThrow("API error");
    });
  });

  describe("Middleware Logic", () => {
    let middlewareFn: (ctx: any, next: () => Promise<void>) => Promise<void>;

    beforeEach(() => {
      const useCalls = mockBot.use.mock.calls;
      middlewareFn = useCalls[0][0];
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

      const next = jest.fn();
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

      const next = jest.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("ru");
    });

    it("should detect Russian from Ukrainian language code", async () => {
      const ctx = {
        from: { id: 12345, language_code: "uk" },
        lang: "",
      };

      mockUserModel.findOne.mockResolvedValue(null);

      const next = jest.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("ru");
    });

    it("should default to English for other languages", async () => {
      const ctx = {
        from: { id: 12345, language_code: "es" },
        lang: "",
      };

      mockUserModel.findOne.mockResolvedValue(null);

      const next = jest.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("en");
    });

    it("should default to English if no language code", async () => {
      const ctx = {
        from: { id: 12345 },
        lang: "",
      };

      mockUserModel.findOne.mockResolvedValue(null);

      const next = jest.fn();
      await middlewareFn(ctx, next);

      expect(ctx.lang).toBe("en");
    });
  });

  describe("Command Handlers", () => {
    describe("/start command", () => {
      let startHandler: ((ctx: any) => Promise<void>) | undefined;

      beforeEach(() => {
        const commandCalls = mockBot.command.mock.calls;
        const startCall = commandCalls.find((call: any[]) => call[0] === "start");
        startHandler = startCall?.[1];
      });

      it("should send welcome message with inline button for HTTPS URL", async () => {
        const ctx = {
          lang: "en",
          reply: jest.fn(),
        };

        if (startHandler) await startHandler(ctx);

        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining("translated_"),
          expect.objectContaining({
            parse_mode: "HTML",
            reply_markup: expect.objectContaining({
              inline_keyboard: expect.any(Array),
            }),
          }),
        );
      });

      it("should send welcome message for /start command", async () => {
        const commandCalls = mockBot.command.mock.calls;
        const startCall = commandCalls.find((call: any[]) => call[0] === "start");
        const handler = startCall?.[1];

        const ctx = {
          lang: "en",
          reply: jest.fn(),
        };

        if (handler) await handler(ctx);

        expect(ctx.reply).toHaveBeenCalled();
        const callArgs = (ctx.reply as jest.Mock).mock.calls[0];
        expect(callArgs[1]?.parse_mode).toBe("HTML");
        // Check that the welcome message was sent with proper formatting
        expect(callArgs[0]).toContain("Welcome");
      });

      it("should use i18n for translations", async () => {
        const ctx = {
          lang: "ru",
          reply: jest.fn(),
        };

        if (startHandler) await startHandler(ctx);

        expect(mockI18nService.t).toHaveBeenCalledWith("bot.welcome.title", {
          lang: "ru",
          args: undefined,
        });
      });
    });

    describe("/help command", () => {
      let helpHandler: ((ctx: any) => Promise<void>) | undefined;

      beforeEach(() => {
        const commandCalls = mockBot.command.mock.calls;
        const helpCall = commandCalls.find((call: any[]) => call[0] === "help");
        helpHandler = helpCall?.[1];
      });

      it("should send help message with commands and instructions", async () => {
        const ctx = {
          lang: "en",
          reply: jest.fn(),
        };

        if (helpHandler) await helpHandler(ctx);

        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining("translated_"),
          expect.objectContaining({
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
      let languageHandler: ((ctx: any) => Promise<void>) | undefined;

      beforeEach(() => {
        const commandCalls = mockBot.command.mock.calls;
        const langCall = commandCalls.find((call: any[]) => call[0] === "language");
        languageHandler = langCall?.[1];
      });

      it("should send language selection keyboard", async () => {
        const ctx = {
          lang: "en",
          reply: jest.fn(),
        };

        if (languageHandler) await languageHandler(ctx);

        expect(ctx.reply).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            reply_markup: {
              inline_keyboard: [
                [
                  { text: expect.any(String), callback_data: "lang_en" },
                  { text: expect.any(String), callback_data: "lang_ru" },
                ],
              ],
            },
          }),
        );
      });
    });
  });

  describe("Callback Query Handlers", () => {
    let callbackHandler: (ctx: any) => Promise<void>;

    beforeEach(() => {
      const callbackCalls = mockBot.callbackQuery.mock.calls;
      callbackHandler = callbackCalls[0]?.[1];
    });

    it("should update user language preference", async () => {
      const ctx = {
        from: { id: 12345 },
        callbackQuery: { data: "lang_ru" },
        answerCallbackQuery: jest.fn(),
        editMessageText: jest.fn(),
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
        answerCallbackQuery: jest.fn(),
        editMessageText: jest.fn(),
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
        answerCallbackQuery: jest.fn(),
      };

      await callbackHandler(ctx);

      expect(mockUserModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    let errorHandler: (err: Error) => void;

    beforeEach(() => {
      const catchCalls = mockBot.catch.mock.calls;
      errorHandler = catchCalls[0]?.[0];
    });

    it("should catch and log bot errors", () => {
      const error = new Error("Test error");
      const loggerSpy = jest.spyOn(service["logger"], "error");

      errorHandler(error);

      expect(loggerSpy).toHaveBeenCalledWith("Bot error:", error);
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

      const newService =
        newModule.get<TelegramBotService>(TelegramBotService);

      mockBot.api.getMe.mockResolvedValue({ username: "test_bot" });
      mockBot.api.setWebhook.mockResolvedValue(true);
      mockBot.api.setMyCommands.mockResolvedValue(true);

      await newService.onModuleInit();

      expect(mockBot.api.setWebhook).toHaveBeenCalled();
      const webhookCall = (mockBot.api.setWebhook as jest.Mock).mock.calls[0];
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

      const newService =
        newModule.get<TelegramBotService>(TelegramBotService);

      mockBot.api.getMe.mockResolvedValue({ username: "test_bot" });
      mockBot.api.deleteWebhook.mockResolvedValue(true);
      mockBot.api.setMyCommands.mockResolvedValue(true);

      await newService.onModuleInit();

      expect(mockBot.api.deleteWebhook).toHaveBeenCalled();
      expect(mockBot.start).toHaveBeenCalled();
    });
  });

  describe("Bot Instance Access", () => {
    it("should return bot instance", () => {
      const bot = service.getBot();

      expect(bot).toBe(mockBot);
    });
  });

  describe("Webhook Callback", () => {
    it("should create webhook callback with secret token", () => {
      const webhookCallbackModule = require("grammy");

      service.getWebhookCallback();

      expect(webhookCallbackModule.webhookCallback).toHaveBeenCalledWith(
        mockBot,
        "fastify",
        { secretToken: "test_webhook_secret" },
      );
    });

    it("should handle webhook requests", async () => {
      const mockRequest = {} as any;
      const mockReply = {} as any;
      const mockCallback = jest.fn();

      const webhookCallbackModule = require("grammy");
      webhookCallbackModule.webhookCallback.mockReturnValue(mockCallback);

      await service.handleWebhook(mockRequest, mockReply);

      expect(mockCallback).toHaveBeenCalledWith(mockRequest, mockReply);
    });
  });
});
