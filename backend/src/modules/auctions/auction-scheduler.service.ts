import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AuctionsService } from "./auctions.service";
import { isPrimaryWorker, getWorkerId } from "@/common";

@Injectable()
export class AuctionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AuctionSchedulerService.name);

  constructor(private readonly auctionsService: AuctionsService) {}

  async onModuleInit(): Promise<void> {
    if (!isPrimaryWorker()) {
      const workerId = getWorkerId();
      this.logger.log(
        `Worker ${String(workerId)}: Skipping scheduler init (handled by primary worker)`,
      );
      return;
    }
    await this.checkExpiredRounds();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async checkExpiredRounds(): Promise<void> {
    if (!isPrimaryWorker()) {
      return;
    }

    try {
      const activeAuctions = await this.auctionsService.getActiveAuctions();

      for (const auction of activeAuctions) {
        const currentRound = auction.rounds[auction.currentRound - 1];
        if (
          currentRound !== undefined &&
          !currentRound.completed &&
          currentRound.endTime !== undefined
        ) {
          const now = new Date();
          if (now >= currentRound.endTime) {
            try {
              await this.auctionsService.completeRound(auction._id.toString());
              this.logger.log("Round completed", {
                roundNumber: currentRound.roundNumber,
                auctionId: String(auction._id),
              });
            } catch (error: unknown) {
              this.logger.error("Error completing round", error, {
                auctionId: String(auction._id),
              });
            }
          }
        }
      }
    } catch (error: unknown) {
      this.logger.error("Error in checkExpiredRounds", error);
    }
  }
}
