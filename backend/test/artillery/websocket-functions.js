/**
 * Artillery WebSocket Test Functions
 * Direct MongoDB authentication for WebSocket/Socket.IO testing
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://auction:prod-mongo-password@localhost:27017/auction?replicaSet=rs0&authSource=admin';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-for-local-testing-32chars';
const API_URL = process.env.API_URL || 'http://localhost:4000';

// Shared state
let wsState = {
  mongoClient: null,
  bidCounter: 0,
  connectedUsers: 0,
  auctionId: null,
  userCounter: 0,
};

/**
 * Get MongoDB client (reused)
 */
async function getMongoClient() {
  if (!wsState.mongoClient) {
    wsState.mongoClient = new MongoClient(MONGODB_URI);
    await wsState.mongoClient.connect();
  }
  return wsState.mongoClient;
}

/**
 * Generate a JWT token
 */
function generateToken(userId, username, telegramId) {
  const payload = {
    sub: userId,
    username: username,
    telegramId: telegramId,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Create a test user directly in MongoDB
 */
async function createTestUser(username) {
  const client = await getMongoClient();
  const db = client.db('auction');
  const users = db.collection('users');

  const telegramId = Math.floor(Math.random() * 1000000000) + 1000000;

  let user = await users.findOne({ username });

  if (!user) {
    const result = await users.insertOne({
      username,
      telegramId,
      firstName: `WS_${username}`,
      balance: 0,
      frozenBalance: 0,
      isPremium: false,
      languageCode: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    user = { _id: result.insertedId, username, telegramId };
  }

  const token = generateToken(user._id.toString(), username, telegramId);
  return { user, token };
}

/**
 * Setup WebSocket test - creates auction if needed
 */
function setupWsTest(userContext, events, done) {
  (async () => {
    try {
      // Create admin user
      const adminUsername = `ws_admin_${Date.now()}`;
      const { token } = await createTestUser(adminUsername);

      // Deposit funds
      await fetch(`${API_URL}/api/users/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: 1000000 }),
      });

      // Create auction
      const auctionResponse = await fetch(`${API_URL}/api/auctions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: `WS_Test_${Date.now()}`,
          description: 'WebSocket test auction',
          totalItems: 5,
          rounds: [
            { itemsCount: 3, durationMinutes: 30 },
            { itemsCount: 2, durationMinutes: 30 },
          ],
          minBidAmount: 100,
          minBidIncrement: 10,
          antiSnipingWindowMinutes: 1,
          antiSnipingExtensionMinutes: 1,
          maxExtensions: 5,
          botsEnabled: false,
        }),
      });

      if (auctionResponse.ok) {
        const auctionData = await auctionResponse.json();
        wsState.auctionId = auctionData.id;

        // Start auction
        await fetch(`${API_URL}/api/auctions/${auctionData.id}/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });

        userContext.vars.auctionId = auctionData.id;
        console.log(`[WebSocket Test] Auction created: ${auctionData.id}`);
      }

      done();
    } catch (error) {
      console.error('setupWsTest error:', error.message);
      done();
    }
  })();
}

/**
 * Before scenario hook - authenticate via direct MongoDB
 */
function beforeScenario(userContext, events, done) {
  (async () => {
    try {
      // Generate unique username
      wsState.userCounter++;
      const username = `ws_${Date.now()}_${wsState.userCounter}_${crypto.randomBytes(3).toString('hex')}`;

      // Create user and get token
      const { user, token } = await createTestUser(username);
      userContext.vars.token = token;
      userContext.vars.userId = user._id.toString();

      // Deposit funds via API
      await fetch(`${API_URL}/api/users/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: 100000 }),
      });

      // Set auction ID
      if (wsState.auctionId) {
        userContext.vars.auctionId = wsState.auctionId;
      } else {
        // Get auction ID if not set
        const auctionResponse = await fetch(`${API_URL}/api/auctions`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (auctionResponse.ok) {
          const auctions = await auctionResponse.json();
          if (auctions.length > 0) {
            userContext.vars.auctionId = auctions[0].id;
            wsState.auctionId = auctions[0].id;
          }
        }
      }

      wsState.connectedUsers++;
      done();
    } catch (error) {
      console.error('beforeScenario error:', error.message);
      done();
    }
  })();
}

/**
 * Generate bid amount for WebSocket bidding
 */
function generateWsBidAmount(userContext, events, done) {
  wsState.bidCounter++;
  const baseAmount = 1000 + (wsState.bidCounter * 10);
  const randomBonus = Math.floor(Math.random() * 100);
  userContext.vars.bidAmount = baseAmount + randomBonus;
  return done();
}

/**
 * Handle auth response
 */
function handleAuthResponse(requestParams, response, context, ee, done) {
  if (response && response.success) {
    ee.emit('counter', 'ws_auth_success', 1);
  } else {
    ee.emit('counter', 'ws_auth_failure', 1);
  }
  return done();
}

/**
 * Handle bid response
 */
function handleBidResponse(requestParams, response, context, ee, done) {
  if (response && response.success) {
    ee.emit('counter', 'ws_bid_success', 1);
  } else {
    ee.emit('counter', 'ws_bid_failure', 1);
  }
  return done();
}

/**
 * Track connection metrics
 */
function trackConnection(userContext, events, done) {
  events.emit('counter', 'ws_connections', 1);
  return done();
}

/**
 * Cleanup on disconnect
 */
function onDisconnect(userContext, events, done) {
  wsState.connectedUsers--;
  events.emit('counter', 'ws_disconnections', 1);
  return done();
}

/**
 * Cleanup
 */
function cleanup(userContext, events, done) {
  console.log('[WebSocket Test] Completed. Connected users:', wsState.connectedUsers, 'Bids:', wsState.bidCounter);
  if (wsState.mongoClient) {
    wsState.mongoClient.close().catch(() => {});
  }
  return done();
}

module.exports = {
  setupWsTest,
  beforeScenario,
  generateWsBidAmount,
  handleAuthResponse,
  handleBidResponse,
  trackConnection,
  onDisconnect,
  cleanup,
};
