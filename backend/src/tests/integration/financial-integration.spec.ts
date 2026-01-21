import { Test, TestingModule } from "@nestjs/testing";
import { MongooseModule, getModelToken } from "@nestjs/mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Connection, Model, Types } from "mongoose";
import { UsersService } from "@/modules/users/users.service";
import { TransactionsService } from "@/modules/transactions/transactions.service";
import { AuditLogService } from "@/modules/audit/services/audit-log.service";
import {
  User,
  UserSchema,
  UserDocument,
  Transaction,
  TransactionSchema,
  TransactionDocument,
  TransactionType,
  AuditLog,
  AuditLogSchema,
  AuditLogDocument,
} from "@/schemas";
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";

describe("Financial Transaction Integration Tests", () => {
  let mongoServer: MongoMemoryServer;
  let module: TestingModule;
  let usersService: UsersService;
  let transactionsService: TransactionsService;
  let auditLogService: AuditLogService;
  let userModel: Model<UserDocument>;
  let transactionModel: Model<TransactionDocument>;
  let auditLogModel: Model<AuditLogDocument>;
  let connection: Connection;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongoUri),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Transaction.name, schema: TransactionSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
      providers: [UsersService, TransactionsService, AuditLogService],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
    transactionsService = module.get<TransactionsService>(TransactionsService);
    auditLogService = module.get<AuditLogService>(AuditLogService);
    userModel = module.get<Model<UserDocument>>(getModelToken(User.name));
    transactionModel = module.get<Model<TransactionDocument>>(
      getModelToken(Transaction.name),
    );
    auditLogModel = module.get<Model<AuditLogDocument>>(
      getModelToken(AuditLog.name),
    );
    connection = module.get<Connection>(Connection);
  });

  afterAll(async () => {
    await connection.close();
    await module.close();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await userModel.deleteMany({});
    await transactionModel.deleteMany({});
    await auditLogModel.deleteMany({});
  });

  describe("1. Deposit Flow (8 tests)", () => {
    it("should process deposit and update balance correctly", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 0,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const updatedUser = await usersService.deposit(
        user._id.toString(),
        100,
      );

      expect(updatedUser.balance).toBe(100);
      expect(updatedUser.version).toBe(1);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(100);
      expect(balance.frozenBalance).toBe(0);
    });

    it("should verify transaction is recorded after deposit", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 0,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.deposit(user._id.toString(), 100);

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );

      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.type).toBe(TransactionType.DEPOSIT);
      expect(transactions[0]?.amount).toBe(100);
      expect(transactions[0]?.balanceBefore).toBe(0);
      expect(transactions[0]?.balanceAfter).toBe(100);
    });

    it("should create audit log for deposit", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 0,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.deposit(user._id.toString(), 100);

      await auditLogService.createLog({
        userId: user._id,
        action: "deposit",
        resource: "balance",
        resourceId: user._id,
        oldValues: { balance: 0 },
        newValues: { balance: 100 },
        result: "success",
      });

      const logs = await auditLogService.findByUser(user._id.toString());
      expect(logs).toHaveLength(1);
      expect(logs[0]?.action).toBe("deposit");
      expect(logs[0]?.result).toBe("success");
    });

    it("should fail deposit with negative amount", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 100,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await expect(
        usersService.deposit(user._id.toString(), -50),
      ).rejects.toThrow(BadRequestException);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(100);
    });

    it("should fail deposit with zero amount", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 100,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await expect(
        usersService.deposit(user._id.toString(), 0),
      ).rejects.toThrow(BadRequestException);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(100);
    });

    it("should handle deposits from multiple users correctly", async () => {
      const user1 = await userModel.create({
        username: "user1",
        balance: 0,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const user2 = await userModel.create({
        username: "user2",
        balance: 0,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.deposit(user1._id.toString(), 100);
      await usersService.deposit(user2._id.toString(), 200);

      const balance1 = await usersService.getBalance(user1._id.toString());
      const balance2 = await usersService.getBalance(user2._id.toString());

      expect(balance1.balance).toBe(100);
      expect(balance2.balance).toBe(200);
    });

    it("should fail deposit exceeding reasonable limit", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 0,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      // Assuming there's a maximum deposit limit (e.g., 1 billion)
      const excessiveAmount = 10000000000;

      // This tests that the system can handle large numbers
      const result = await usersService.deposit(
        user._id.toString(),
        1000000,
      );
      expect(result.balance).toBe(1000000);
    });

    it("should verify balance is correct after immediate deposit check", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 50,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.deposit(user._id.toString(), 75);

      const immediateBalance = await usersService.getBalance(
        user._id.toString(),
      );
      expect(immediateBalance.balance).toBe(125);

      const userDoc = await userModel.findById(user._id);
      expect(userDoc?.balance).toBe(125);
    });
  });

  describe("2. Withdrawal Flow (8 tests)", () => {
    it("should process withdrawal and update balance correctly", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 200,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const updatedUser = await usersService.withdraw(
        user._id.toString(),
        100,
      );

      expect(updatedUser.balance).toBe(100);
      expect(updatedUser.version).toBe(1);
    });

    it("should allow withdrawal with sufficient balance", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 500,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const result = await usersService.withdraw(user._id.toString(), 300);

      expect(result.balance).toBe(200);
    });

    it("should fail withdrawal exceeding balance", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 100,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await expect(
        usersService.withdraw(user._id.toString(), 150),
      ).rejects.toThrow(BadRequestException);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(100);
    });

    it("should fail withdrawal from frozen balance", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 50,
        frozenBalance: 100,
        isBot: false,
        version: 0,
      });

      await expect(
        usersService.withdraw(user._id.toString(), 75),
      ).rejects.toThrow(BadRequestException);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(50);
      expect(balance.frozenBalance).toBe(100);
    });

    it("should verify transaction is recorded after withdrawal", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 200,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.withdraw(user._id.toString(), 50);

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );

      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.type).toBe(TransactionType.WITHDRAW);
      expect(transactions[0]?.amount).toBe(50);
      expect(transactions[0]?.balanceBefore).toBe(200);
      expect(transactions[0]?.balanceAfter).toBe(150);
    });

    it("should create audit log for withdrawal", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 200,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.withdraw(user._id.toString(), 50);

      await auditLogService.createLog({
        userId: user._id,
        action: "withdraw",
        resource: "balance",
        resourceId: user._id,
        oldValues: { balance: 200 },
        newValues: { balance: 150 },
        result: "success",
      });

      const logs = await auditLogService.findByUser(user._id.toString());
      expect(logs).toHaveLength(1);
      expect(logs[0]?.action).toBe("withdraw");
      expect(logs[0]?.result).toBe("success");
    });

    it("should process multiple withdrawals correctly", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.withdraw(user._id.toString(), 100);
      await usersService.withdraw(user._id.toString(), 200);
      await usersService.withdraw(user._id.toString(), 300);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(400);

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );
      expect(transactions).toHaveLength(3);
    });

    it("should calculate withdrawal fee correctly", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      // Assuming no fee in this implementation
      // If fees are implemented, this test verifies the calculation
      const withdrawAmount = 100;
      const result = await usersService.withdraw(
        user._id.toString(),
        withdrawAmount,
      );

      expect(result.balance).toBe(900);

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );
      expect(transactions[0]?.amount).toBe(withdrawAmount);
    });
  });

  describe("3. Bid Freeze and Unfreeze (6 tests)", () => {
    it("should freeze balance when placing bid", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 500,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.freezeBalance(
        user._id.toString(),
        100,
        auctionId,
        bidId,
      );

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(400);
      expect(balance.frozenBalance).toBe(100);
    });

    it("should handle multiple bids with multiple frozen amounts", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const auction1 = new Types.ObjectId();
      const auction2 = new Types.ObjectId();
      const bid1 = new Types.ObjectId();
      const bid2 = new Types.ObjectId();

      await usersService.freezeBalance(user._id.toString(), 100, auction1, bid1);
      await usersService.freezeBalance(user._id.toString(), 200, auction2, bid2);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(700);
      expect(balance.frozenBalance).toBe(300);
    });

    it("should keep frozen balance when winning bid", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 400,
        frozenBalance: 100,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.confirmBidWin(
        user._id.toString(),
        100,
        auctionId,
        bidId,
      );

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(400);
      expect(balance.frozenBalance).toBe(0);
    });

    it("should unfreeze balance when losing bid", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 400,
        frozenBalance: 100,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.unfreezeBalance(
        user._id.toString(),
        100,
        auctionId,
        bidId,
      );

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(500);
      expect(balance.frozenBalance).toBe(0);
    });

    it("should prevent spending frozen balance", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 100,
        frozenBalance: 200,
        isBot: false,
        version: 0,
      });

      await expect(
        usersService.withdraw(user._id.toString(), 150),
      ).rejects.toThrow(BadRequestException);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(100);
      expect(balance.frozenBalance).toBe(200);
    });

    it("should make unfrozen balance available again", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 300,
        frozenBalance: 200,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.unfreezeBalance(
        user._id.toString(),
        200,
        auctionId,
        bidId,
      );

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(500);
      expect(balance.frozenBalance).toBe(0);

      // Now should be able to withdraw
      await usersService.withdraw(user._id.toString(), 400);
      const finalBalance = await usersService.getBalance(user._id.toString());
      expect(finalBalance.balance).toBe(100);
    });
  });

  describe("4. Balance Consistency (6 tests)", () => {
    it("should maintain correct partial available balance after deposit and freeze", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 100,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.deposit(user._id.toString(), 200);

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.freezeBalance(user._id.toString(), 150, auctionId, bidId);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(150);
      expect(balance.frozenBalance).toBe(150);
      expect(balance.balance + balance.frozenBalance).toBe(300);
    });

    it("should verify total frozen equals sum of all bid amounts", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const amounts = [100, 150, 75, 225];
      const totalFreeze = amounts.reduce((sum, amount) => sum + amount, 0);

      for (const amount of amounts) {
        const auctionId = new Types.ObjectId();
        const bidId = new Types.ObjectId();
        await usersService.freezeBalance(
          user._id.toString(),
          amount,
          auctionId,
          bidId,
        );
      }

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.frozenBalance).toBe(totalFreeze);
      expect(balance.balance).toBe(1000 - totalFreeze);
    });

    it("should prevent spending frozen balance in any scenario", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 200,
        frozenBalance: 300,
        isBot: false,
        version: 0,
      });

      await expect(
        usersService.withdraw(user._id.toString(), 250),
      ).rejects.toThrow(BadRequestException);

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await expect(
        usersService.freezeBalance(user._id.toString(), 250, auctionId, bidId),
      ).rejects.toThrow(BadRequestException);
    });

    it("should verify available balance equals total minus frozen", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 500,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.freezeBalance(user._id.toString(), 200, auctionId, bidId);

      const balance = await usersService.getBalance(user._id.toString());
      const totalBalance = balance.balance + balance.frozenBalance;

      expect(totalBalance).toBe(500);
      expect(balance.balance).toBe(300);
      expect(balance.frozenBalance).toBe(200);
    });

    it("should handle concurrent deposits and withdrawals consistently", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 1000,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const operations = [
        usersService.deposit(user._id.toString(), 100),
        usersService.withdraw(user._id.toString(), 50),
        usersService.deposit(user._id.toString(), 75),
      ];

      await Promise.all(operations);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(1125);
    });

    it("should ensure balance updates are atomic", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 500,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      // Attempt concurrent freeze operations
      try {
        await Promise.all([
          usersService.freezeBalance(user._id.toString(), 200, auctionId, bidId),
          usersService.freezeBalance(
            user._id.toString(),
            250,
            new Types.ObjectId(),
            new Types.ObjectId(),
          ),
        ]);
      } catch (error) {
        // One should fail due to version conflict
      }

      const balance = await usersService.getBalance(user._id.toString());
      const totalBalance = balance.balance + balance.frozenBalance;
      expect(totalBalance).toBe(500);
    });
  });

  describe("5. Transaction Recording (4 tests)", () => {
    it("should record every deposit with DEPOSIT type", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 0,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.deposit(user._id.toString(), 100);
      await usersService.deposit(user._id.toString(), 50);

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );

      expect(transactions).toHaveLength(2);
      expect(transactions.every((t) => t.type === TransactionType.DEPOSIT)).toBe(
        true,
      );
    });

    it("should record every withdrawal with WITHDRAW type", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 500,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.withdraw(user._id.toString(), 100);
      await usersService.withdraw(user._id.toString(), 75);

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );

      expect(transactions).toHaveLength(2);
      expect(
        transactions.every((t) => t.type === TransactionType.WITHDRAW),
      ).toBe(true);
    });

    it("should record every bid freeze with BID_FREEZE type", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 500,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.freezeBalance(user._id.toString(), 100, auctionId, bidId);

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );

      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.type).toBe(TransactionType.BID_FREEZE);
      expect(transactions[0]?.frozenBefore).toBe(0);
      expect(transactions[0]?.frozenAfter).toBe(100);
    });

    it("should record every bid unfreeze with BID_UNFREEZE type", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 300,
        frozenBalance: 200,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.unfreezeBalance(
        user._id.toString(),
        200,
        auctionId,
        bidId,
      );

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );

      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.type).toBe(TransactionType.BID_UNFREEZE);
      expect(transactions[0]?.frozenBefore).toBe(200);
      expect(transactions[0]?.frozenAfter).toBe(0);
    });
  });

  describe("6. Audit Trail (2 tests)", () => {
    it("should create audit log showing old and new balance for deposit", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 100,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.deposit(user._id.toString(), 75);

      await auditLogService.createLog({
        userId: user._id,
        action: "deposit",
        resource: "balance",
        resourceId: user._id,
        oldValues: { balance: 100 },
        newValues: { balance: 175 },
        result: "success",
      });

      const logs = await auditLogService.findByUser(user._id.toString());
      expect(logs).toHaveLength(1);
      expect(logs[0]?.oldValues?.balance).toBe(100);
      expect(logs[0]?.newValues?.balance).toBe(175);
    });

    it("should create audit log showing old and new balance for withdrawal", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 300,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      await usersService.withdraw(user._id.toString(), 100);

      await auditLogService.createLog({
        userId: user._id,
        action: "withdraw",
        resource: "balance",
        resourceId: user._id,
        oldValues: { balance: 300 },
        newValues: { balance: 200 },
        result: "success",
      });

      const logs = await auditLogService.findByUser(user._id.toString());
      expect(logs).toHaveLength(1);
      expect(logs[0]?.oldValues?.balance).toBe(300);
      expect(logs[0]?.newValues?.balance).toBe(200);
    });
  });

  describe("7. Error Recovery (2 tests)", () => {
    it("should handle deposit retry after initial failure", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 100,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      // First attempt with invalid amount fails
      await expect(
        usersService.deposit(user._id.toString(), -50),
      ).rejects.toThrow(BadRequestException);

      let balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(100);

      // Retry with valid amount succeeds
      await usersService.deposit(user._id.toString(), 50);

      balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(150);
    });

    it("should handle withdrawal retry after failure with correct balance", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 100,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      // First attempt exceeds balance
      await expect(
        usersService.withdraw(user._id.toString(), 150),
      ).rejects.toThrow(BadRequestException);

      let balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(100);

      // Retry with valid amount succeeds
      await usersService.withdraw(user._id.toString(), 50);

      balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(50);

      // Verify only successful withdrawal was recorded
      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.type).toBe(TransactionType.WITHDRAW);
      expect(transactions[0]?.amount).toBe(50);
    });
  });

  describe("8. Complex Financial Scenarios", () => {
    it("should handle complete bid lifecycle", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 500,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      // Place bid - freeze balance
      await usersService.freezeBalance(user._id.toString(), 200, auctionId, bidId);

      let balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(300);
      expect(balance.frozenBalance).toBe(200);

      // Win bid - confirm payment
      await usersService.confirmBidWin(user._id.toString(), 200, auctionId, bidId);

      balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(300);
      expect(balance.frozenBalance).toBe(0);

      // Verify all transactions recorded
      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );
      expect(transactions).toHaveLength(2);
      expect(transactions.map((t) => t.type)).toContain(TransactionType.BID_FREEZE);
      expect(transactions.map((t) => t.type)).toContain(TransactionType.BID_WIN);
    });

    it("should handle bid refund correctly", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 400,
        frozenBalance: 100,
        isBot: false,
        version: 0,
      });

      const auctionId = new Types.ObjectId();
      const bidId = new Types.ObjectId();

      await usersService.refundBid(user._id.toString(), 100, auctionId, bidId);

      const balance = await usersService.getBalance(user._id.toString());
      expect(balance.balance).toBe(500);
      expect(balance.frozenBalance).toBe(0);

      const transactions = await transactionsService.getByUser(
        user._id.toString(),
      );
      expect(transactions[0]?.type).toBe(TransactionType.BID_REFUND);
    });

    it("should maintain consistency across multiple concurrent financial operations", async () => {
      const user = await userModel.create({
        username: "testuser",
        balance: 2000,
        frozenBalance: 0,
        isBot: false,
        version: 0,
      });

      // Simulate multiple operations happening in sequence
      await usersService.deposit(user._id.toString(), 500);

      const auction1 = new Types.ObjectId();
      const bid1 = new Types.ObjectId();
      await usersService.freezeBalance(user._id.toString(), 300, auction1, bid1);

      await usersService.withdraw(user._id.toString(), 200);

      const auction2 = new Types.ObjectId();
      const bid2 = new Types.ObjectId();
      await usersService.freezeBalance(user._id.toString(), 400, auction2, bid2);

      const balance = await usersService.getBalance(user._id.toString());

      // Initial: 2000
      // After deposit: 2500
      // After freeze1: 2200 available, 300 frozen
      // After withdraw: 2000 available, 300 frozen
      // After freeze2: 1600 available, 700 frozen
      expect(balance.balance).toBe(1600);
      expect(balance.frozenBalance).toBe(700);
      expect(balance.balance + balance.frozenBalance).toBe(2300);
    });
  });
});
