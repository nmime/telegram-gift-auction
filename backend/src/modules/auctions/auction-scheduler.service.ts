import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuctionsService } from './auctions.service';

@Injectable()
export class AuctionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AuctionSchedulerService.name);

  constructor(private readonly auctionsService: AuctionsService) {}

  async onModuleInit() {
    await this.checkExpiredRounds();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async checkExpiredRounds() {
    try {
      const activeAuctions = await this.auctionsService.getActiveAuctions();

      for (const auction of activeAuctions) {
        const currentRound = auction.rounds[auction.currentRound - 1];
        if (currentRound && !currentRound.completed && currentRound.endTime) {
          const now = new Date();
          if (now >= currentRound.endTime) {
            try {
              await this.auctionsService.completeRound(auction._id.toString());
              this.logger.log('Round completed', { roundNumber: currentRound.roundNumber, auctionId: auction._id });
            } catch (error) {
              this.logger.error('Error completing round', error, { auctionId: auction._id });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error in checkExpiredRounds', error);
    }
  }
}
