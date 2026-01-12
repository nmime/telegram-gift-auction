import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { I18nService } from 'nestjs-i18n';
import { TelegramBotService } from '@/modules/telegram';
import { User, UserDocument } from '@/schemas';

export interface BidNotificationData {
  auctionId: string;
  auctionTitle: string;
  bidAmount: number;
  newLeaderAmount?: number;
  roundNumber: number;
}

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

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly telegramBotService: TelegramBotService,
    private readonly i18n: I18nService,
  ) {}

  private getLang(user: UserDocument): string {
    return user.languageCode || 'en';
  }

  private t(key: string, lang: string, args?: Record<string, unknown>): string {
    return this.i18n.t(key, { lang, args });
  }

  async notifyBidPlaced(userId: string, data: BidNotificationData): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const message = this.t('notifications.bid.placed', lang, {
      amount: data.bidAmount,
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
    });

    await this.sendTelegramMessage(user.telegramId, message);
  }

  async notifyOutbid(userId: string, data: OutbidNotificationData): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t('notifications.outbid.title', lang);
    const message = this.t('notifications.outbid.message', lang, {
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
      yourBid: data.yourBid,
      newLeaderBid: data.newLeaderBid,
      minBidToWin: data.minBidToWin,
    });

    await this.sendTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  async notifyRoundWin(userId: string, data: RoundWinNotificationData): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t('notifications.roundWin.title', lang, {
      itemNumber: data.itemNumber,
    });
    const message = this.t('notifications.roundWin.message', lang, {
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
      winningBid: data.winningBid,
    });

    await this.sendTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  async notifyRoundLost(userId: string, data: {
    auctionId: string;
    auctionTitle: string;
    roundNumber: number;
    yourBid: number;
    refunded: boolean;
  }): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t('notifications.roundLost.title', lang, {
      roundNumber: data.roundNumber,
    });
    const message = this.t('notifications.roundLost.message', lang, {
      auctionTitle: data.auctionTitle,
    });

    let fullMessage = `${title}\n\n${message}`;

    if (data.refunded) {
      const refundText = this.t('notifications.roundLost.refunded', lang, {
        amount: data.yourBid,
      });
      fullMessage += `\n${refundText}`;
    }

    await this.sendTelegramMessage(user.telegramId, fullMessage);
  }

  async notifyAuctionComplete(userId: string, data: AuctionCompleteNotificationData): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t('notifications.auctionComplete.title', lang);

    let message: string;
    if (data.totalWins > 0) {
      message = this.t('notifications.auctionComplete.won', lang, {
        auctionTitle: data.auctionTitle,
        totalWins: data.totalWins,
        totalSpent: data.totalSpent,
      });
    } else {
      message = this.t('notifications.auctionComplete.lost', lang, {
        auctionTitle: data.auctionTitle,
      });
    }

    await this.sendTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  async notifyNewRoundStarted(userId: string, data: {
    auctionId: string;
    auctionTitle: string;
    roundNumber: number;
    itemsCount: number;
    endTime: Date;
  }): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t('notifications.newRound.title', lang);
    const message = this.t('notifications.newRound.message', lang, {
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
      itemsCount: data.itemsCount,
    });

    await this.sendTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  async notifyAntiSniping(userId: string, data: {
    auctionId: string;
    auctionTitle: string;
    roundNumber: number;
    newEndTime: Date;
    extensionMinutes: number;
  }): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user?.telegramId) return;

    const lang = this.getLang(user);
    const title = this.t('notifications.antiSniping.title', lang);
    const message = this.t('notifications.antiSniping.message', lang, {
      auctionTitle: data.auctionTitle,
      roundNumber: data.roundNumber,
      extensionMinutes: data.extensionMinutes,
    });

    await this.sendTelegramMessage(user.telegramId, `${title}\n\n${message}`);
  }

  private async sendTelegramMessage(telegramId: number, message: string): Promise<void> {
    try {
      const bot = this.telegramBotService.getBot();
      await bot.api.sendMessage(telegramId, message, {
        parse_mode: 'HTML',
      });
      this.logger.debug(`Sent notification to Telegram user ${telegramId}`);
    } catch (error) {
      this.logger.warn(`Failed to send Telegram notification to ${telegramId}:`, error);
    }
  }
}
