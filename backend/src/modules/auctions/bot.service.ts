import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
} from "@nestjs/common";
import Redis from "ioredis";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { randomInt } from "crypto";
import {
  User,
  UserDocument,
  Auction,
  AuctionDocument,
  AuctionStatus,
  Bid,
  BidDocument,
  BidStatus,
} from "@/schemas";
import { AuctionsService } from "./auctions.service";
import { isPrimaryWorker, getWorkerId } from "@/common";
import { redisClient } from "@/modules/redis";

interface BotState {
  auctionId: string;
  botIds: string[];
  intervalId: NodeJS.Timeout | null;
  active: boolean;
}

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private activeBots = new Map<string, BotState>();
  private readonly BOT_START_CHANNEL = "bot-service:start";
  private readonly BOT_STOP_CHANNEL = "bot-service:stop";
  private subscriber: Redis | null = null;

  constructor(
    @Inject(redisClient) private readonly redis: Redis,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    private auctionsService: AuctionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!isPrimaryWorker()) {
      const workerId = getWorkerId();
      this.logger.log(
        `Worker ${String(workerId)}: Skipping bot restore (handled by primary worker)`,
      );
      return;
    }

    await this.setupPubSubSubscription();
    await this.restoreBotsForActiveAuctions();
  }

  onModuleDestroy(): void {
    this.stopAllBots();

    if (this.subscriber !== null) {
      this.subscriber
        .unsubscribe(this.BOT_START_CHANNEL, this.BOT_STOP_CHANNEL)
        .then(async () => await this.subscriber?.quit())
        .catch(() => {
          // Intentionally ignore errors during cleanup
        })
        .finally(() => {
          this.subscriber = null;
        });
    }
  }

  async startBots(auctionId: string, botCount: number): Promise<void> {
    if (!isPrimaryWorker()) {
      this.logger.debug(
        `Worker ${String(getWorkerId())}: Delegating bot start to primary worker via pub/sub`,
      );
      await this.redis.publish(
        this.BOT_START_CHANNEL,
        JSON.stringify({ auctionId, botCount }),
      );
      return;
    }

    await this.startBotsInternal(auctionId, botCount);
  }

  stopBots(auctionId: string): void {
    if (!isPrimaryWorker()) {
      this.logger.debug(
        `Worker ${String(getWorkerId())}: Delegating bot stop to primary worker via pub/sub`,
      );
      this.redis
        .publish(this.BOT_STOP_CHANNEL, JSON.stringify({ auctionId }))
        .catch((error: unknown) => {
          this.logger.error("Failed to publish bot stop message", error);
        });
      return;
    }

    const state = this.activeBots.get(auctionId);
    if (state !== undefined) {
      state.active = false;
      if (state.intervalId !== null) {
        clearInterval(state.intervalId);
      }
      this.activeBots.delete(auctionId);
      this.logger.log("Bots stopped for auction", auctionId);
    }
  }

  stopAllBots(): void {
    for (const auctionId of this.activeBots.keys()) {
      this.stopBots(auctionId);
    }
  }

  private async setupPubSubSubscription(): Promise<void> {
    try {
      this.subscriber = this.redis.duplicate();

      this.subscriber.on("message", (channel: string, message: string) => {
        void this.handlePubSubMessage(channel, message);
      });

      await this.subscriber.subscribe(
        this.BOT_START_CHANNEL,
        this.BOT_STOP_CHANNEL,
      );

      this.logger.log("Primary worker subscribed to bot pub/sub channels");
    } catch (error: unknown) {
      this.logger.error("Failed to setup pub/sub subscription", error);
    }
  }

  private async handlePubSubMessage(
    channel: string,
    message: string,
  ): Promise<void> {
    try {
      const data = JSON.parse(message) as {
        auctionId: string;
        botCount?: number;
      };

      if (channel === this.BOT_START_CHANNEL) {
        const { auctionId, botCount } = data;
        if (botCount !== undefined) {
          this.logger.debug("Received bot start message via pub/sub", {
            auctionId,
            botCount,
          });
          await this.startBotsInternal(auctionId, botCount);
        }
      } else if (channel === this.BOT_STOP_CHANNEL) {
        const { auctionId } = data;
        this.logger.debug("Received bot stop message via pub/sub", {
          auctionId,
        });
        this.stopBots(auctionId);
      }
    } catch (error: unknown) {
      this.logger.error("Failed to handle pub/sub message", {
        channel,
        message,
        error,
      });
    }
  }

  private async startBotsInternal(
    auctionId: string,
    botCount: number,
  ): Promise<void> {
    if (this.activeBots.has(auctionId)) {
      return;
    }

    const botIds: string[] = [];
    for (let i = 0; i < botCount; i++) {
      const botName = `bot_${auctionId.slice(-6)}_${String(i + 1)}`;
      let bot = await this.userModel.findOne({ username: botName });

      if (bot === null) {
        bot = await this.userModel.create({
          username: botName,
          balance: 100000,
          isBot: true,
        });
      } else if (bot.balance < 50000) {
        bot.balance = 100000;
        await bot.save();
      }

      botIds.push(bot._id.toString());
    }

    const state: BotState = {
      auctionId,
      botIds,
      intervalId: null,
      active: true,
    };

    state.intervalId = setInterval(() => {
      void this.botActivity(state);
    }, 1000);
    this.activeBots.set(auctionId, state);
    this.logger.log("Bots started for auction", { auctionId, botCount });

    setTimeout(() => {
      void this.makeInitialBids(state);
    }, 1000);
  }

  private async restoreBotsForActiveAuctions(): Promise<void> {
    try {
      const activeAuctions = await this.auctionModel.find({
        status: AuctionStatus.ACTIVE,
        botsEnabled: true,
      });

      if (activeAuctions.length === 0) {
        this.logger.log("No active auctions with bots to restore");
        return;
      }

      this.logger.log(
        "Restoring bots for active auctions",
        activeAuctions.length,
      );

      for (const auction of activeAuctions) {
        await this.startBots(auction._id.toString(), auction.botCount);
      }
    } catch (error: unknown) {
      this.logger.error("Failed to restore bots", error);
    }
  }

  private async makeInitialBids(state: BotState): Promise<void> {
    const auction = await this.auctionModel.findById(state.auctionId);
    if (auction?.status !== AuctionStatus.ACTIVE) {
      return;
    }

    const existingBids = await this.bidModel.find({
      auctionId: new Types.ObjectId(state.auctionId),
      userId: { $in: state.botIds.map((id) => new Types.ObjectId(id)) },
      status: BidStatus.ACTIVE,
    });

    const botsWithBids = new Set(existingBids.map((b) => b.userId.toString()));

    for (let i = 0; i < state.botIds.length; i++) {
      const botId = state.botIds[i];
      if (botId === undefined || botId === "") continue;

      if (botsWithBids.has(botId)) {
        continue;
      }

      const delay = randomInt(2000) + i * 500;
      const capturedBotId = botId;

      setTimeout(() => {
        void (async (): Promise<void> => {
          try {
            const amount = auction.minBidAmount + randomInt(500);
            await this.auctionsService.placeBid(
              state.auctionId,
              capturedBotId,
              { amount },
            );
            this.logger.debug("Bot placed initial bid", {
              botId: capturedBotId.slice(-6),
              amount,
            });
          } catch (error: unknown) {
            this.logger.debug("Bot initial bid failed", {
              botId: capturedBotId.slice(-6),
              error,
            });
          }
        })();
      }, delay);
    }
  }

  private async botActivity(state: BotState): Promise<void> {
    if (!state.active) {
      return;
    }

    try {
      const auction = await this.auctionModel.findById(state.auctionId);
      if (auction?.status !== AuctionStatus.ACTIVE) {
        this.stopBots(state.auctionId);
        return;
      }

      const currentRound = auction.rounds[auction.currentRound - 1];
      if (currentRound === undefined || currentRound.completed) {
        return;
      }

      const roundEndTime = currentRound.endTime;
      const roundStartTime = currentRound.startTime;
      if (roundEndTime === undefined || roundStartTime === undefined) {
        return;
      }

      const now = new Date();
      const timeRemaining = roundEndTime.getTime() - now.getTime();
      const totalDuration = roundEndTime.getTime() - roundStartTime.getTime();
      const timeRatio = 1 - timeRemaining / totalDuration;

      let bidProbability = 0.3 + timeRatio * 0.4;
      const antiSnipingWindow = auction.antiSnipingWindowMinutes * 60 * 1000;
      if (timeRemaining <= antiSnipingWindow) {
        bidProbability = 0.8;
      }

      if (randomInt(100) > bidProbability * 100) {
        return;
      }

      const botId = state.botIds[randomInt(state.botIds.length)];
      if (botId === undefined || botId === "") {
        return;
      }

      const minWinningBid = await this.auctionsService.getMinWinningBid(
        state.auctionId,
      );
      if (minWinningBid === null || minWinningBid === 0) {
        return;
      }

      const existingBid = await this.bidModel.findOne({
        auctionId: new Types.ObjectId(state.auctionId),
        userId: new Types.ObjectId(botId),
        status: BidStatus.ACTIVE,
      });

      let newAmount: number;
      if (existingBid !== null) {
        const { leaderboard } = await this.auctionsService.getLeaderboard(
          state.auctionId,
        );
        const botPosition = leaderboard.findIndex((l) =>
          l.username.includes(botId.slice(-6)),
        );
        const isWinning =
          botPosition >= 0 && botPosition < currentRound.itemsCount;

        if (isWinning && randomInt(100) > 50) {
          return;
        }

        const increment = auction.minBidIncrement + randomInt(100);
        newAmount = Math.max(
          existingBid.amount + increment,
          minWinningBid + randomInt(50),
        );
      } else {
        newAmount = minWinningBid + randomInt(100);
      }

      await this.auctionsService.placeBid(state.auctionId, botId, {
        amount: newAmount,
      });
      this.logger.debug("Bot placed bid", {
        botId: botId.slice(-6),
        amount: newAmount,
      });
    } catch (error: unknown) {
      this.logger.debug("Bot activity error", error);
    }
  }
}
