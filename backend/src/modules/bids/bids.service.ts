import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bid, BidDocument, BidStatus } from '@/schemas';

@Injectable()
export class BidsService {
  constructor(
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
  ) {}

  async getByAuction(auctionId: string): Promise<BidDocument[]> {
    return this.bidModel
      .find({ auctionId: new Types.ObjectId(auctionId) })
      .sort({ amount: -1, createdAt: 1 })
      .populate('userId', 'username isBot')
      .exec();
  }

  async getActiveByAuction(auctionId: string): Promise<BidDocument[]> {
    return this.bidModel
      .find({
        auctionId: new Types.ObjectId(auctionId),
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1, createdAt: 1 })
      .populate('userId', 'username isBot')
      .exec();
  }

  async getByUser(userId: string): Promise<BidDocument[]> {
    return this.bidModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .populate('auctionId', 'title status')
      .exec();
  }

  async countByAuction(auctionId: string): Promise<number> {
    return this.bidModel.countDocuments({
      auctionId: new Types.ObjectId(auctionId),
      status: BidStatus.ACTIVE,
    });
  }
}
