import { Injectable, Logger, OnModuleInit, Inject } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { I18nService } from "nestjs-i18n";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { TelegramBotService } from "@/modules/telegram";
import { User, UserDocument } from "@/schemas";
import { redisClient } from "@/modules/redis/constants";

export interface RoundWinNotificationData {
  auctionId: string;
  auctionTitle: string;
  roundNumber: number;
  winningBid: number;
  itemNumber: number;
}

export interface OutbidNotificationData {
  auctionId: string;
  auctionTitle: string;
  yourBid: number;
  newLeaderBid: number;
  roundNumber: number;
  minBidToWin: number;
}

export interface AuctionCompleteNotificationData {
  auctionId: string;
  auctionTitle: string;
  totalWins: number;
  totalSpent: number;
}

interface TelegramNotificationJob {
  telegramId: number;
  message: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private notificationQueue!: Queue<TelegramNotificationJob>;
  private worker!: Worker<TelegramNotificationJob>;

  // Telegram rate limit: ~30 messages/second to different users
  private static readonly RATE_LIMIT = 25;
  private static readonly QUEUE_NAME = "telegram-notifications";

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @Inject(redisClient) private readonly redis: Redis,
    private readonly telegramBotService: TelegramBotService,
    private readonly i18n: I18nService,
  ) {}

  async onModuleInit() {
    const queueConnection = this.redis.duplicate({
      maxRetriesPerRequest: null,
    });
    const workerConnection = this.redis.duplicate({
      maxRetriesPerRequest: null,
    });

    this.notificationQueue = new Queue<TelegramNotificationJob>(
      NotificationsService.QUEUE_NAME,
      {
        connection: queueConnection,
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: 100,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
        },
      },
    );

    // Create worker with rate limiting (25 jobs per second, 10 concurrent)
    this.worker = new Worker<TelegramNotificationJob>(
      NotificationsService.QUEUE_NAME,
      async (job) => {
        await this.processNotification(job.data);
      },
      {
        connection: workerConnection,
        concurrency: 10,
        limiter: {
          max: NotificationsService.RATE_LIMIT,
          duration: 1000,
        },
      },
    );

    this.worker.on("failed", (job, err) => {
      this.logger.warn(`Notification job ${job?.id} failed:`, err.message);
    });

    this.worker.on("error", (err) => {
      this.logger.error("Notification worker error:", err);
    });

    this.logger.log(
      `Notification queue initialized (${NotificationsService.RATE_LIMIT}/sec rate limit, Redis-backed)`,
    );
  }

  private async processNotification(
    data: TelegramNotificationJob,
  ): Promise<void> {
    try {
      const bot = this.telegramBotService.getBot();
      await bot.api.sendMessage(data.telegramId, data.message, {
        parse_mode: "HTML",
      });
      this.logger.debug(
        `Sent notification to Telegram user ${data.telegramId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send Telegram notification to ${data.telegramId}:`,
        error,
      );
      throw error; // Re-throw to trigger retry
    }
  }

  private getLang(user: UserDocument): string {
    return user.languageCode || "en";
  }

  private t(key: string, lang: string, args?: Record<string, unknown>): string {
    return this.i18n.t(key, { lang, args });
  }

  async notifyOutbid(
    userId: string,
    data: OutbidNotificationData,
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t("notifications.outbid.title", lang);
    const message = this.t("notifications.outbid.message", lang, {
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
      yourBid: data.yourBid,
      newLeaderBid: data.newLeaderBid,
      minBidToWin: data.minBidToWin,
    });

    await this.queueTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  async notifyRoundWin(
    userId: string,
    data: RoundWinNotificationData,
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t("notifications.roundWin.title", lang, {
      itemNumber: data.itemNumber,
    });
    const message = this.t("notifications.roundWin.message", lang, {
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
      winningBid: data.winningBid,
    });

    await this.queueTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  async notifyRoundLost(
    userId: string,
    data: {
      auctionId: string;
      auctionTitle: string;
      roundNumber: number;
      yourBid: number;
      refunded: boolean;
    },
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t("notifications.roundLost.title", lang, {
      roundNumber: data.roundNumber,
    });
    const message = this.t("notifications.roundLost.message", lang, {
      auctionTitle: data.auctionTitle,
    });

    let fullMessage = `${title}\n\n${message}`;

    if (data.refunded) {
      const refundText = this.t("notifications.roundLost.refunded", lang, {
        amount: data.yourBid,
      });
      fullMessage += `\n${refundText}`;
    }

    await this.queueTelegramMessage(user.telegramId, fullMessage);
  }

  async notifyAuctionComplete(
    userId: string,
    data: AuctionCompleteNotificationData,
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t("notifications.auctionComplete.title", lang);

    let message: string;
    if (data.totalWins > 0) {
      message = this.t("notifications.auctionComplete.won", lang, {
        auctionTitle: data.auctionTitle,
        totalWins: data.totalWins,
        totalSpent: data.totalSpent,
      });
    } else {
      message = this.t("notifications.auctionComplete.lost", lang, {
        auctionTitle: data.auctionTitle,
      });
    }

    await this.queueTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  async notifyNewRoundStarted(
    userId: string,
    data: {
      auctionId: string;
      auctionTitle: string;
      roundNumber: number;
      itemsCount: number;
      endTime: Date;
    },
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t("notifications.newRound.title", lang);
    const message = this.t("notifications.newRound.message", lang, {
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
      itemsCount: data.itemsCount,
    });

    await this.queueTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  async notifyAntiSniping(
    userId: string,
    data: {
      auctionId: string;
      auctionTitle: string;
      roundNumber: number;
      newEndTime: Date;
      extensionMinutes: number;
    },
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t("notifications.antiSniping.title", lang);
    const message = this.t("notifications.antiSniping.message", lang, {
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
      extensionMinutes: data.extensionMinutes,
    });

    await this.queueTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  private async queueTelegramMessage(
    telegramId: number,
    message: string,
  ): Promise<void> {
    await this.notificationQueue.add(
      "send",
      { telegramId, message },
      { priority: 1 },
    );
  }
}
