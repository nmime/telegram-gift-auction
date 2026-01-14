import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type BidDocument = HydratedDocument<Bid>;

export enum BidStatus {
  ACTIVE = "active",
  WON = "won",
  LOST = "lost",
  REFUNDED = "refunded",
  CANCELLED = "cancelled",
}

@Schema({ timestamps: true, optimisticConcurrency: true })
export class Bid {
  _id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "Auction", required: true })
  auctionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "User", required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true, enum: BidStatus, default: BidStatus.ACTIVE })
  status!: BidStatus;

  @Prop()
  wonRound?: number;

  @Prop()
  itemNumber?: number;

  @Prop()
  lastProcessedAt?: Date;

  @Prop()
  outbidNotifiedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const BidSchema = SchemaFactory.createForClass(Bid);

BidSchema.index({ auctionId: 1, status: 1 });
BidSchema.index({ auctionId: 1, amount: -1, createdAt: 1 });
BidSchema.index({ userId: 1, status: 1 });
BidSchema.index({ auctionId: 1, userId: 1, status: 1 });
BidSchema.index({ status: 1, createdAt: -1 });
BidSchema.index({ wonRound: 1, itemNumber: 1 });

BidSchema.index(
  { auctionId: 1, amount: 1 },
  {
    unique: true,
    partialFilterExpression: { status: BidStatus.ACTIVE },
  },
);

BidSchema.index(
  { auctionId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: BidStatus.ACTIVE },
  },
);
