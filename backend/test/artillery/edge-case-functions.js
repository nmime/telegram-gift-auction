/**
 * Artillery Edge Case Test Functions
 * Functions for testing edge cases and validation with direct MongoDB auth
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://auction:prod-mongo-password@localhost:27017/auction?replicaSet=rs0&authSource=admin';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-for-local-testing-32chars';
const API_URL = process.env.API_URL || 'http://localhost:4000';

// Shared state
let sharedState = {
  mongoClient: null,
  auctionId: null,
  tieAmount: null,
  userCounter: 0,
};

/**
 * Get MongoDB client
 */
async function getMongoClient() {
  if (!sharedState.mongoClient) {
    sharedState.mongoClient = new MongoClient(MONGODB_URI);
    await sharedState.mongoClient.connect();
  }
  return sharedState.mongoClient;
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
      firstName: `Test_${username}`,
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
 * Setup function - create auction and set shared state
 */
function setupEdgeCaseTest(userContext, events, done) {
  (async () => {
    try {
      // Create admin user directly in MongoDB
      const adminUsername = `edge_admin_${Date.now()}`;
      const { token } = await createTestUser(adminUsername);

      // Deposit
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
          title: `EdgeCase_Test_${Date.now()}`,
          description: 'Edge case testing auction',
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
        sharedState.auctionId = auctionData.id;

        // Start auction
        await fetch(`${API_URL}/api/auctions/${auctionData.id}/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });

        // Set a predetermined tie amount
        sharedState.tieAmount = 5000 + Math.floor(Date.now() / 1000) % 10000;

        userContext.vars.auctionId = auctionData.id;
        console.log(`[Edge Case] Auction created: ${auctionData.id}`);
      }

      done();
    } catch (error) {
      console.error('setupEdgeCaseTest error:', error.message);
      done();
    }
  })();
}

/**
 * Generate unique username
 */
function generateUsername(userContext, events, done) {
  sharedState.userCounter++;
  const timestamp = Date.now();
  const random = crypto.randomBytes(3).toString('hex');
  userContext.vars.username = `edge_${timestamp}_${sharedState.userCounter}_${random}`;

  // Ensure auction ID is set
  if (sharedState.auctionId) {
    userContext.vars.auctionId = sharedState.auctionId;
  }

  return done();
}

/**
 * Login user via direct MongoDB/JWT
 */
function loginUser(userContext, events, done) {
  const username = userContext.vars.username;

  (async () => {
    try {
      const { token } = await createTestUser(username);
      userContext.vars.token = token;
      done();
    } catch (error) {
      console.error('Error in loginUser:', error.message);
      done();
    }
  })();
}

/**
 * Calculate tie amount - same for all VUs to test tie-breaking
 */
function calculateTieAmount(userContext, events, done) {
  // Use shared tie amount so all VUs bid the same
  if (!sharedState.tieAmount) {
    sharedState.tieAmount = 5000 + Math.floor(Date.now() / 1000) % 10000;
  }

  const highestBid = parseInt(userContext.vars.highestBid) || 100;
  userContext.vars.tieAmount = Math.max(sharedState.tieAmount, highestBid + 100);

  return done();
}

/**
 * Validate error response structure - afterResponse hook
 */
function validateErrorResponse(requestParams, response, context, ee, done) {
  if (response.statusCode >= 400 && response.statusCode < 500) {
    try {
      const body = JSON.parse(response.body);
      if (body.message || body.error) {
        ee.emit('counter', 'valid_error_responses', 1);
      } else {
        ee.emit('counter', 'invalid_error_responses', 1);
      }
    } catch {
      ee.emit('counter', 'unparseable_error_responses', 1);
    }
  }
  return done();
}

/**
 * Track validation results
 */
function trackValidation(name, passed) {
  return function(userContext, events, done) {
    if (passed) {
      events.emit('counter', `${name}_passed`, 1);
    } else {
      events.emit('counter', `${name}_failed`, 1);
    }
    return done();
  };
}

/**
 * Cleanup
 */
function cleanup(userContext, events, done) {
  if (sharedState.mongoClient) {
    sharedState.mongoClient.close().catch(() => {});
  }
  return done();
}

module.exports = {
  setupEdgeCaseTest,
  generateUsername,
  loginUser,
  calculateTieAmount,
  validateErrorResponse,
  trackValidation,
  cleanup,
};
