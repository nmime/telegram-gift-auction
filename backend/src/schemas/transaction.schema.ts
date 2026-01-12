import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TransactionDocument = Transaction & Document;

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  BID_FREEZE = 'bid_freeze',
  BID_UNFREEZE = 'bid_unfreeze',
  BID_WIN = 'bid_win',
  BID_REFUND = 'bid_refund',
}

@Schema({ timestamps: true })
export class Transaction {
  _id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: TransactionType })
  type!: TransactionType;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  balanceBefore!: number;

  @Prop({ required: true })
  balanceAfter!: number;

  @Prop()
  frozenBefore?: number;

  @Prop()
  frozenAfter?: number;

  @Prop({ type: Types.ObjectId, ref: 'Auction' })
  auctionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Bid' })
  bidId?: Types.ObjectId;

  @Prop()
  description?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ auctionId: 1 });
