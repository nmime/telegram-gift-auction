import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { BidsController } from "./bids.controller";
import { BidsService } from "./bids.service";
import { Bid, BidSchema } from "@/schemas";
import { AuctionsModule } from "@/modules/auctions";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Bid.name, schema: BidSchema }]),
    forwardRef(() => AuctionsModule),
  ],
  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
