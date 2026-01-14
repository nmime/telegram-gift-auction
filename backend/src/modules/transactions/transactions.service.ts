import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Transaction, TransactionDocument } from "@/schemas";

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
  ) {}

  async getByUser(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<TransactionDocument[]> {
    return this.transactionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .exec();
  }

  async getByAuction(auctionId: string): Promise<TransactionDocument[]> {
    return this.transactionModel
      .find({ auctionId: new Types.ObjectId(auctionId) })
      .sort({ createdAt: -1 })
      .exec();
  }
}
