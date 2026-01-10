import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import { randomInt } from 'crypto';
import { User, UserDocument, Auction, AuctionDocument, AuctionStatus, Bid, BidDocument, BidStatus } from '@/schemas';
import { AuctionsService } from './auctions.service';

interface BotState {
  auctionId: string;
  botIds: string[];
  intervalId: NodeJS.Timeout | null;
  active: boolean;
}

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private activeBots: Map<string, BotState> = new Map();

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectConnection() private connection: Connection,
    private auctionsService: AuctionsService,
  ) {}

  async onModuleInit() {
    await this.restoreBotsForActiveAuctions();
  }

  onModuleDestroy() {
    this.stopAllBots();
  }

  private async restoreBotsForActiveAuctions(): Promise<void> {
    try {
      const activeAuctions = await this.auctionModel.find({
        status: AuctionStatus.ACTIVE,
        botsEnabled: true,
      });

      if (activeAuctions.length === 0) {
        this.logger.log('No active auctions with bots to restore');
        return;
      }

      this.logger.log('Restoring bots for active auctions', activeAuctions.length);

      for (const auction of activeAuctions) {
        await this.startBots(auction._id.toString(), auction.botCount);
      }
    } catch (error) {
      this.logger.error('Failed to restore bots', error);
    }
  }

  async startBots(auctionId: string, botCount: number): Promise<void> {
    if (this.activeBots.has(auctionId)) {
      return;
    }

    const botIds: string[] = [];
    for (let i = 0; i < botCount; i++) {
      const botName = `bot_${auctionId.slice(-6)}_${i + 1}`;
      let bot = await this.userModel.findOne({ username: botName });

      if (!bot) {
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

    state.intervalId = setInterval(() => this.botActivity(state), 1000);
    this.activeBots.set(auctionId, state);
    this.logger.log('Bots started for auction', { auctionId, botCount });

    setTimeout(() => this.makeInitialBids(state), 1000);
  }

  private async makeInitialBids(state: BotState): Promise<void> {
    const auction = await this.auctionModel.findById(state.auctionId);
    if (!auction || auction.status !== AuctionStatus.ACTIVE) {
      return;
    }

    const existingBids = await this.bidModel.find({
      auctionId: new Types.ObjectId(state.auctionId),
      userId: { $in: state.botIds.map(id => new Types.ObjectId(id)) },
      status: BidStatus.ACTIVE,
    });

    const botsWithBids = new Set(existingBids.map(b => b.userId.toString()));

    for (let i = 0; i < state.botIds.length; i++) {
      const botId = state.botIds[i];

      if (botsWithBids.has(botId)) {
        continue;
      }

      const delay = randomInt(2000) + i * 500;

      setTimeout(async () => {
        try {
          const amount = auction.minBidAmount + randomInt(500);
          await this.auctionsService.placeBid(state.auctionId, botId, { amount });
          this.logger.debug('Bot placed initial bid', { botId: botId.slice(-6), amount });
        } catch (error) {
          this.logger.debug('Bot initial bid failed', { botId: botId.slice(-6), error });
        }
      }, delay);
    }
  }

  private async botActivity(state: BotState): Promise<void> {
    if (!state.active) {
      return;
    }

    try {
      const auction = await this.auctionModel.findById(state.auctionId);
      if (!auction || auction.status !== AuctionStatus.ACTIVE) {
        this.stopBots(state.auctionId);
        return;
      }

      const currentRound = auction.rounds[auction.currentRound - 1];
      if (!currentRound || currentRound.completed) {
        return;
      }

      const now = new Date();
      const timeRemaining = currentRound.endTime!.getTime() - now.getTime();
      const totalDuration = currentRound.endTime!.getTime() - currentRound.startTime!.getTime();
      const timeRatio = 1 - (timeRemaining / totalDuration);

      let bidProbability = 0.3 + timeRatio * 0.4;
      const antiSnipingWindow = auction.antiSnipingWindowMinutes * 60 * 1000;
      if (timeRemaining <= antiSnipingWindow) {
        bidProbability = 0.8;
      }

      if (randomInt(100) > bidProbability * 100) {
        return;
      }

      const botId = state.botIds[randomInt(state.botIds.length)];

      const minWinningBid = await this.auctionsService.getMinWinningBid(state.auctionId);
      if (!minWinningBid) {
        return;
      }

      const existingBid = await this.bidModel.findOne({
        auctionId: new Types.ObjectId(state.auctionId),
        userId: new Types.ObjectId(botId),
        status: BidStatus.ACTIVE,
      });

      let newAmount: number;
      if (existingBid) {
        const leaderboard = await this.auctionsService.getLeaderboard(state.auctionId);
        const botPosition = leaderboard.findIndex(l => l.username.includes(botId.slice(-6)));
        const isWinning = botPosition >= 0 && botPosition < currentRound.itemsCount;

        if (isWinning && randomInt(100) > 50) {
          return;
        }

        const increment = auction.minBidIncrement + randomInt(100);
        newAmount = Math.max(existingBid.amount + increment, minWinningBid + randomInt(50));
      } else {
        newAmount = minWinningBid + randomInt(100);
      }

      await this.auctionsService.placeBid(state.auctionId, botId, { amount: newAmount });
      this.logger.debug('Bot placed bid', { botId: botId.slice(-6), amount: newAmount });
    } catch (error) {
      this.logger.debug('Bot activity error', error);
    }
  }

  stopBots(auctionId: string): void {
    const state = this.activeBots.get(auctionId);
    if (state) {
      state.active = false;
      if (state.intervalId) {
        clearInterval(state.intervalId);
      }
      this.activeBots.delete(auctionId);
      this.logger.log('Bots stopped for auction', auctionId);
    }
  }

  stopAllBots(): void {
    for (const auctionId of this.activeBots.keys()) {
      this.stopBots(auctionId);
    }
  }
}
