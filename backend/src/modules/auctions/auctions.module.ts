import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { AuctionSchedulerService } from './auction-scheduler.service';
import { BotService } from './bot.service';
import { Auction, AuctionSchema, Bid, BidSchema, User, UserSchema, Transaction, TransactionSchema } from '@/schemas';
import { BidsModule } from '@/modules/bids';
import { UsersModule } from '@/modules/users';
import { EventsModule } from '@/modules/events';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Auction.name, schema: AuctionSchema },
      { name: Bid.name, schema: BidSchema },
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    forwardRef(() => BidsModule),
    UsersModule,
    EventsModule,
  ],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionSchedulerService, BotService],
  exports: [AuctionsService, BotService],
})
export class AuctionsModule {}
