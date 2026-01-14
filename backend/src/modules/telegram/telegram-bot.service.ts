import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";
import { Bot, Context, webhookCallback } from "grammy";
import type { FastifyRequest, FastifyReply } from "fastify";

interface BotContext extends Context {
  lang: string;
}

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot<BotContext>;
  private readonly botToken: string;
  private readonly webhookSecret: string;
  private readonly miniAppUrl: string;
  private readonly nodeEnv: string;
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {
    this.botToken = this.configService.get<string>("telegram.botToken")!;
    this.webhookSecret =
      this.configService.get<string>("telegram.webhookSecret") || "";
    this.miniAppUrl =
      this.configService.get<string>("telegram.miniAppUrl") || "";
    this.nodeEnv = this.configService.get<string>("nodeEnv") || "development";

    this.bot = new Bot<BotContext>(this.botToken);
    this.setupMiddleware();
    this.setupHandlers();
  }

  private t(key: string, lang: string, args?: Record<string, unknown>): string {
    return this.i18n.t(key, { lang, args });
  }

  private setupMiddleware() {
    // Language detection middleware
    this.bot.use(async (ctx, next) => {
      // Get language from user's Telegram settings
      const userLang = ctx.from?.language_code || "en";
      // Map to supported languages (en, ru)
      ctx.lang = ["ru", "uk", "be"].includes(userLang) ? "ru" : "en";
      await next();
    });
  }

  private setupHandlers() {
    const webAppUrl =
      this.configService.get<string>("telegram.miniAppUrl") || "";
    const isHttps = webAppUrl.startsWith("https://");

    // Handle /start command
    this.bot.command("start", async (ctx) => {
      const lang = ctx.lang;

      const title = this.t("bot.welcome.title", lang);
      const description = this.t("bot.welcome.description", lang);
      const openApp = this.t("bot.welcome.openApp", lang);
      const buttonText = this.t("bot.welcome.button", lang);

      // Telegram requires HTTPS for all inline button URLs
      if (isHttps) {
        await ctx.reply(`${title}\n\n${description}\n\n${openApp}`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: `🎯 ${buttonText}`, web_app: { url: webAppUrl } }],
            ],
          },
        });
      } else {
        // Development mode: send link as text since Telegram doesn't allow HTTP URLs
        await ctx.reply(
          `${title}\n\n${description}\n\n${openApp}\n\n${webAppUrl}`,
        );
      }
    });

    // Handle /help command
    this.bot.command("help", async (ctx) => {
      const lang = ctx.lang;

      const title = this.t("bot.help.title", lang);
      const commands = this.t("bot.help.commands", lang);
      const start = this.t("bot.help.start", lang);
      const helpCmd = this.t("bot.help.helpCmd", lang);
      const howItWorks = this.t("bot.help.howItWorks", lang);
      const step1 = this.t("bot.help.step1", lang);
      const step2 = this.t("bot.help.step2", lang);
      const step3 = this.t("bot.help.step3", lang);
      const step4 = this.t("bot.help.step4", lang);
      const goodLuck = this.t("bot.help.goodLuck", lang);

      await ctx.reply(
        `🎁 ${title}\n\n` +
          `${commands}\n` +
          `• ${start}\n` +
          `• ${helpCmd}\n\n` +
          `${howItWorks}\n` +
          `${step1}\n` +
          `${step2}\n` +
          `${step3}\n` +
          `${step4}\n\n` +
          `${goodLuck} 🍀`,
      );
    });

    // Handle errors
    this.bot.catch((err) => {
      this.logger.error("Bot error:", err);
    });
  }

  async onModuleInit() {
    if (!this.botToken) {
      this.logger.warn("BOT_TOKEN not configured, skipping bot initialization");
      return;
    }

    try {
      // Get bot info
      const me = await this.bot.api.getMe();
      this.logger.log(`Bot initialized: @${me.username}`);

      if (this.nodeEnv === "production") {
        // In production, auto-set webhook
        const webhookUrl = `${this.miniAppUrl}/api/telegram/webhook`;
        await this.setWebhook(webhookUrl);
        this.logger.log("Production mode: Webhook configured automatically");
      } else {
        // In development, use long polling
        this.logger.log("Development mode: Starting long polling...");
        await this.startPolling();
      }
    } catch (error) {
      this.logger.error("Failed to initialize bot:", error);
    }
  }

  async onModuleDestroy() {
    if (this.isRunning) {
      await this.stopPolling();
    }
  }

  private async startPolling() {
    if (this.isRunning) return;

    try {
      // Delete any existing webhook first
      await this.bot.api.deleteWebhook();

      // Start polling
      this.bot.start({
        onStart: () => {
          this.isRunning = true;
          this.logger.log("Bot polling started");
        },
      });
    } catch (error) {
      this.logger.error("Failed to start polling:", error);
    }
  }

  private async stopPolling() {
    if (!this.isRunning) return;

    try {
      await this.bot.stop();
      this.isRunning = false;
      this.logger.log("Bot polling stopped");
    } catch (error) {
      this.logger.error("Failed to stop polling:", error);
    }
  }

  getWebhookCallback() {
    return webhookCallback(this.bot, "fastify", {
      secretToken: this.webhookSecret || undefined,
    });
  }

  async handleWebhook(request: FastifyRequest, reply: FastifyReply) {
    const callback = this.getWebhookCallback();
    return callback(request, reply);
  }

  async setWebhook(url: string) {
    try {
      await this.bot.api.setWebhook(url, {
        secret_token: this.webhookSecret || undefined,
      });
      this.logger.log(`Webhook set to: ${url}`);
    } catch (error) {
      this.logger.error("Failed to set webhook:", error);
      throw error;
    }
  }

  async deleteWebhook() {
    try {
      await this.bot.api.deleteWebhook();
      this.logger.log("Webhook deleted");
    } catch (error) {
      this.logger.error("Failed to delete webhook:", error);
      throw error;
    }
  }

  getBot(): Bot<BotContext> {
    return this.bot;
  }
}
