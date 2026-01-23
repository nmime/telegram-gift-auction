import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";
import { Bot, Context, webhookCallback } from "grammy";
import type { FastifyRequest, FastifyReply } from "fastify";
import { User, UserDocument } from "@/schemas";
import { isPrimaryWorker, getWorkerId } from "@/common";

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
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {
    const token = this.configService.get<string>("BOT_TOKEN");
    if (token === undefined) {
      throw new Error("BOT_TOKEN is required");
    }
    this.botToken = token;
    this.webhookSecret = this.configService.get<string>("WEBHOOK_SECRET") ?? "";
    this.miniAppUrl = this.configService.get<string>("MINI_APP_URL") ?? "";
    this.nodeEnv = this.configService.get<string>("NODE_ENV") ?? "development";

    this.bot = new Bot<BotContext>(this.botToken);
    this.setupMiddleware();
    this.setupHandlers();
  }

  async onModuleInit(): Promise<void> {
    if (this.botToken === "") {
      this.logger.warn("BOT_TOKEN not configured, skipping bot initialization");
      return;
    }

    if (!isPrimaryWorker()) {
      const workerId = getWorkerId();
      this.logger.log(
        `Worker ${String(workerId)}: Skipping Telegram setup (handled by primary worker)`,
      );
      return;
    }

    try {
      const me = await this.bot.api.getMe();
      this.logger.log(`Bot initialized: @${me.username}`);

      await this.setupBotCommands();

      if (this.nodeEnv === "production") {
        const webhookUrl = `${this.miniAppUrl}/api/telegram/webhook`;
        await this.setWebhook(webhookUrl);
        this.logger.log("Production mode: Webhook configured automatically");
      } else {
        this.logger.log("Development mode: Starting long polling...");
        await this.startPolling();
      }
    } catch (error) {
      this.logger.error("Failed to initialize bot:", error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isRunning) {
      await this.stopPolling();
    }
  }

  getWebhookCallback(): (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void> {
    return webhookCallback(this.bot, "fastify", {
      secretToken: this.webhookSecret !== "" ? this.webhookSecret : undefined,
    }) as (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  async handleWebhook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const callback = this.getWebhookCallback();
    await callback(request, reply);
  }

  async setWebhook(url: string): Promise<void> {
    try {
      await this.bot.api.setWebhook(url, {
        secret_token:
          this.webhookSecret !== "" ? this.webhookSecret : undefined,
      });
      this.logger.log(`Webhook set to: ${url}`);
    } catch (error) {
      this.logger.error("Failed to set webhook:", error);
      throw error;
    }
  }

  async deleteWebhook(): Promise<void> {
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

  private t(key: string, lang: string, args?: Record<string, unknown>): string {
    return this.i18n.t(key, { lang, args });
  }

  private setupMiddleware(): void {
    this.bot.use(async (ctx, next) => {
      if (ctx.from?.id !== undefined && ctx.from.id !== 0) {
        const user = await this.userModel.findOne({ telegramId: ctx.from.id });
        if (
          user?.languageCode !== undefined &&
          ["en", "ru"].includes(user.languageCode)
        ) {
          ctx.lang = user.languageCode;
          await next();
          return;
        }
      }

      const userLang = ctx.from?.language_code ?? "en";
      ctx.lang = ["ru", "uk", "be"].includes(userLang) ? "ru" : "en";
      await next();
    });
  }

  private setupHandlers(): void {
    const webAppUrl = this.configService.get<string>("MINI_APP_URL") ?? "";
    const isHttps = webAppUrl.startsWith("https://");

    this.bot.command("start", async (ctx) => {
      const lang = ctx.lang;

      const title = this.t("bot.welcome.title", lang);
      const description = this.t("bot.welcome.description", lang);
      const notifications = this.t("bot.welcome.notifications", lang);
      const openApp = this.t("bot.welcome.openApp", lang);
      const buttonText = this.t("bot.welcome.button", lang);

      const message = `${title}\n\n${description}\n\n${notifications}\n\n${openApp}`;

      if (isHttps) {
        await ctx.reply(message, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: buttonText, web_app: { url: webAppUrl } }],
            ],
          },
        });
      } else {
        await ctx.reply(`${message}\n\n${webAppUrl}`, { parse_mode: "HTML" });
      }
    });

    this.bot.command("help", async (ctx) => {
      const lang = ctx.lang;

      const title = this.t("bot.help.title", lang);
      const commands = this.t("bot.help.commands", lang);
      const start = this.t("bot.help.start", lang);
      const helpCmd = this.t("bot.help.helpCmd", lang);
      const languageCmd = this.t("bot.help.languageCmd", lang);
      const howItWorks = this.t("bot.help.howItWorks", lang);
      const step1 = this.t("bot.help.step1", lang);
      const step2 = this.t("bot.help.step2", lang);
      const step3 = this.t("bot.help.step3", lang);
      const step4 = this.t("bot.help.step4", lang);
      const notifications = this.t("bot.help.notifications", lang);
      const goodLuck = this.t("bot.help.goodLuck", lang);

      await ctx.reply(
        `${title}\n\n` +
          `${commands}\n` +
          `• ${start}\n` +
          `• ${helpCmd}\n` +
          `• ${languageCmd}` +
          `${howItWorks}\n` +
          `${step1}\n` +
          `${step2}\n` +
          `${step3}\n` +
          step4 +
          notifications +
          goodLuck,
        { parse_mode: "HTML" },
      );
    });

    this.bot.command("language", async (ctx) => {
      const lang = ctx.lang;

      const title = this.t("bot.language.title", lang);
      const select = this.t("bot.language.select", lang);
      const english = this.t("bot.language.english", lang);
      const russian = this.t("bot.language.russian", lang);

      await ctx.reply(`${title}\n\n${select}`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: english, callback_data: "lang_en" },
              { text: russian, callback_data: "lang_ru" },
            ],
          ],
        },
      });
    });

    this.bot.callbackQuery(/^lang_(en|ru)$/, async (ctx) => {
      const match = /^lang_(en|ru)$/.exec(ctx.callbackQuery.data);
      if (match?.[1] === undefined) return;

      const newLang = match[1];
      const telegramId = ctx.from.id;

      await this.userModel.findOneAndUpdate(
        { telegramId },
        { languageCode: newLang },
        { upsert: false },
      );

      const changed = this.t("bot.language.changed", newLang);

      await ctx.answerCallbackQuery({ text: changed });
      await ctx.editMessageText(`✅ ${changed}`);
    });

    this.bot.catch((err) => {
      this.logger.error("Bot error:", err);
    });
  }

  private async setupBotCommands(): Promise<void> {
    const getCommands = (
      lang: string,
    ): { command: string; description: string }[] => [
      { command: "start", description: this.t("bot.commands.start", lang) },
      { command: "help", description: this.t("bot.commands.help", lang) },
      {
        command: "language",
        description: this.t("bot.commands.language", lang),
      },
    ];

    const privateScope = { type: "all_private_chats" as const };

    try {
      await this.bot.api.setMyCommands(getCommands("en"), {
        scope: privateScope,
      });

      await this.bot.api.setMyCommands(getCommands("en"), {
        scope: privateScope,
        language_code: "en",
      });

      await this.bot.api.setMyCommands(getCommands("ru"), {
        scope: privateScope,
        language_code: "ru",
      });

      this.logger.log("Bot commands configured for en, ru, and default");
    } catch (error) {
      this.logger.error("Failed to set bot commands:", error);
    }
  }

  private async startPolling(): Promise<void> {
    if (this.isRunning) return;

    try {
      await this.bot.api.deleteWebhook();

      void this.bot.start({
        onStart: () => {
          this.isRunning = true;
          this.logger.log("Bot polling started");
        },
      });
    } catch (error) {
      this.logger.error("Failed to start polling:", error);
    }
  }

  private async stopPolling(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.bot.stop();
      this.isRunning = false;
      this.logger.log("Bot polling stopped");
    } catch (error) {
      this.logger.error("Failed to stop polling:", error);
    }
  }
}
