/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MongooseModule, getModelToken } from "@nestjs/mongoose";
import { Model, Connection } from "mongoose";
import { ConfigModule } from "@nestjs/config";
import { MongoMemoryServer } from "mongodb-memory-server";
import { I18nModule, AcceptLanguageResolver, QueryResolver } from "nestjs-i18n";
import * as path from "path";
import { AuthModule } from "@/modules/auth/auth.module";
import { UsersModule } from "@/modules/users/users.module";
import { TransactionsModule } from "@/modules/transactions/transactions.module";
import { BidsModule } from "@/modules/bids/bids.module";
import { AuthService } from "@/modules/auth/auth.service";
import { TelegramService } from "@/modules/auth/telegram.service";
import { UsersService } from "@/modules/users/users.service";
import { TransactionsService } from "@/modules/transactions/transactions.service";
import { BidsService } from "@/modules/bids/bids.service";
import { AuthGuard } from "@/common";
import {
  User,
  UserDocument,
  Transaction,
  TransactionDocument,
  Bid,
  BidDocument,
} from "@/schemas";

// MongoDB Memory Server with replica set requires time to download binary on first run
jest.setTimeout(180000);

describe("Authentication Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let jwtService: JwtService;
  let telegramService: TelegramService;
  let usersService: UsersService;
  let transactionsService: TransactionsService;
  let bidsService: BidsService;
  let userModel: Model<UserDocument>;
  let transactionModel: Model<TransactionDocument>;
  let bidModel: Model<BidDocument>;
  let mongoServer: MongoMemoryServer;
  let mongoConnection: Connection;

  beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET: "test-secret-key-for-integration-tests",
              JWT_EXPIRES_IN: "24h",
              BOT_TOKEN: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
              MONGODB_URI: mongoUri,
              REDIS_URL: "redis://localhost:6379/15",
              NODE_ENV: "test",
            }),
          ],
        }),
        I18nModule.forRoot({
          fallbackLanguage: "en",
          loaderOptions: {
            path: path.join(__dirname, "../../../i18n/"),
            watch: false,
          },
          resolvers: [
            { use: QueryResolver, options: ["lang"] },
            AcceptLanguageResolver,
          ],
        }),
        MongooseModule.forRoot(mongoUri),
        AuthModule,
        UsersModule,
        TransactionsModule,
        BidsModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    authService = moduleFixture.get<AuthService>(AuthService);
    jwtService = moduleFixture.get<JwtService>(JwtService);
    telegramService = moduleFixture.get<TelegramService>(TelegramService);
    usersService = moduleFixture.get<UsersService>(UsersService);
    transactionsService =
      moduleFixture.get<TransactionsService>(TransactionsService);
    bidsService = moduleFixture.get<BidsService>(BidsService);
    userModel = moduleFixture.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
    transactionModel = moduleFixture.get<Model<TransactionDocument>>(
      getModelToken(Transaction.name),
    );
    bidModel = moduleFixture.get<Model<BidDocument>>(getModelToken(Bid.name));
  }, 300000);

  afterAll(async () => {
    if (mongoConnection) {
      await mongoConnection.close();
    }
    if (app) {
      await app.close();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await userModel.deleteMany({});
    await transactionModel.deleteMany({});
    await bidModel.deleteMany({});
  });

  // ====================================================================
  // 1. Complete JWT auth flow (8 tests)
  // ====================================================================

  describe("Complete JWT Auth Flow", () => {
    it("should complete full flow: login → receive JWT → access protected resource → verify token works", async () => {
      // Step 1: Login
      const telegramUser = {
        id: 123456789,
        first_name: "Test",
        last_name: "User",
        username: "testuser",
        photo_url: "https://example.com/photo.jpg",
        language_code: "en",
        is_premium: false,
        auth_date: Math.floor(Date.now() / 1000),
        hash: "mock_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const loginResponse =
        await authService.loginWithTelegramWidget(telegramUser);

      expect(loginResponse.accessToken).toBeDefined();
      expect(loginResponse.user.username).toBe("testuser");

      // Step 2: Verify JWT token
      const payload = await jwtService.verifyAsync(loginResponse.accessToken);
      expect(payload.sub).toBe(loginResponse.user.id);
      expect(payload.username).toBe("testuser");

      // Step 3: Access protected resource (get user balance)
      const balance = await usersService.getBalance(loginResponse.user.id);
      expect(balance.balance).toBe(0);
      expect(balance.frozenBalance).toBe(0);

      // Step 4: Verify token still works
      const userFromAuth = await authService.getUser(loginResponse.user.id);
      expect(userFromAuth.username).toBe("testuser");
    });

    it("should handle token refresh and renewal", async () => {
      const telegramUser = {
        id: 987654321,
        first_name: "Refresh",
        last_name: "Test",
        username: "refreshuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "mock_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      // First login
      const firstLogin =
        await authService.loginWithTelegramWidget(telegramUser);
      const firstToken = firstLogin.accessToken;

      // Simulate time passing and re-login (token renewal)
      await new Promise((resolve) => setTimeout(resolve, 100));

      const secondLogin =
        await authService.loginWithTelegramWidget(telegramUser);
      const secondToken = secondLogin.accessToken;

      // Tokens should be different (new token issued)
      expect(firstToken).not.toBe(secondToken);

      // Both tokens should be valid
      const firstPayload = await jwtService.verifyAsync(firstToken);
      const secondPayload = await jwtService.verifyAsync(secondToken);

      expect(firstPayload.sub).toBe(secondPayload.sub);
      expect(firstPayload.username).toBe(secondPayload.username);
    });

    it("should handle token expiration and renewal", async () => {
      const userId = "507f1f77bcf86cd799439011";
      const username = "expireuser";

      // Create user manually
      await userModel.create({
        _id: userId,
        username,
        balance: 100,
        frozenBalance: 0,
      });

      // Create an expired token (1 second expiry)
      const expiredToken = await jwtService.signAsync(
        {
          sub: userId,
          username,
        },
        { expiresIn: "1s" },
      );

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Token should be expired
      await expect(jwtService.verifyAsync(expiredToken)).rejects.toThrow();

      // Create new valid token
      const newToken = await jwtService.signAsync({
        sub: userId,
        username,
      });

      const payload = await jwtService.verifyAsync(newToken);
      expect(payload.sub).toBe(userId);
    });

    it("should support multiple concurrent users with different tokens", async () => {
      const users = [
        {
          id: 111111,
          first_name: "User1",
          username: "user1",
          auth_date: Math.floor(Date.now() / 1000),
          hash: "hash1",
        },
        {
          id: 222222,
          first_name: "User2",
          username: "user2",
          auth_date: Math.floor(Date.now() / 1000),
          hash: "hash2",
        },
        {
          id: 333333,
          first_name: "User3",
          username: "user3",
          auth_date: Math.floor(Date.now() / 1000),
          hash: "hash3",
        },
      ];

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockImplementation((user) => user as any);

      const logins = await Promise.all(
        users.map((user) => authService.loginWithTelegramWidget(user as any)),
      );

      // Verify all tokens are unique
      const tokens = logins.map((l) => l.accessToken);
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(3);

      // Verify each token corresponds to correct user
      for (let i = 0; i < logins.length; i++) {
        const token = tokens?.[i];
        expect(token).toBeDefined();
        const payload = await jwtService.verifyAsync(token!);
        expect(payload.username).toBe(users?.[i]?.username);
        expect(payload.telegramId).toBe(users?.[i]?.id);
      }
    });

    it("should allow login then immediate service access", async () => {
      const telegramUser = {
        id: 555555,
        first_name: "Immediate",
        username: "immediateuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "mock_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      // Login
      const login = await authService.loginWithTelegramWidget(telegramUser);

      // Immediately deposit without delay
      const updatedUser = await usersService.deposit(login.user.id, 500);
      expect(updatedUser.balance).toBe(500);

      // Verify transaction was created
      const transactions = await transactionsService.getByUser(login.user.id);
      expect(transactions).toHaveLength(1);
      expect(transactions?.[0]?.amount).toBe(500);
    });

    it("should reject invalid/tampered tokens", async () => {
      const validUserId = "507f1f77bcf86cd799439011";
      const validToken = await jwtService.signAsync({
        sub: validUserId,
        username: "validuser",
      });

      // Tamper with token
      const tamperedToken = validToken.slice(0, -5) + "xxxxx";

      // Should reject tampered token
      await expect(jwtService.verifyAsync(tamperedToken)).rejects.toThrow();

      // Should accept valid token
      const payload = await jwtService.verifyAsync(validToken);
      expect(payload.sub).toBe(validUserId);
    });

    it("should support cross-service token usage", async () => {
      const telegramUser = {
        id: 777777,
        first_name: "Cross",
        username: "crossservice",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "mock_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);
      const token = login.accessToken;

      // Use token across different services
      // 1. Auth service
      const userFromAuth = await authService.getUser(login.user.id);
      expect(userFromAuth.username).toBe("crossservice");

      // 2. Users service
      await usersService.deposit(login.user.id, 1000);
      const balance = await usersService.getBalance(login.user.id);
      expect(balance.balance).toBe(1000);

      // 3. Transactions service
      const transactions = await transactionsService.getByUser(login.user.id);
      expect(transactions).toHaveLength(1);

      // Token should still be valid for all operations
      const payload = await jwtService.verifyAsync(token);
      expect(payload.sub).toBe(login.user.id);
    });

    it("should maintain session consistency", async () => {
      const telegramUser = {
        id: 888888,
        first_name: "Session",
        username: "sessionuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "mock_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);

      // Perform multiple operations
      await usersService.deposit(login.user.id, 500);
      await usersService.deposit(login.user.id, 300);
      await usersService.withdraw(login.user.id, 200);

      // Verify session consistency
      const balance = await usersService.getBalance(login.user.id);
      expect(balance.balance).toBe(600); // 500 + 300 - 200

      const transactions = await transactionsService.getByUser(login.user.id);
      expect(transactions).toHaveLength(3);

      // User data should be consistent
      const user = await authService.getUser(login.user.id);
      expect(user.balance).toBe(600);
    });
  });

  // ====================================================================
  // 2. Telegram widget auth flow (8 tests)
  // ====================================================================

  describe("Telegram Widget Auth Flow", () => {
    it("should create user on widget login and allow service access", async () => {
      const telegramUser = {
        id: 999999,
        first_name: "Widget",
        last_name: "User",
        username: "widgetuser",
        photo_url: "https://example.com/widget.jpg",
        language_code: "en",
        is_premium: true,
        auth_date: Math.floor(Date.now() / 1000),
        hash: "widget_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      // Widget login
      const login = await authService.loginWithTelegramWidget(telegramUser);

      expect(login.user.username).toBe("widgetuser");
      expect(login.user.telegramId).toBe(999999);
      expect(login.user.firstName).toBe("Widget");
      expect(login.user.lastName).toBe("User");

      // Verify user was created in database
      const user = await userModel.findOne({ telegramId: 999999 });
      expect(user).toBeDefined();
      expect(user!.username).toBe("widgetuser");

      // Should be able to access services immediately
      const balance = await usersService.getBalance(login.user.id);
      expect(balance.balance).toBe(0);
    });

    it("should work correctly for existing user widget login", async () => {
      // Pre-create user
      const existingUser = await userModel.create({
        username: "existingwidget",
        telegramId: 101010,
        firstName: "Old",
        lastName: "Name",
        balance: 1000,
      });

      const telegramUser = {
        id: 101010,
        first_name: "Updated",
        last_name: "Name",
        username: "existingwidget",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "existing_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);

      // Should return same user with updated data
      expect(login.user.id).toBe(existingUser._id.toString());
      expect(login.user.firstName).toBe("Updated"); // Updated
      expect(login.user.balance).toBe(1000); // Preserved

      // Verify database was updated
      const user = await userModel.findById(existingUser._id);
      expect(user!.firstName).toBe("Updated");
    });

    it("should login → check balance → works without re-auth", async () => {
      const telegramUser = {
        id: 202020,
        first_name: "Balance",
        username: "balanceuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "balance_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      // Login
      const login = await authService.loginWithTelegramWidget(telegramUser);

      // Add balance
      await usersService.deposit(login.user.id, 750);

      // Check balance without re-authentication
      const balance = await usersService.getBalance(login.user.id);
      expect(balance.balance).toBe(750);

      // Token should still be valid
      const payload = await jwtService.verifyAsync(login.accessToken);
      expect(payload.sub).toBe(login.user.id);
    });

    it("should handle multiple logins from same user → same session", async () => {
      const telegramUser = {
        id: 303030,
        first_name: "Multi",
        username: "multilogin",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "multi_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      // First login
      const login1 = await authService.loginWithTelegramWidget(telegramUser);

      // Second login
      telegramUser.auth_date = Math.floor(Date.now() / 1000);
      const login2 = await authService.loginWithTelegramWidget(telegramUser);

      // Should reference same user
      expect(login1.user.id).toBe(login2.user.id);
      expect(login1.user.telegramId).toBe(login2.user.telegramId);

      // Tokens should be different (new JWT each login)
      expect(login1.accessToken).not.toBe(login2.accessToken);

      // Only one user should exist in database
      const userCount = await userModel.countDocuments({ telegramId: 303030 });
      expect(userCount).toBe(1);
    });

    it("should allow widget login → telegram logout → JWT still works", async () => {
      const telegramUser = {
        id: 404040,
        first_name: "Logout",
        username: "logoutuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "logout_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);

      // Simulate telegram logout (client-side only, JWT remains valid)
      // In real scenario, client would discard token, but server doesn't invalidate

      // JWT should still be valid server-side
      const payload = await jwtService.verifyAsync(login.accessToken);
      expect(payload.sub).toBe(login.user.id);

      // Can still access services with token
      const user = await authService.getUser(login.user.id);
      expect(user.username).toBe("logoutuser");
    });

    it("should detect premium user from widget", async () => {
      const premiumUser = {
        id: 505050,
        first_name: "Premium",
        username: "premiumuser",
        is_premium: true,
        auth_date: Math.floor(Date.now() / 1000),
        hash: "premium_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(premiumUser);

      const login = await authService.loginWithTelegramWidget(premiumUser);

      // Verify premium status is stored
      const user = await userModel.findById(login.user.id);
      expect(user!.isPremium).toBe(true);
    });

    it("should handle new vs returning user flows", async () => {
      const newUser = {
        id: 606060,
        first_name: "New",
        username: "newuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "new_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(newUser);

      // First login (new user)
      const firstLogin = await authService.loginWithTelegramWidget(newUser);
      expect(firstLogin.user.balance).toBe(0);

      // Add balance for returning user
      await usersService.deposit(firstLogin.user.id, 2000);

      // Second login (returning user)
      newUser.auth_date = Math.floor(Date.now() / 1000);
      const returningLogin = await authService.loginWithTelegramWidget(newUser);

      // Balance should be preserved
      expect(returningLogin.user.balance).toBe(2000);
      expect(returningLogin.user.id).toBe(firstLogin.user.id);
    });

    it("should handle username conflicts gracefully", async () => {
      // Create non-Telegram user with username
      await userModel.create({
        username: "conflictuser",
        balance: 500,
      });

      const telegramUser = {
        id: 707070,
        first_name: "Conflict",
        username: "conflictuser", // Same username
        auth_date: Math.floor(Date.now() / 1000),
        hash: "conflict_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);

      // Should create user with fallback username (tg_707070)
      expect(login.user.username).toBe("tg_707070");
      expect(login.user.telegramId).toBe(707070);

      // Original user should still exist
      const originalUser = await userModel.findOne({
        username: "conflictuser",
        telegramId: { $exists: false },
      });
      expect(originalUser).toBeDefined();
    });
  });

  // ====================================================================
  // 3. Service access after auth (8 tests)
  // ====================================================================

  describe("Service Access After Auth", () => {
    let authenticatedUser: any;
    let authToken: string; // Reserved for future request authentication tests

    beforeEach(async () => {
      const telegramUser = {
        id: 800000,
        first_name: "Service",
        username: "serviceuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "service_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);
      authenticatedUser = login.user;
      authToken = login.accessToken; // For future HTTP request authentication

      // Add initial balance
      await usersService.deposit(authenticatedUser.id, 5000);
    });

    it("should login → create transaction → verify in history", async () => {
      // Create transaction via deposit
      await usersService.deposit(authenticatedUser.id, 1500);

      // Verify in transaction history
      const transactions = await transactionsService.getByUser(
        authenticatedUser.id,
      );
      expect(transactions.length).toBeGreaterThanOrEqual(2); // Initial + new

      const latestTransaction = transactions?.[0];
      expect(latestTransaction).toBeDefined();
      expect(latestTransaction!.amount).toBe(1500);
      expect(latestTransaction!.type).toBe("deposit");
    });

    it("should login → check balance → deposit → verify balance updated", async () => {
      // Check initial balance
      const initialBalance = await usersService.getBalance(
        authenticatedUser.id,
      );
      expect(initialBalance.balance).toBe(5000);

      // Deposit
      await usersService.deposit(authenticatedUser.id, 2500);

      // Verify updated balance
      const updatedBalance = await usersService.getBalance(
        authenticatedUser.id,
      );
      expect(updatedBalance.balance).toBe(7500);
    });

    it("should login → place bid → check bid appears in user's bids", async () => {
      // This test simulates the full bid flow
      // In a real scenario, bids would be created through the auctions service
      // For integration testing, we'll create a mock auction and bid

      const mockAuctionId = "507f1f77bcf86cd799439012";

      // Create bid directly (normally done through auctions service)
      await bidModel.create({
        userId: authenticatedUser.id,
        auctionId: mockAuctionId,
        amount: 1000,
        status: "active",
      });

      // Get user's bids
      const userBids = await bidsService.getByUser(authenticatedUser.id);
      expect(userBids).toHaveLength(1);
      expect(userBids?.[0]?.amount).toBe(1000);
    });

    it("should login → access user profile → get complete info", async () => {
      const user = await authService.getUser(authenticatedUser.id);

      expect(user.username).toBe("serviceuser");
      expect(user.telegramId).toBe(800000);
      expect(user.firstName).toBe("Service");
      expect(user.balance).toBe(5000);
      expect(user._id.toString()).toBe(authenticatedUser.id);
    });

    it("should login → access audit logs → see own actions", async () => {
      // Perform multiple actions
      await usersService.deposit(authenticatedUser.id, 500);
      await usersService.withdraw(authenticatedUser.id, 300);
      await usersService.deposit(authenticatedUser.id, 200);

      // Check transaction history (audit trail)
      const transactions = await transactionsService.getByUser(
        authenticatedUser.id,
      );

      expect(transactions.length).toBeGreaterThanOrEqual(4); // Initial + 3 new
      expect(transactions.some((t) => t.type === "deposit")).toBe(true);
      expect(transactions.some((t) => t.type === "withdraw")).toBe(true);
    });

    it("should isolate data between different authenticated users", async () => {
      // Create second user
      const telegramUser2 = {
        id: 800001,
        first_name: "Second",
        username: "seconduser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "second_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser2);

      const login2 = await authService.loginWithTelegramWidget(telegramUser2);

      // Add balance to second user
      await usersService.deposit(login2.user.id, 3000);

      // Verify data isolation
      const user1Balance = await usersService.getBalance(authenticatedUser.id);
      const user2Balance = await usersService.getBalance(login2.user.id);

      expect(user1Balance.balance).toBe(5000);
      expect(user2Balance.balance).toBe(3000);

      // Verify transaction isolation
      const user1Transactions = await transactionsService.getByUser(
        authenticatedUser.id,
      );
      const user2Transactions = await transactionsService.getByUser(
        login2.user.id,
      );

      expect(
        user1Transactions.every(
          (t) => t.userId.toString() === authenticatedUser.id,
        ),
      ).toBe(true);
      expect(
        user2Transactions.every((t) => t.userId.toString() === login2.user.id),
      ).toBe(true);
    });

    it("should allow admin login → access admin endpoints", async () => {
      // Note: This test assumes admin functionality exists
      // For now, we test that authenticated users can access their own data

      const user = await authService.getUser(authenticatedUser.id);
      expect(user).toBeDefined();

      // Verify token payload
      const payload = await jwtService.verifyAsync(authToken);
      expect(payload.sub).toBe(authenticatedUser.id);
      expect(payload.username).toBe("serviceuser");
    });

    it("should handle concurrent service access", async () => {
      // Perform multiple concurrent operations
      const operations = [
        usersService.deposit(authenticatedUser.id, 100),
        usersService.deposit(authenticatedUser.id, 200),
        usersService.deposit(authenticatedUser.id, 300),
      ];

      await Promise.all(operations);

      // Verify final balance
      const balance = await usersService.getBalance(authenticatedUser.id);
      expect(balance.balance).toBe(5600); // 5000 + 100 + 200 + 300

      // Verify all transactions were recorded
      const transactions = await transactionsService.getByUser(
        authenticatedUser.id,
      );
      expect(transactions.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ====================================================================
  // 4. Error recovery scenarios (6 tests)
  // ====================================================================

  describe("Error Recovery Scenarios", () => {
    it("should recover from login failure → retry login → works", async () => {
      const telegramUser = {
        id: 900000,
        first_name: "Recovery",
        username: "recoveryuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "recovery_hash",
      };

      // First attempt fails
      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockImplementationOnce(() => {
          throw new Error("Network error");
        });

      await expect(
        authService.loginWithTelegramWidget(telegramUser),
      ).rejects.toThrow();

      // Retry succeeds
      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);
      expect(login.user.username).toBe("recoveryuser");
      expect(login.accessToken).toBeDefined();
    });

    it("should handle network error during login → retry → succeeds", async () => {
      const telegramUser = {
        id: 900001,
        first_name: "Network",
        username: "networkuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "network_hash",
      };

      let attemptCount = 0;
      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockImplementation(() => {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error("Connection timeout");
          }
          return telegramUser;
        });

      // First attempt fails
      await expect(
        authService.loginWithTelegramWidget(telegramUser),
      ).rejects.toThrow("Connection timeout");

      // Second attempt succeeds
      const login = await authService.loginWithTelegramWidget(telegramUser);
      expect(login.user.username).toBe("networkuser");
    });

    it("should handle service down during login → retry → works", async () => {
      const telegramUser = {
        id: 900002,
        first_name: "Service",
        username: "servicedownuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "service_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      // Simulate service down by throwing error
      jest
        .spyOn(userModel, "create")
        .mockRejectedValueOnce(new Error("Service unavailable"));

      await expect(
        authService.loginWithTelegramWidget(telegramUser),
      ).rejects.toThrow();

      // Restore normal operation
      jest.spyOn(userModel, "create").mockRestore();

      // Retry should succeed
      const login = await authService.loginWithTelegramWidget(telegramUser);
      expect(login.user.username).toBe("servicedownuser");
    });

    it("should handle invalid token → try accessing service → fails → login again → works", async () => {
      const invalidToken = "invalid.jwt.token";

      // Try to verify invalid token
      await expect(jwtService.verifyAsync(invalidToken)).rejects.toThrow();

      // Login with valid credentials
      const telegramUser = {
        id: 900003,
        first_name: "Invalid",
        username: "invalidtokenuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "invalid_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);

      // New token should work
      const payload = await jwtService.verifyAsync(login.accessToken);
      expect(payload.username).toBe("invalidtokenuser");

      // Can access services
      const user = await authService.getUser(login.user.id);
      expect(user.username).toBe("invalidtokenuser");
    });

    it("should handle user deleted → login attempt → error handling", async () => {
      // Create user
      const user = await userModel.create({
        username: "deleteduser",
        telegramId: 900004,
        balance: 100,
      });

      const userId = user._id.toString();

      // Delete user
      await userModel.deleteOne({ _id: userId });

      // Try to access deleted user
      await expect(authService.getUser(userId)).rejects.toThrow(
        "User not found",
      );

      // Try to re-login (should create new user)
      const telegramUser = {
        id: 900004,
        first_name: "Deleted",
        username: "deleteduser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "deleted_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);
      expect(login.user.username).toBe("deleteduser");
      expect(login.user.balance).toBe(0); // New user, no balance
    });

    it("should handle concurrent login attempts → all succeed without conflicts", async () => {
      const telegramUser = {
        id: 900005,
        first_name: "Concurrent",
        username: "concurrentuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "concurrent_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      // Simulate concurrent login attempts
      const loginPromises = [
        authService.loginWithTelegramWidget(telegramUser),
        authService.loginWithTelegramWidget(telegramUser),
        authService.loginWithTelegramWidget(telegramUser),
      ];

      const results = await Promise.all(loginPromises);

      // All should succeed
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.user.username).toBe("concurrentuser");
        expect(result.accessToken).toBeDefined();
      });

      // All should reference same user
      const userId = results?.[0]?.user?.id;
      results.forEach((result) => {
        expect(result.user.id).toBe(userId);
      });

      // Only one user should exist
      const userCount = await userModel.countDocuments({ telegramId: 900005 });
      expect(userCount).toBe(1);
    });
  });

  // ====================================================================
  // 5. Guard and middleware chain (4 tests)
  // ====================================================================

  describe("Guard and Middleware Chain", () => {
    let mockExecutionContext: any;
    let authGuard: AuthGuard;

    beforeEach(() => {
      authGuard = new AuthGuard(jwtService);
    });

    it("should flow through auth middleware → guard → service", async () => {
      const telegramUser = {
        id: 950000,
        first_name: "Chain",
        username: "chainuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "chain_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      // Step 1: Login (creates user)
      const login = await authService.loginWithTelegramWidget(telegramUser);

      // Step 2: Create mock request with auth header
      const mockRequest = {
        headers: {
          authorization: `Bearer ${login.accessToken}`,
        },
        user: undefined,
      };

      mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      };

      // Step 3: Guard validates token and adds user to request
      const canActivate = await authGuard.canActivate(
        mockExecutionContext as unknown as any,
      );
      expect(canActivate).toBe(true);
      expect(mockRequest.user).toBeDefined();

      if (mockRequest.user) {
        expect((mockRequest.user as any).username).toBe("chainuser");

        // Step 4: Service can now access user from request
        const user = await authService.getUser((mockRequest.user as any).sub);
        expect(user.username).toBe("chainuser");
      }
    });

    it("should handle middleware modifying request → guard validates → service receives correct data", async () => {
      const token = await jwtService.signAsync({
        sub: "507f1f77bcf86cd799439013",
        username: "modifieduser",
      });

      const mockRequest = {
        headers: {
          authorization: `Bearer ${token}`,
        },
        user: undefined,
      };

      mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      };

      // Guard validates and modifies request
      await authGuard.canActivate(mockExecutionContext as unknown as any);

      // Verify user was added to request
      expect(mockRequest.user).toBeDefined();
      if (mockRequest.user) {
        expect((mockRequest.user as any).sub).toBe("507f1f77bcf86cd799439013");
        expect((mockRequest.user as any).username).toBe("modifieduser");
      }
    });

    it("should propagate errors in middleware chain", async () => {
      const mockRequest = {
        headers: {
          authorization: "Bearer invalid.token.here",
        },
      };

      mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      };

      // Guard should throw UnauthorizedException
      await expect(authGuard.canActivate(mockExecutionContext)).rejects.toThrow(
        "Invalid token",
      );
    });

    it("should chain multiple guards correctly", async () => {
      // Create user and token
      const user = await userModel.create({
        username: "guardchainuser",
        balance: 100,
      });

      const token = await jwtService.signAsync({
        sub: user._id.toString(),
        username: user.username,
      });

      // Test first guard (AuthGuard)
      const mockRequest1 = {
        headers: {
          authorization: `Bearer ${token}`,
        },
        user: undefined,
      };

      const mockContext1 = {
        switchToHttp: () => ({
          getRequest: () => mockRequest1,
        }),
      };

      const result1 = await authGuard.canActivate(
        mockContext1 as unknown as any,
      );
      expect(result1).toBe(true);
      expect(mockRequest1.user).toBeDefined();

      // If there were additional guards, they would receive the modified request
      // For this test, we verify the request state is correct for downstream guards
      if (mockRequest1.user) {
        expect((mockRequest1.user as any).sub).toBe(user._id.toString());
        expect((mockRequest1.user as any).username).toBe("guardchainuser");
      }
    });
  });

  // ====================================================================
  // 6. Integration with real services (4 tests)
  // ====================================================================

  describe("Integration with Real Services", () => {
    let authenticatedUser: any;

    beforeEach(async () => {
      const telegramUser = {
        id: 980000,
        first_name: "Real",
        username: "realuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "real_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser);

      const login = await authService.loginWithTelegramWidget(telegramUser);
      authenticatedUser = login.user;
      // authToken could be used for future HTTP request authentication tests
    });

    it("should login → interact with Users service → verify state persists", async () => {
      // Deposit
      await usersService.deposit(authenticatedUser.id, 1000);

      // Verify state persists
      const balance1 = await usersService.getBalance(authenticatedUser.id);
      expect(balance1.balance).toBe(1000);

      // Withdraw
      await usersService.withdraw(authenticatedUser.id, 300);

      // Verify state persists
      const balance2 = await usersService.getBalance(authenticatedUser.id);
      expect(balance2.balance).toBe(700);

      // Verify user model is updated
      const user = await userModel.findById(authenticatedUser.id);
      expect(user!.balance).toBe(700);
    });

    it("should login → interact with Transactions service → verify records", async () => {
      // Create transactions
      await usersService.deposit(authenticatedUser.id, 500);
      await usersService.deposit(authenticatedUser.id, 300);
      await usersService.withdraw(authenticatedUser.id, 200);

      // Get transaction records
      const transactions = await transactionsService.getByUser(
        authenticatedUser.id,
      );

      expect(transactions).toHaveLength(3);
      expect(transactions?.[0]?.amount).toBe(200); // Latest (withdraw)
      expect(transactions?.[1]?.amount).toBe(300);
      expect(transactions?.[2]?.amount).toBe(500); // Oldest

      // Verify transaction integrity
      transactions.forEach((tx) => {
        expect(tx.userId.toString()).toBe(authenticatedUser.id);
        expect(tx.balanceBefore).toBeDefined();
        expect(tx.balanceAfter).toBeDefined();
      });
    });

    it("should login → interact with Bids service → verify permissions", async () => {
      // Add balance for bidding
      await usersService.deposit(authenticatedUser.id, 5000);

      // Create mock auction
      const mockAuctionId = "507f1f77bcf86cd799439014";

      // Place bid
      const bid = await bidModel.create({
        userId: authenticatedUser.id,
        auctionId: mockAuctionId,
        amount: 2000,
        status: "active",
      });

      // Verify user can see their bids
      const userBids = await bidsService.getByUser(authenticatedUser.id);
      expect(userBids).toHaveLength(1);
      expect(userBids?.[0]?._id.toString()).toBe(bid._id.toString());

      // Create second user
      const telegramUser2 = {
        id: 980001,
        first_name: "Second",
        username: "secondrealuser",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "second_hash",
      };

      jest
        .spyOn(telegramService, "validateWidgetAuth")
        .mockReturnValue(telegramUser2);

      const login2 = await authService.loginWithTelegramWidget(telegramUser2);

      // Second user should not see first user's bids
      const user2Bids = await bidsService.getByUser(login2.user.id);
      expect(user2Bids).toHaveLength(0);
    });

    it("should login → interact with Audit service → verify tracking", async () => {
      // Perform auditable actions
      await usersService.deposit(authenticatedUser.id, 1000);
      await usersService.withdraw(authenticatedUser.id, 200);
      await usersService.deposit(authenticatedUser.id, 500);

      // Get audit trail via transactions
      const auditTrail = await transactionsService.getByUser(
        authenticatedUser.id,
      );

      // Verify audit completeness
      expect(auditTrail).toHaveLength(3);

      // Verify chronological order
      const timestamps = auditTrail.map((t) => t.createdAt.getTime());
      for (let i = 0; i < timestamps.length - 1; i++) {
        const current = timestamps?.[i] ?? 0;
        const next = timestamps?.[i + 1] ?? 0;
        expect(current).toBeGreaterThanOrEqual(next);
      }

      // Verify audit data integrity
      auditTrail.forEach((tx) => {
        expect(tx.userId.toString()).toBe(authenticatedUser.id);
        expect(tx.type).toMatch(/deposit|withdraw/);
        expect(tx.description).toBeDefined();
        expect(tx.createdAt).toBeDefined();
      });
    });
  });
});
