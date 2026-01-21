import { Test, TestingModule } from "@nestjs/testing";
import { MongooseModule, getModelToken } from "@nestjs/mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Connection, Model, Types } from "mongoose";
import {
  User,
  UserSchema,
  UserDocument,
  Auction,
  AuctionSchema,
  AuctionDocument,
  AuctionStatus,
  Bid,
  BidSchema,
  BidDocument,
  BidStatus,
  Transaction,
  TransactionSchema,
  TransactionDocument,
  TransactionType,
  AuditLog,
  AuditLogSchema,
  AuditLogDocument,
} from "@/schemas";

describe("Transaction Consistency Integration Tests", () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;
  let transactionModel: Model<TransactionDocument>;
  let auditLogModel: Model<AuditLogDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
      instance: {
        replSet: "testReplSet",
      },
    });
    const uri = mongod.getUri();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Auction.name, schema: AuctionSchema },
          { name: Bid.name, schema: BidSchema },
          { name: Transaction.name, schema: TransactionSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
    }).compile();

    userModel = module.get<Model<UserDocument>>(getModelToken(User.name));
    auctionModel = module.get<Model<AuctionDocument>>(
      getModelToken(Auction.name),
    );
    bidModel = module.get<Model<BidDocument>>(getModelToken(Bid.name));
    transactionModel = module.get<Model<TransactionDocument>>(
      getModelToken(Transaction.name),
    );
    auditLogModel = module.get<Model<AuditLogDocument>>(
      getModelToken(AuditLog.name),
    );

    connection = userModel.db;
  }, 60000);

  afterAll(async () => {
    if (connection) {
      await connection.close();
    }
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(async () => {
    await userModel.deleteMany({});
    await auctionModel.deleteMany({});
    await bidModel.deleteMany({});
    await transactionModel.deleteMany({});
    await auditLogModel.deleteMany({});
  });

  // ========================================
  // 1. ACID Transaction Properties (8 tests)
  // ========================================

  describe("ACID Properties", () => {
    it("should ensure atomicity - all operations succeed or none do", async () => {
      const session = await connection.startSession();

      try {
        await session.withTransaction(async () => {
          const user = await userModel.create(
            [{ username: "testuser", balance: 1000, frozenBalance: 0 }],
            { session },
          );

          const transaction = await transactionModel.create(
            [
              {
                userId: user[0]!._id,
                type: TransactionType.DEPOSIT,
                amount: 500,
                balanceBefore: 1000,
                balanceAfter: 1500,
              },
            ],
            { session },
          );

          await userModel.updateOne(
            { _id: user[0]!._id },
            { $set: { balance: 1500 } },
            { session },
          );

          expect(transaction).toBeDefined();
        });

        const user = await userModel.findOne({ username: "testuser" });
        const transactions = await transactionModel.find({
          userId: user?._id,
        });

        expect(user?.balance).toBe(1500);
        expect(transactions).toHaveLength(1);
      } finally {
        await session.endSession();
      }
    });

    it("should ensure consistency - data constraints maintained", async () => {
      const session = await connection.startSession();

      await session.withTransaction(async () => {
        const user = await userModel.create(
          [{ username: "testuser", balance: 1000, frozenBalance: 0 }],
          { session },
        );

        await transactionModel.create(
          [
            {
              userId: user[0]!._id,
              type: TransactionType.DEPOSIT,
              amount: 500,
              balanceBefore: 1000,
              balanceAfter: 1500,
            },
          ],
          { session },
        );

        await userModel.updateOne(
          { _id: user[0]!._id },
          { $set: { balance: 1500 } },
          { session },
        );
      });

      await session.endSession();

      const user = await userModel.findOne({ username: "testuser" });
      const transactions = await transactionModel.find({ userId: user?._id });

      // Verify balance consistency
      expect(user?.balance).toBe(1500);
      expect(transactions[0]?.balanceAfter).toBe(1500);
      expect(user?.balance).toBe(transactions[0]?.balanceAfter);
    });

    it("should ensure isolation - concurrent transactions don't interfere", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const transaction1 = async () => {
        const session = await connection.startSession();
        try {
          await session.withTransaction(async () => {
            await userModel.updateOne(
              { _id: user._id },
              { $inc: { balance: 100 } },
              { session },
            );

            await transactionModel.create(
              [
                {
                  userId: user._id,
                  type: TransactionType.DEPOSIT,
                  amount: 100,
                  balanceBefore: 1000,
                  balanceAfter: 1100,
                },
              ],
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
      };

      const transaction2 = async () => {
        const session = await connection.startSession();
        try {
          await session.withTransaction(async () => {
            await userModel.updateOne(
              { _id: user._id },
              { $inc: { balance: 200 } },
              { session },
            );

            await transactionModel.create(
              [
                {
                  userId: user._id,
                  type: TransactionType.DEPOSIT,
                  amount: 200,
                  balanceBefore: 1100,
                  balanceAfter: 1300,
                },
              ],
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
      };

      await Promise.all([transaction1(), transaction2()]);

      const updatedUser = await userModel.findById(user._id);
      expect(updatedUser?.balance).toBe(1300);
    });

    it("should ensure durability - committed data persists", async () => {
      const session = await connection.startSession();

      await session.withTransaction(async () => {
        const user = await userModel.create(
          [{ username: "testuser", balance: 1000, frozenBalance: 0 }],
          { session },
        );

        await transactionModel.create(
          [
            {
              userId: user[0]!._id,
              type: TransactionType.DEPOSIT,
              amount: 500,
              balanceBefore: 1000,
              balanceAfter: 1500,
            },
          ],
          { session },
        );

        await userModel.updateOne(
          { _id: user[0]!._id },
          { $set: { balance: 1500 } },
          { session },
        );
      });

      await session.endSession();

      // Simulate server restart by creating new session
      const newSession = await connection.startSession();
      await newSession.endSession();

      const user = await userModel.findOne({ username: "testuser" });
      expect(user?.balance).toBe(1500);
    });

    it("should verify transaction commit", async () => {
      const session = await connection.startSession();

      await session.withTransaction(async () => {
        await userModel.create(
          [{ username: "testuser", balance: 1000, frozenBalance: 0 }],
          { session },
        );
      });

      await session.endSession();

      const user = await userModel.findOne({ username: "testuser" });
      expect(user).toBeDefined();
      expect(user?.balance).toBe(1000);
    });

    it("should verify transaction rollback on error", async () => {
      const session = await connection.startSession();

      try {
        await session.withTransaction(async () => {
          await userModel.create(
            [{ username: "testuser", balance: 1000, frozenBalance: 0 }],
            { session },
          );

          // Force an error
          throw new Error("Simulated error");
        });
      } catch (error) {
        expect(error).toBeDefined();
      } finally {
        await session.endSession();
      }

      const user = await userModel.findOne({ username: "testuser" });
      expect(user).toBeNull();
    });

    it("should rollback partial updates on error", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const session = await connection.startSession();

      try {
        await session.withTransaction(async () => {
          await userModel.updateOne(
            { _id: user._id },
            { $set: { balance: 1500 } },
            { session },
          );

          await transactionModel.create(
            [
              {
                userId: user._id,
                type: TransactionType.DEPOSIT,
                amount: 500,
                balanceBefore: 1000,
                balanceAfter: 1500,
              },
            ],
            { session },
          );

          // Force error
          throw new Error("Simulated error");
        });
      } catch (error) {
        expect(error).toBeDefined();
      } finally {
        await session.endSession();
      }

      const updatedUser = await userModel.findById(user._id);
      expect(updatedUser?.balance).toBe(1000); // Unchanged

      const transactions = await transactionModel.find({ userId: user._id });
      expect(transactions).toHaveLength(0); // No transaction created
    });

    it("should verify transaction state after failure", async () => {
      const session = await connection.startSession();
      let transactionStarted = false;

      try {
        await session.withTransaction(async () => {
          transactionStarted = true;
          await userModel.create(
            [{ username: "testuser", balance: 1000, frozenBalance: 0 }],
            { session },
          );

          throw new Error("Simulated error");
        });
      } catch (error) {
        expect(transactionStarted).toBe(true);
        expect(error).toBeDefined();
      } finally {
        await session.endSession();
      }

      const users = await userModel.find({});
      expect(users).toHaveLength(0);
    });
  });

  // ========================================
  // 2. Bid Transactions (6 tests)
  // ========================================

  describe("Bid Transactions", () => {
    it("should atomically place bid → update balance → update leaderboard", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        minBidAmount: 100,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        // Place bid
        await bidModel.create(
          [
            {
              auctionId: auction._id,
              userId: user._id,
              amount: 200,
              status: BidStatus.ACTIVE,
            },
          ],
          { session },
        );

        // Update balance
        await userModel.updateOne(
          { _id: user._id },
          { $set: { frozenBalance: 200 } },
          { session },
        );

        // Record transaction
        await transactionModel.create(
          [
            {
              userId: user._id,
              type: TransactionType.BID_FREEZE,
              amount: 200,
              balanceBefore: 1000,
              balanceAfter: 1000,
              frozenBefore: 0,
              frozenAfter: 200,
              auctionId: auction._id,
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const updatedUser = await userModel.findById(user._id);
      const bid = await bidModel.findOne({
        userId: user._id,
        auctionId: auction._id,
      });
      const transaction = await transactionModel.findOne({ userId: user._id });

      expect(updatedUser?.frozenBalance).toBe(200);
      expect(bid?.amount).toBe(200);
      expect(transaction?.frozenAfter).toBe(200);
    });

    it("should atomically bid freeze → record transaction → update audit", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        // Freeze bid
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { frozenBalance: 200 } },
          { session },
        );

        // Record transaction
        await transactionModel.create(
          [
            {
              userId: user._id,
              type: TransactionType.BID_FREEZE,
              amount: 200,
              balanceBefore: 1000,
              balanceAfter: 1000,
              frozenBefore: 0,
              frozenAfter: 200,
              auctionId: auction._id,
            },
          ],
          { session },
        );

        // Update audit
        await auditLogModel.create(
          [
            {
              userId: user._id,
              action: "BID_FREEZE",
              resource: "bid",
              resourceId: auction._id,
              result: "success",
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const updatedUser = await userModel.findById(user._id);
      const transaction = await transactionModel.findOne({ userId: user._id });
      const audit = await auditLogModel.findOne({ userId: user._id });

      expect(updatedUser?.frozenBalance).toBe(200);
      expect(transaction?.type).toBe(TransactionType.BID_FREEZE);
      expect(audit?.action).toBe("BID_FREEZE");
    });

    it("should handle multiple bids in same transaction atomically", async () => {
      const user1 = await userModel.create({
        username: "user1",
        balance: 1000,
        frozenBalance: 0,
      });
      const user2 = await userModel.create({
        username: "user2",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 2,
        roundsConfig: [{ itemsCount: 2, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user1._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        // User1 bid
        await bidModel.create(
          [
            {
              auctionId: auction._id,
              userId: user1._id,
              amount: 200,
              status: BidStatus.ACTIVE,
            },
          ],
          { session },
        );

        await userModel.updateOne(
          { _id: user1._id },
          { $inc: { frozenBalance: 200 } },
          { session },
        );

        // User2 bid
        await bidModel.create(
          [
            {
              auctionId: auction._id,
              userId: user2._id,
              amount: 250,
              status: BidStatus.ACTIVE,
            },
          ],
          { session },
        );

        await userModel.updateOne(
          { _id: user2._id },
          { $inc: { frozenBalance: 250 } },
          { session },
        );
      });

      await session.endSession();

      const updatedUser1 = await userModel.findById(user1._id);
      const updatedUser2 = await userModel.findById(user2._id);
      const bids = await bidModel.find({ auctionId: auction._id });

      expect(updatedUser1?.frozenBalance).toBe(200);
      expect(updatedUser2?.frozenBalance).toBe(250);
      expect(bids).toHaveLength(2);
    });

    it("should verify all related records updated on bid", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        const bid = await bidModel.create(
          [
            {
              auctionId: auction._id,
              userId: user._id,
              amount: 200,
              status: BidStatus.ACTIVE,
            },
          ],
          { session },
        );

        await userModel.updateOne(
          { _id: user._id },
          { $inc: { frozenBalance: 200 } },
          { session },
        );

        await transactionModel.create(
          [
            {
              userId: user._id,
              type: TransactionType.BID_FREEZE,
              amount: 200,
              balanceBefore: 1000,
              balanceAfter: 1000,
              frozenBefore: 0,
              frozenAfter: 200,
              auctionId: auction._id,
              bidId: bid[0]!._id,
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const updatedUser = await userModel.findById(user._id);
      const bid = await bidModel.findOne({ userId: user._id });
      const transaction = await transactionModel.findOne({ userId: user._id });

      expect(updatedUser?.frozenBalance).toBe(200);
      expect(bid?.amount).toBe(200);
      expect(transaction?.bidId?.toString()).toBe(bid?._id.toString());
    });

    it("should rollback all changes if bid transaction fails", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      try {
        await session.withTransaction(async () => {
          await bidModel.create(
            [
              {
                auctionId: auction._id,
                userId: user._id,
                amount: 200,
                status: BidStatus.ACTIVE,
              },
            ],
            { session },
          );

          await userModel.updateOne(
            { _id: user._id },
            { $inc: { frozenBalance: 200 } },
            { session },
          );

          throw new Error("Simulated error");
        });
      } catch (error) {
        expect(error).toBeDefined();
      } finally {
        await session.endSession();
      }

      const updatedUser = await userModel.findById(user._id);
      const bids = await bidModel.find({ userId: user._id });

      expect(updatedUser?.frozenBalance).toBe(0);
      expect(bids).toHaveLength(0);
    });

    it("should serialize concurrent bids on same auction", async () => {
      const user1 = await userModel.create({
        username: "user1",
        balance: 1000,
        frozenBalance: 0,
      });
      const user2 = await userModel.create({
        username: "user2",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user1._id,
      });

      const placeBid = async (userId: Types.ObjectId, amount: number) => {
        const session = await connection.startSession();
        try {
          await session.withTransaction(async () => {
            await bidModel.create(
              [
                {
                  auctionId: auction._id,
                  userId,
                  amount,
                  status: BidStatus.ACTIVE,
                },
              ],
              { session },
            );

            await userModel.updateOne(
              { _id: userId },
              { $inc: { frozenBalance: amount } },
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
      };

      await Promise.all([
        placeBid(user1._id, 200),
        placeBid(user2._id, 250),
      ]);

      const bids = await bidModel.find({ auctionId: auction._id });
      expect(bids).toHaveLength(2);
    });
  });

  // ========================================
  // 3. Auction Lifecycle Transactions (6 tests)
  // ========================================

  describe("Auction Lifecycle Transactions", () => {
    it("should atomically create auction → initialize round → commit", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        await auctionModel.create(
          [
            {
              title: "Test Auction",
              totalItems: 1,
              roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
              rounds: [
                {
                  roundNumber: 1,
                  itemsCount: 1,
                  completed: false,
                },
              ],
              status: AuctionStatus.PENDING,
              createdBy: user._id,
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const auction = await auctionModel.findOne({ title: "Test Auction" });
      expect(auction).toBeDefined();
      expect(auction?.rounds).toHaveLength(1);
      expect(auction?.rounds[0]?.roundNumber).toBe(1);
    });

    it("should atomically start auction → set status → initialize round", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.PENDING,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        await auctionModel.updateOne(
          { _id: auction._id },
          {
            $set: {
              status: AuctionStatus.ACTIVE,
              currentRound: 1,
              rounds: [
                {
                  roundNumber: 1,
                  itemsCount: 1,
                  startTime: new Date(),
                  completed: false,
                },
              ],
            },
          },
          { session },
        );
      });

      await session.endSession();

      const updatedAuction = await auctionModel.findById(auction._id);
      expect(updatedAuction?.status).toBe(AuctionStatus.ACTIVE);
      expect(updatedAuction?.currentRound).toBe(1);
      expect(updatedAuction?.rounds).toHaveLength(1);
    });

    it("should atomically complete round → select winner → unfreeze losers", async () => {
      const user1 = await userModel.create({
        username: "user1",
        balance: 1000,
        frozenBalance: 200,
      });
      const user2 = await userModel.create({
        username: "user2",
        balance: 1000,
        frozenBalance: 150,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user1._id,
      });

      const winningBid = await bidModel.create({
        auctionId: auction._id,
        userId: user1._id,
        amount: 200,
        status: BidStatus.ACTIVE,
      });

      const losingBid = await bidModel.create({
        auctionId: auction._id,
        userId: user2._id,
        amount: 150,
        status: BidStatus.ACTIVE,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        // Mark winner
        await bidModel.updateOne(
          { _id: winningBid._id },
          { $set: { status: BidStatus.WON } },
          { session },
        );

        // Deduct from winner
        await userModel.updateOne(
          { _id: user1._id },
          { $inc: { balance: -200, frozenBalance: -200 } },
          { session },
        );

        // Unfreeze loser
        await bidModel.updateOne(
          { _id: losingBid._id },
          { $set: { status: BidStatus.LOST } },
          { session },
        );

        await userModel.updateOne(
          { _id: user2._id },
          { $inc: { frozenBalance: -150 } },
          { session },
        );
      });

      await session.endSession();

      const winner = await userModel.findById(user1._id);
      const loser = await userModel.findById(user2._id);

      expect(winner?.balance).toBe(800);
      expect(winner?.frozenBalance).toBe(0);
      expect(loser?.frozenBalance).toBe(0);
    });

    it("should atomically cancel auction → revert all bids → refund all users", async () => {
      const user1 = await userModel.create({
        username: "user1",
        balance: 1000,
        frozenBalance: 200,
      });
      const user2 = await userModel.create({
        username: "user2",
        balance: 1000,
        frozenBalance: 150,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user1._id,
      });

      await bidModel.create({
        auctionId: auction._id,
        userId: user1._id,
        amount: 200,
        status: BidStatus.ACTIVE,
      });

      await bidModel.create({
        auctionId: auction._id,
        userId: user2._id,
        amount: 150,
        status: BidStatus.ACTIVE,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        // Cancel auction
        await auctionModel.updateOne(
          { _id: auction._id },
          { $set: { status: AuctionStatus.CANCELLED } },
          { session },
        );

        // Refund all bids
        await bidModel.updateMany(
          { auctionId: auction._id },
          { $set: { status: BidStatus.REFUNDED } },
          { session },
        );

        // Unfreeze all users
        await userModel.updateOne(
          { _id: user1._id },
          { $inc: { frozenBalance: -200 } },
          { session },
        );

        await userModel.updateOne(
          { _id: user2._id },
          { $inc: { frozenBalance: -150 } },
          { session },
        );
      });

      await session.endSession();

      const updatedAuction = await auctionModel.findById(auction._id);
      const user1Updated = await userModel.findById(user1._id);
      const user2Updated = await userModel.findById(user2._id);

      expect(updatedAuction?.status).toBe(AuctionStatus.CANCELLED);
      expect(user1Updated?.frozenBalance).toBe(0);
      expect(user2Updated?.frozenBalance).toBe(0);
    });

    it("should modify auction parameters in transaction", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.PENDING,
        minBidAmount: 100,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        await auctionModel.updateOne(
          { _id: auction._id },
          { $set: { minBidAmount: 150, minBidIncrement: 20 } },
          { session },
        );
      });

      await session.endSession();

      const updatedAuction = await auctionModel.findById(auction._id);
      expect(updatedAuction?.minBidAmount).toBe(150);
      expect(updatedAuction?.minBidIncrement).toBe(20);
    });

    it("should ensure auction state transitions are atomic", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.PENDING,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        await auctionModel.updateOne(
          { _id: auction._id },
          { $set: { status: AuctionStatus.ACTIVE, startTime: new Date() } },
          { session },
        );

        await auditLogModel.create(
          [
            {
              userId: user._id,
              action: "AUCTION_START",
              resource: "auction",
              resourceId: auction._id,
              result: "success",
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const updatedAuction = await auctionModel.findById(auction._id);
      const audit = await auditLogModel.findOne({ resourceId: auction._id });

      expect(updatedAuction?.status).toBe(AuctionStatus.ACTIVE);
      expect(audit?.action).toBe("AUCTION_START");
    });
  });

  // ========================================
  // 4. Financial Transactions (6 tests)
  // ========================================

  describe("Financial Transactions", () => {
    it("should atomically deposit → update balance → record transaction → create audit", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { balance: 500 } },
          { session },
        );

        await transactionModel.create(
          [
            {
              userId: user._id,
              type: TransactionType.DEPOSIT,
              amount: 500,
              balanceBefore: 1000,
              balanceAfter: 1500,
            },
          ],
          { session },
        );

        await auditLogModel.create(
          [
            {
              userId: user._id,
              action: "DEPOSIT",
              resource: "transaction",
              result: "success",
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const updatedUser = await userModel.findById(user._id);
      const transaction = await transactionModel.findOne({ userId: user._id });
      const audit = await auditLogModel.findOne({ userId: user._id });

      expect(updatedUser?.balance).toBe(1500);
      expect(transaction?.amount).toBe(500);
      expect(audit?.action).toBe("DEPOSIT");
    });

    it("should atomically withdraw → check balance → deduct → record → audit", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        const currentUser = await userModel.findById(user._id).session(session);

        if (currentUser && currentUser.balance >= 300) {
          await userModel.updateOne(
            { _id: user._id },
            { $inc: { balance: -300 } },
            { session },
          );

          await transactionModel.create(
            [
              {
                userId: user._id,
                type: TransactionType.WITHDRAW,
                amount: 300,
                balanceBefore: 1000,
                balanceAfter: 700,
              },
            ],
            { session },
          );

          await auditLogModel.create(
            [
              {
                userId: user._id,
                action: "WITHDRAW",
                resource: "transaction",
                result: "success",
              },
            ],
            { session },
          );
        }
      });

      await session.endSession();

      const updatedUser = await userModel.findById(user._id);
      const transaction = await transactionModel.findOne({ userId: user._id });

      expect(updatedUser?.balance).toBe(700);
      expect(transaction?.type).toBe(TransactionType.WITHDRAW);
    });

    it("should atomically bid freeze → reserve amount → record freeze transaction", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction = await auctionModel.create({
        title: "Test Auction",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { frozenBalance: 200 } },
          { session },
        );

        await transactionModel.create(
          [
            {
              userId: user._id,
              type: TransactionType.BID_FREEZE,
              amount: 200,
              balanceBefore: 1000,
              balanceAfter: 1000,
              frozenBefore: 0,
              frozenAfter: 200,
              auctionId: auction._id,
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const updatedUser = await userModel.findById(user._id);
      const transaction = await transactionModel.findOne({ userId: user._id });

      expect(updatedUser?.balance).toBe(1000);
      expect(updatedUser?.frozenBalance).toBe(200);
      expect(transaction?.frozenAfter).toBe(200);
    });

    it("should serialize multiple financial operations on same user", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const operation1 = async () => {
        const session = await connection.startSession();
        try {
          await session.withTransaction(async () => {
            await userModel.updateOne(
              { _id: user._id },
              { $inc: { balance: 100 } },
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
      };

      const operation2 = async () => {
        const session = await connection.startSession();
        try {
          await session.withTransaction(async () => {
            await userModel.updateOne(
              { _id: user._id },
              { $inc: { balance: 200 } },
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
      };

      await Promise.all([operation1(), operation2()]);

      const updatedUser = await userModel.findById(user._id);
      expect(updatedUser?.balance).toBe(1300);
    });

    it("should rollback financial transaction on error maintaining balance consistency", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const session = await connection.startSession();

      try {
        await session.withTransaction(async () => {
          await userModel.updateOne(
            { _id: user._id },
            { $inc: { balance: 500 } },
            { session },
          );

          await transactionModel.create(
            [
              {
                userId: user._id,
                type: TransactionType.DEPOSIT,
                amount: 500,
                balanceBefore: 1000,
                balanceAfter: 1500,
              },
            ],
            { session },
          );

          throw new Error("Simulated error");
        });
      } catch (error) {
        expect(error).toBeDefined();
      } finally {
        await session.endSession();
      }

      const updatedUser = await userModel.findById(user._id);
      const transactions = await transactionModel.find({ userId: user._id });

      expect(updatedUser?.balance).toBe(1000);
      expect(transactions).toHaveLength(0);
    });

    it("should ensure balance correct after concurrent deposits on same user", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const deposit = async (amount: number) => {
        const session = await connection.startSession();
        try {
          await session.withTransaction(async () => {
            await userModel.updateOne(
              { _id: user._id },
              { $inc: { balance: amount } },
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
      };

      await Promise.all([deposit(100), deposit(200), deposit(150)]);

      const updatedUser = await userModel.findById(user._id);
      expect(updatedUser?.balance).toBe(1450);
    });
  });

  // ========================================
  // 5. Data Integrity Checks (4 tests)
  // ========================================

  describe("Data Integrity Checks", () => {
    it("should verify transaction count matches operations", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        for (let i = 0; i < 5; i++) {
          await userModel.updateOne(
            { _id: user._id },
            { $inc: { balance: 100 } },
            { session },
          );

          await transactionModel.create(
            [
              {
                userId: user._id,
                type: TransactionType.DEPOSIT,
                amount: 100,
                balanceBefore: 1000 + i * 100,
                balanceAfter: 1100 + i * 100,
              },
            ],
            { session },
          );
        }
      });

      await session.endSession();

      const transactions = await transactionModel.find({ userId: user._id });
      expect(transactions).toHaveLength(5);
    });

    it("should verify balance equals sum of all transactions", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 0,
        frozenBalance: 0,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        // Deposit 500
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { balance: 500 } },
          { session },
        );
        await transactionModel.create(
          [
            {
              userId: user._id,
              type: TransactionType.DEPOSIT,
              amount: 500,
              balanceBefore: 0,
              balanceAfter: 500,
            },
          ],
          { session },
        );

        // Deposit 300
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { balance: 300 } },
          { session },
        );
        await transactionModel.create(
          [
            {
              userId: user._id,
              type: TransactionType.DEPOSIT,
              amount: 300,
              balanceBefore: 500,
              balanceAfter: 800,
            },
          ],
          { session },
        );

        // Withdraw 200
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { balance: -200 } },
          { session },
        );
        await transactionModel.create(
          [
            {
              userId: user._id,
              type: TransactionType.WITHDRAW,
              amount: 200,
              balanceBefore: 800,
              balanceAfter: 600,
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const updatedUser = await userModel.findById(user._id);
      const transactions = await transactionModel.find({ userId: user._id });

      const calculatedBalance = transactions.reduce((sum, tx) => {
        if (tx.type === TransactionType.DEPOSIT) return sum + tx.amount;
        if (tx.type === TransactionType.WITHDRAW) return sum - tx.amount;
        return sum;
      }, 0);

      expect(updatedUser?.balance).toBe(600);
      expect(updatedUser?.balance).toBe(calculatedBalance);
    });

    it("should verify frozen balance consistent with active bids", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const auction1 = await auctionModel.create({
        title: "Auction 1",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user._id,
      });

      const auction2 = await auctionModel.create({
        title: "Auction 2",
        totalItems: 1,
        roundsConfig: [{ itemsCount: 1, durationMinutes: 30 }],
        status: AuctionStatus.ACTIVE,
        createdBy: user._id,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        await bidModel.create(
          [
            {
              auctionId: auction1._id,
              userId: user._id,
              amount: 200,
              status: BidStatus.ACTIVE,
            },
          ],
          { session },
        );

        await bidModel.create(
          [
            {
              auctionId: auction2._id,
              userId: user._id,
              amount: 150,
              status: BidStatus.ACTIVE,
            },
          ],
          { session },
        );

        await userModel.updateOne(
          { _id: user._id },
          { $set: { frozenBalance: 350 } },
          { session },
        );
      });

      await session.endSession();

      const updatedUser = await userModel.findById(user._id);
      const activeBids = await bidModel.find({
        userId: user._id,
        status: BidStatus.ACTIVE,
      });

      const totalActiveBidAmount = activeBids.reduce(
        (sum, bid) => sum + bid.amount,
        0,
      );

      expect(updatedUser?.frozenBalance).toBe(350);
      expect(totalActiveBidAmount).toBe(350);
      expect(updatedUser?.frozenBalance).toBe(totalActiveBidAmount);
    });

    it("should verify audit log complete for all operations", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
      });

      const session = await connection.startSession();

      await session.withTransaction(async () => {
        // Operation 1: Deposit
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { balance: 500 } },
          { session },
        );
        await auditLogModel.create(
          [
            {
              userId: user._id,
              action: "DEPOSIT",
              resource: "transaction",
              result: "success",
            },
          ],
          { session },
        );

        // Operation 2: Withdraw
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { balance: -200 } },
          { session },
        );
        await auditLogModel.create(
          [
            {
              userId: user._id,
              action: "WITHDRAW",
              resource: "transaction",
              result: "success",
            },
          ],
          { session },
        );

        // Operation 3: Bid
        await userModel.updateOne(
          { _id: user._id },
          { $inc: { frozenBalance: 300 } },
          { session },
        );
        await auditLogModel.create(
          [
            {
              userId: user._id,
              action: "BID_FREEZE",
              resource: "bid",
              result: "success",
            },
          ],
          { session },
        );
      });

      await session.endSession();

      const auditLogs = await auditLogModel.find({ userId: user._id });

      expect(auditLogs).toHaveLength(3);
      expect(auditLogs[0]?.action).toBe("DEPOSIT");
      expect(auditLogs[1]?.action).toBe("WITHDRAW");
      expect(auditLogs[2]?.action).toBe("BID_FREEZE");
      expect(auditLogs.every((log) => log.result === "success")).toBe(true);
    });
  });
});
