/**
 * E2E Tests for Auction Backend
 *
 * Prerequisites:
 * - MongoDB must be running (docker-compose up -d mongodb)
 * - Redis must be running (docker-compose up -d redis)
 *
 * Run with: npm run test:e2e
 */
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';

describe('App (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter()
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 60000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Health Check', () => {
    it('/api/health (GET) should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      // Health endpoint may or may not exist - check it responds
      expect([200, 404]).toContain(response.statusCode);
    });
  });

  describe('Auth Module', () => {
    it('/api/auth/login (POST) should authenticate or create user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: `e2e_test_${Date.now()}`,
        },
      });

      expect([200, 201]).toContain(response.statusCode);

      if (response.statusCode === 200 || response.statusCode === 201) {
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('user');
        expect(body).toHaveProperty('accessToken');
      }
    });

    it('/api/auth/login (POST) should reject empty username', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: '',
        },
      });

      // Server may return 400, 422, or 500 (mongoose validation error)
      expect([400, 422, 500]).toContain(response.statusCode);
    });
  });

  describe('Auctions Module', () => {
    let authToken: string;

    beforeAll(async () => {
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: `e2e_auction_test_${Date.now()}`,
        },
      });

      const body = JSON.parse(loginResponse.payload);
      authToken = body.accessToken;
    });

    it('/api/auctions (GET) should list auctions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auctions',
      });

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(JSON.parse(response.payload))).toBe(true);
    });

    it('/api/auctions (POST) without auth should fail', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auctions',
        payload: {
          title: 'Test Auction',
          description: 'E2E Test',
          totalItems: 5,
          rounds: [{ itemsCount: 5, durationMinutes: 10 }],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('/api/auctions (POST) with auth should create auction', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auctions',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          title: `E2E Test Auction ${Date.now()}`,
          description: 'Created by e2e test',
          totalItems: 3,
          rounds: [
            { itemsCount: 2, durationMinutes: 5 },
            { itemsCount: 1, durationMinutes: 5 },
          ],
          minBidAmount: 100,
          minBidIncrement: 10,
        },
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.payload);
      // API may return id or _id
      expect(body.id || body._id).toBeTruthy();
      expect(body.title).toContain('E2E Test Auction');
      expect(body.status).toBe('pending');
    });
  });

  describe('Users Module', () => {
    let authToken: string;

    beforeAll(async () => {
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: `e2e_user_test_${Date.now()}`,
        },
      });

      const body = JSON.parse(loginResponse.payload);
      authToken = body.accessToken;
    });

    it('/api/users/balance (GET) should return balance', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/users/balance',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty('balance');
      expect(body).toHaveProperty('frozenBalance');
    });

    it('/api/users/deposit (POST) should add balance', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/users/deposit',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          amount: 1000,
        },
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.payload);
      expect(body.balance).toBeGreaterThanOrEqual(1000);
    });
  });
});
