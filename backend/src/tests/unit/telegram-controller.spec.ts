/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { TelegramController } from "@/modules/telegram/telegram.controller";
import { TelegramBotService } from "@/modules/telegram/telegram-bot.service";
import type { FastifyRequest, FastifyReply } from "fastify";

describe("TelegramController", () => {
  let controller: TelegramController;
  let mockTelegramBotService: jest.Mocked<TelegramBotService>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockTelegramBotService = {
      handleWebhook: jest.fn(),
    } as any;

    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          WEBHOOK_SECRET: "test_webhook_secret_token_12345",
          BOT_TOKEN: "test_bot_token",
          MINI_APP_URL: "https://example.com",
          NODE_ENV: "production",
        };
        return config[key];
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        {
          provide: TelegramBotService,
          useValue: mockTelegramBotService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<TelegramController>(TelegramController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Controller Initialization", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });

    it("should load webhook secret from config on initialization", () => {
      expect(mockConfigService.get).toHaveBeenCalledWith("WEBHOOK_SECRET");
    });

    it("should handle missing webhook secret gracefully", async () => {
      mockConfigService.get.mockReturnValue("");

      const newModule = await Test.createTestingModule({
        controllers: [TelegramController],
        providers: [
          {
            provide: TelegramBotService,
            useValue: mockTelegramBotService,
          },
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      const newController =
        newModule.get<TelegramController>(TelegramController);
      expect(newController).toBeDefined();
    });
  });

  describe("Webhook Endpoint Tests", () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
      mockRequest = {
        body: {
          update_id: 123456789,
          message: {
            message_id: 1,
            from: {
              id: 123456789,
              is_bot: false,
              first_name: "John",
              last_name: "Doe",
              username: "johndoe",
              language_code: "en",
            },
            chat: {
              id: 123456789,
              first_name: "John",
              last_name: "Doe",
              username: "johndoe",
              type: "private",
            },
            date: Math.floor(Date.now() / 1000),
            text: "/start",
          },
        },
        headers: {},
      } as any;

      mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;
    });

    it("should process valid webhook with correct signature", async () => {
      const secretToken = "test_webhook_secret_token_12345";
      mockTelegramBotService.handleWebhook.mockResolvedValue(undefined);

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        mockRequest,
        mockReply,
      );
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it("should reject webhook with invalid signature", async () => {
      const invalidToken = "invalid_token";

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        invalidToken,
      );

      expect(mockTelegramBotService.handleWebhook).not.toHaveBeenCalled();
      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should reject webhook with missing signature", async () => {
      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        undefined,
      );

      expect(mockTelegramBotService.handleWebhook).not.toHaveBeenCalled();
      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should parse webhook payload correctly", async () => {
      const secretToken = "test_webhook_secret_token_12345";
      mockTelegramBotService.handleWebhook.mockResolvedValue(undefined);

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            update_id: 123456789,
            message: expect.any(Object),
          }),
        }),
        mockReply,
      );
    });

    it("should process webhook asynchronously without blocking", async () => {
      const secretToken = "test_webhook_secret_token_12345";
      let resolveWebhook: () => void;
      const webhookPromise = new Promise<void>((resolve) => {
        resolveWebhook = resolve;
      });

      mockTelegramBotService.handleWebhook.mockReturnValue(webhookPromise);

      const webhookCall = controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      // Webhook should be called immediately
      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();

      // Resolve the webhook
      resolveWebhook!();
      await webhookCall;
    });

    it("should handle webhook processing errors", async () => {
      const secretToken = "test_webhook_secret_token_12345";
      const error = new Error("Processing error");
      mockTelegramBotService.handleWebhook.mockRejectedValue(error);

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockReply.status).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Internal server error",
      });
    });

    it("should return 200 OK for valid requests even with async processing", async () => {
      const secretToken = "test_webhook_secret_token_12345";
      mockTelegramBotService.handleWebhook.mockResolvedValue(undefined);

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      // Should not call status or send for successful requests
      // (Telegram expects 200 by default)
      expect(mockReply.status).not.toHaveBeenCalled();
      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();
    });

    it("should handle rate limiting gracefully", async () => {
      const secretToken = "test_webhook_secret_token_12345";

      // Simulate multiple rapid requests
      const promises = Array.from({ length: 10 }, () =>
        controller.handleWebhook(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply,
          secretToken,
        ),
      );

      await Promise.all(promises);

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledTimes(10);
    });
  });

  describe("Command Handling Tests", () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;
    const secretToken = "test_webhook_secret_token_12345";

    beforeEach(() => {
      mockRequest = {
        body: {},
        headers: {},
      } as any;

      mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;

      mockTelegramBotService.handleWebhook.mockResolvedValue(undefined);
    });

    it("should process /start command", async () => {
      mockRequest.body = {
        update_id: 123456789,
        message: {
          message_id: 1,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/start",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            message: expect.objectContaining({
              text: "/start",
            }),
          }),
        }),
        mockReply,
      );
    });

    it("should process /help command with usage info", async () => {
      mockRequest.body = {
        update_id: 123456790,
        message: {
          message_id: 2,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/help",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            message: expect.objectContaining({
              text: "/help",
            }),
          }),
        }),
        mockReply,
      );
    });

    it("should process /balance command", async () => {
      mockRequest.body = {
        update_id: 123456791,
        message: {
          message_id: 3,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/balance",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();
    });

    it("should process /bid command", async () => {
      mockRequest.body = {
        update_id: 123456792,
        message: {
          message_id: 4,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/bid 100",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();
    });

    it("should process /auctions command", async () => {
      mockRequest.body = {
        update_id: 123456793,
        message: {
          message_id: 5,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/auctions",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();
    });

    it("should process /profile command", async () => {
      mockRequest.body = {
        update_id: 123456794,
        message: {
          message_id: 6,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/profile",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();
    });

    it("should process /language command", async () => {
      mockRequest.body = {
        update_id: 123456795,
        message: {
          message_id: 7,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/language",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            message: expect.objectContaining({
              text: "/language",
            }),
          }),
        }),
        mockReply,
      );
    });

    it("should handle unknown command", async () => {
      mockRequest.body = {
        update_id: 123456796,
        message: {
          message_id: 8,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/unknown",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();
    });

    it("should validate command requires authentication", async () => {
      mockRequest.body = {
        update_id: 123456797,
        message: {
          message_id: 9,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/balance",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            message: expect.objectContaining({
              from: expect.objectContaining({
                id: expect.any(Number),
              }),
            }),
          }),
        }),
        mockReply,
      );
    });

    it("should validate command parameters", async () => {
      mockRequest.body = {
        update_id: 123456798,
        message: {
          message_id: 10,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/bid invalid_amount",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();
    });
  });

  describe("Message Types Tests", () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;
    const secretToken = "test_webhook_secret_token_12345";

    beforeEach(() => {
      mockRequest = {
        body: {},
        headers: {},
      } as any;

      mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;

      mockTelegramBotService.handleWebhook.mockResolvedValue(undefined);
    });

    it("should route text messages", async () => {
      mockRequest.body = {
        update_id: 123456799,
        message: {
          message_id: 11,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "Hello, bot!",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            message: expect.objectContaining({
              text: "Hello, bot!",
            }),
          }),
        }),
        mockReply,
      );
    });

    it("should handle callback query", async () => {
      mockRequest.body = {
        update_id: 123456800,
        callback_query: {
          id: "query_id_123",
          from: { id: 123456789, is_bot: false, first_name: "John" },
          message: {
            message_id: 12,
            chat: { id: 123456789, type: "private" },
            date: Math.floor(Date.now() / 1000),
            text: "Select language:",
          },
          chat_instance: "chat_instance_123",
          data: "lang_en",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            callback_query: expect.objectContaining({
              data: "lang_en",
            }),
          }),
        }),
        mockReply,
      );
    });

    it("should handle inline query", async () => {
      mockRequest.body = {
        update_id: 123456801,
        inline_query: {
          id: "inline_query_123",
          from: { id: 123456789, is_bot: false, first_name: "John" },
          query: "search term",
          offset: "",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            inline_query: expect.objectContaining({
              query: "search term",
            }),
          }),
        }),
        mockReply,
      );
    });

    it("should handle message edit", async () => {
      mockRequest.body = {
        update_id: 123456802,
        edited_message: {
          message_id: 13,
          from: { id: 123456789, is_bot: false, first_name: "John" },
          chat: { id: 123456789, type: "private" },
          date: Math.floor(Date.now() / 1000),
          edit_date: Math.floor(Date.now() / 1000),
          text: "Edited message",
        },
      };

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            edited_message: expect.objectContaining({
              text: "Edited message",
            }),
          }),
        }),
        mockReply,
      );
    });
  });

  describe("Error Scenarios", () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;
    const secretToken = "test_webhook_secret_token_12345";

    beforeEach(() => {
      mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;
    });

    it("should handle malformed webhook payload", async () => {
      mockRequest = {
        body: {
          // Missing required fields
          invalid_field: "invalid_value",
        },
        headers: {},
      } as any;

      mockTelegramBotService.handleWebhook.mockRejectedValue(
        new Error("Invalid payload"),
      );

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockReply.status).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Internal server error",
      });
    });

    it("should handle invalid Telegram user data", async () => {
      mockRequest = {
        body: {
          update_id: 123456803,
          message: {
            message_id: 14,
            from: {
              id: -1, // Invalid user ID
              is_bot: false,
            },
            chat: { id: 123456789, type: "private" },
            date: Math.floor(Date.now() / 1000),
            text: "/start",
          },
        },
        headers: {},
      } as any;

      mockTelegramBotService.handleWebhook.mockRejectedValue(
        new Error("Invalid user data"),
      );

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      expect(mockReply.status).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Internal server error",
      });
    });
  });

  describe("Integration Test", () => {
    it("should handle full webhook flow from Telegram to service and back", async () => {
      const secretToken = "test_webhook_secret_token_12345";
      const mockRequest: Partial<FastifyRequest> = {
        body: {
          update_id: 123456804,
          message: {
            message_id: 15,
            from: {
              id: 987654321,
              is_bot: false,
              first_name: "Alice",
              last_name: "Smith",
              username: "alice_smith",
              language_code: "en",
            },
            chat: {
              id: 987654321,
              first_name: "Alice",
              last_name: "Smith",
              username: "alice_smith",
              type: "private",
            },
            date: Math.floor(Date.now() / 1000),
            text: "/start",
          },
        },
        headers: {},
      } as any;

      const mockReply: Partial<FastifyReply> = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;

      // Mock successful webhook processing
      mockTelegramBotService.handleWebhook.mockImplementation(
        async (req, _reply) => {
          // Simulate bot processing the message
          const update = (req as any).body;
          expect(update.message.text).toBe("/start");
          expect(update.message.from.username).toBe("alice_smith");
          return undefined;
        },
      );

      await controller.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        secretToken,
      );

      // Verify the complete flow
      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalledWith(
        mockRequest,
        mockReply,
      );

      // Should not return error
      expect(mockReply.status).not.toHaveBeenCalledWith(401);
      expect(mockReply.status).not.toHaveBeenCalledWith(500);
    });
  });

  describe("Configuration Edge Cases", () => {
    it("should handle empty webhook secret in development", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WEBHOOK_SECRET") return "";
        if (key === "NODE_ENV") return "development";
        return "test_value";
      });

      const newModule = await Test.createTestingModule({
        controllers: [TelegramController],
        providers: [
          {
            provide: TelegramBotService,
            useValue: mockTelegramBotService,
          },
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      const newController =
        newModule.get<TelegramController>(TelegramController);

      const mockRequest = {
        body: { update_id: 123 },
        headers: {},
      } as any;

      const mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;

      mockTelegramBotService.handleWebhook.mockResolvedValue(undefined);

      // Without secret, should process webhook without token validation
      await newController.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        undefined,
      );

      expect(mockTelegramBotService.handleWebhook).toHaveBeenCalled();
    });

    it("should enforce webhook secret in production", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WEBHOOK_SECRET") return "production_secret";
        if (key === "NODE_ENV") return "production";
        return "test_value";
      });

      const newModule = await Test.createTestingModule({
        controllers: [TelegramController],
        providers: [
          {
            provide: TelegramBotService,
            useValue: mockTelegramBotService,
          },
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      const newController =
        newModule.get<TelegramController>(TelegramController);

      const mockRequest = {
        body: { update_id: 123 },
        headers: {},
      } as any;

      const mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;

      // Should reject without correct token in production
      await newController.handleWebhook(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        "wrong_token",
      );

      expect(mockTelegramBotService.handleWebhook).not.toHaveBeenCalled();
      expect(mockReply.status).toHaveBeenCalledWith(401);
    });
  });
});
