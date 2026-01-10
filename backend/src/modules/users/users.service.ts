import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types, ClientSession } from 'mongoose';
import { User, UserDocument, Transaction, TransactionDocument, TransactionType } from '@/schemas';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Transaction.name) private transactionModel: Model<TransactionDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  async getBalance(userId: string): Promise<{ balance: number; frozenBalance: number }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      balance: user.balance,
      frozenBalance: user.frozenBalance,
    };
  }

  async deposit(userId: string, amount: number): Promise<UserDocument> {
    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('Amount must be a positive integer');
    }

    const session = await this.connection.startSession();
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });

    try {
      const user = await this.userModel.findById(userId).session(session);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const balanceBefore = user.balance;

      const updatedUser = await this.userModel.findOneAndUpdate(
        { _id: userId, version: user.version },
        {
          $inc: { balance: amount, version: 1 },
        },
        { new: true, session }
      );

      if (!updatedUser) {
        throw new ConflictException('Concurrent modification detected');
      }

      await this.transactionModel.create([{
        userId: updatedUser._id,
        type: TransactionType.DEPOSIT,
        amount,
        balanceBefore,
        balanceAfter: updatedUser.balance,
        description: `Deposit of ${amount} stars`,
      }], { session });

      await session.commitTransaction();
      return updatedUser;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async withdraw(userId: string, amount: number): Promise<UserDocument> {
    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('Amount must be a positive integer');
    }

    const session = await this.connection.startSession();
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });

    try {
      const user = await this.userModel.findById(userId).session(session);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.balance < amount) {
        throw new BadRequestException('Insufficient balance');
      }

      const balanceBefore = user.balance;

      const updatedUser = await this.userModel.findOneAndUpdate(
        {
          _id: userId,
          version: user.version,
          balance: { $gte: amount },
        },
        {
          $inc: { balance: -amount, version: 1 },
        },
        { new: true, session }
      );

      if (!updatedUser) {
        throw new ConflictException('Concurrent modification or insufficient balance');
      }

      await this.transactionModel.create([{
        userId: updatedUser._id,
        type: TransactionType.WITHDRAW,
        amount,
        balanceBefore,
        balanceAfter: updatedUser.balance,
        description: `Withdrawal of ${amount} stars`,
      }], { session });

      await session.commitTransaction();
      return updatedUser;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async recordTransaction(
    userId: string,
    type: string,
    amount: number,
    balanceBefore: number,
    balanceAfter: number,
    frozenBefore: number,
    frozenAfter: number,
    auctionId: Types.ObjectId,
    bidId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const transactionType = this.mapTransactionType(type);

    await this.transactionModel.create([{
      userId: new Types.ObjectId(userId),
      type: transactionType,
      amount,
      balanceBefore,
      balanceAfter,
      frozenBefore,
      frozenAfter,
      auctionId,
      bidId,
      description: this.getTransactionDescription(type, amount),
    }], { session });
  }

  private mapTransactionType(type: string): TransactionType {
    switch (type) {
      case 'bid_freeze':
        return TransactionType.BID_FREEZE;
      case 'bid_unfreeze':
        return TransactionType.BID_UNFREEZE;
      case 'bid_win':
        return TransactionType.BID_WIN;
      case 'bid_refund':
        return TransactionType.BID_REFUND;
      default:
        return TransactionType.DEPOSIT;
    }
  }

  private getTransactionDescription(type: string, amount: number): string {
    switch (type) {
      case 'bid_freeze':
        return `Bid placed: ${amount} stars frozen`;
      case 'bid_unfreeze':
        return `Bid cancelled: ${amount} stars unfrozen`;
      case 'bid_win':
        return `Won auction item for ${amount} stars`;
      case 'bid_refund':
        return `Bid refunded: ${amount} stars returned`;
      default:
        return `Transaction of ${amount} stars`;
    }
  }

  async freezeBalance(
    userId: string | Types.ObjectId,
    amount: number,
    auctionId: Types.ObjectId,
    bidId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const user = await this.userModel.findById(userId).session(session || null);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.balance < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    const balanceBefore = user.balance;
    const frozenBefore = user.frozenBalance;

    const updatedUser = await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        version: user.version,
        balance: { $gte: amount },
      },
      {
        $inc: {
          balance: -amount,
          frozenBalance: amount,
          version: 1,
        },
      },
      { new: true, session: session || undefined }
    );

    if (!updatedUser) {
      throw new ConflictException('Failed to freeze balance');
    }

    await this.transactionModel.create([{
      userId: updatedUser._id,
      type: TransactionType.BID_FREEZE,
      amount,
      balanceBefore,
      balanceAfter: updatedUser.balance,
      frozenBefore,
      frozenAfter: updatedUser.frozenBalance,
      auctionId,
      bidId,
      description: `Bid freeze of ${amount} stars`,
    }], { session: session || undefined });
  }

  async unfreezeBalance(
    userId: string | Types.ObjectId,
    amount: number,
    auctionId: Types.ObjectId,
    bidId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const user = await this.userModel.findById(userId).session(session || null);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const balanceBefore = user.balance;
    const frozenBefore = user.frozenBalance;

    const updatedUser = await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        version: user.version,
        frozenBalance: { $gte: amount },
      },
      {
        $inc: {
          frozenBalance: -amount,
          balance: amount,
          version: 1,
        },
      },
      { new: true, session: session || undefined }
    );

    if (!updatedUser) {
      throw new ConflictException('Failed to unfreeze balance');
    }

    await this.transactionModel.create([{
      userId: updatedUser._id,
      type: TransactionType.BID_UNFREEZE,
      amount,
      balanceBefore,
      balanceAfter: updatedUser.balance,
      frozenBefore,
      frozenAfter: updatedUser.frozenBalance,
      auctionId,
      bidId,
      description: `Bid unfreeze of ${amount} stars`,
    }], { session: session || undefined });
  }

  async confirmBidWin(
    userId: string | Types.ObjectId,
    amount: number,
    auctionId: Types.ObjectId,
    bidId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const user = await this.userModel.findById(userId).session(session || null);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const frozenBefore = user.frozenBalance;

    const updatedUser = await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        version: user.version,
        frozenBalance: { $gte: amount },
      },
      {
        $inc: {
          frozenBalance: -amount,
          version: 1,
        },
      },
      { new: true, session: session || undefined }
    );

    if (!updatedUser) {
      throw new ConflictException('Failed to confirm bid win');
    }

    await this.transactionModel.create([{
      userId: updatedUser._id,
      type: TransactionType.BID_WIN,
      amount,
      balanceBefore: user.balance,
      balanceAfter: updatedUser.balance,
      frozenBefore,
      frozenAfter: updatedUser.frozenBalance,
      auctionId,
      bidId,
      description: `Won auction item for ${amount} stars`,
    }], { session: session || undefined });
  }

  async refundBid(
    userId: string | Types.ObjectId,
    amount: number,
    auctionId: Types.ObjectId,
    bidId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const user = await this.userModel.findById(userId).session(session || null);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const balanceBefore = user.balance;
    const frozenBefore = user.frozenBalance;

    const updatedUser = await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        version: user.version,
        frozenBalance: { $gte: amount },
      },
      {
        $inc: {
          frozenBalance: -amount,
          balance: amount,
          version: 1,
        },
      },
      { new: true, session: session || undefined }
    );

    if (!updatedUser) {
      throw new ConflictException('Failed to refund bid');
    }

    await this.transactionModel.create([{
      userId: updatedUser._id,
      type: TransactionType.BID_REFUND,
      amount,
      balanceBefore,
      balanceAfter: updatedUser.balance,
      frozenBefore,
      frozenAfter: updatedUser.frozenBalance,
      auctionId,
      bidId,
      description: `Refund of ${amount} stars`,
    }], { session: session || undefined });
  }

  async createBot(name: string, balance: number): Promise<UserDocument> {
    return this.userModel.create({
      username: name,
      balance,
      frozenBalance: 0,
      isBot: true,
      version: 0,
    });
  }

  async findById(userId: string | Types.ObjectId): Promise<UserDocument | null> {
    return this.userModel.findById(userId);
  }

  async findByIdForUpdate(userId: string | Types.ObjectId, session: ClientSession): Promise<UserDocument | null> {
    return this.userModel.findById(userId).session(session);
  }
}
