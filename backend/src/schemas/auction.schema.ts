import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type AuctionDocument = Auction & Document;

export enum AuctionStatus {
  PENDING = "pending",
  ACTIVE = "active",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export class RoundConfig {
  @Prop({ required: true })
  itemsCount!: number;

  @Prop({ required: true })
  durationMinutes!: number;
}

export class RoundState {
  @Prop({ required: true })
  roundNumber!: number;

  @Prop({ required: true })
  itemsCount!: number;

  @Prop()
  startTime?: Date;

  @Prop()
  endTime?: Date;

  @Prop()
  actualEndTime?: Date;

  @Prop({ default: 0 })
  extensionsCount!: number;

  @Prop({ default: false })
  completed!: boolean;

  @Prop({ type: [Types.ObjectId], default: [] })
  winnerBidIds!: Types.ObjectId[];
}

@Schema({ timestamps: true })
export class Auction {
  _id!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  totalItems!: number;

  @Prop({ required: true, type: [Object] })
  roundsConfig!: RoundConfig[];

  @Prop({ type: [Object], default: [] })
  rounds!: RoundState[];

  @Prop({ required: true, enum: AuctionStatus, default: AuctionStatus.PENDING })
  status!: AuctionStatus;

  @Prop({ default: 0 })
  currentRound!: number;

  @Prop({ default: 100 })
  minBidAmount!: number;

  @Prop({ default: 10 })
  minBidIncrement!: number;

  @Prop({ default: 5 })
  antiSnipingWindowMinutes!: number;

  @Prop({ default: 5 })
  antiSnipingExtensionMinutes!: number;

  @Prop({ default: 6 })
  maxExtensions!: number;

  @Prop()
  startTime?: Date;

  @Prop()
  endTime?: Date;

  @Prop({ default: true })
  botsEnabled!: boolean;

  @Prop({ default: 5 })
  botCount!: number;

  @Prop({ type: Types.ObjectId, ref: "User" })
  createdBy!: Types.ObjectId;

  @Prop({ default: 0 })
  version!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AuctionSchema = SchemaFactory.createForClass(Auction);

AuctionSchema.index({ status: 1 });
AuctionSchema.index({ createdBy: 1 });
