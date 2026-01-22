/**
 * Artillery Custom Functions for Auction Load Testing
 *
 * These functions provide custom logic for:
 * - User generation with JWT tokens
 * - Bid amount calculation
 * - Auction setup via direct MongoDB access
 * - Response validation
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://auction:prod-mongo-password@localhost:27017/auction?replicaSet=rs0&authSource=admin';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-for-local-testing-32chars';
const API_URL = process.env.API_URL || 'http://localhost:4000';

// Shared state across VUs
let sharedState = {
  auctionId: null,
  adminToken: null,
  bidCounter: 0,
  userCounter: 0,
  mongoClient: null,
};

/**
 * Get MongoDB client (reused)
 */
async function getMongoClient() {
  if (!sharedState.mongoClient) {
    sharedState.mongoClient = new MongoClient(MONGODB_URI);
    await sharedState.mongoClient.connect();
  }
  return sharedState.mongoClient;
}

/**
 * Generate a JWT token for a user
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
 * Create a test user directly in MongoDB and return JWT
 */
async function createTestUser(username) {
  const client = await getMongoClient();
  const db = client.db('auction');
  const users = db.collection('users');

  const telegramId = Math.floor(Math.random() * 1000000000) + 1000000;

  // Create or find user
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
 * Generate a unique username for each virtual user
 */
function generateUsername(userContext, events, done) {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  sharedState.userCounter++;
  userContext.vars.username = `artillery_${timestamp}_${sharedState.userCounter}_${random}`;
  return done();
}

/**
 * Generate a bid amount that's likely to be competitive
 */
function generateBidAmount(userContext, events, done) {
  const highestBid = parseInt(userContext.vars.highestBid) || 100;
  const minBidAmount = parseInt(userContext.vars.minBidAmount) || 100;
  const increment = parseInt(userContext.vars.bidIncrement) || 10;

  sharedState.bidCounter++;

  // Generate a competitive bid amount
  const baseAmount = Math.max(highestBid, minBidAmount);
  const randomIncrement = Math.floor(Math.random() * 100) + increment;

  userContext.vars.bidAmount = baseAmount + randomIncrement + (sharedState.bidCounter * 5);
  return done();
}

/**
 * Calculate bid amount based on current highest bid
 */
function calculateBidAmount(userContext, events, done) {
  const highestBid = parseInt(userContext.vars.highestBid) || 0;
  const minBidAmount = parseInt(userContext.vars.minBidAmount) || 100;
  const increment = parseInt(userContext.vars.bidIncrement) || 10;

  // Bid slightly higher than current highest
  const baseAmount = Math.max(highestBid, minBidAmount);
  const randomBonus = Math.floor(Math.random() * 50) + 10;

  userContext.vars.bidAmount = baseAmount + increment + randomBonus;
  return done();
}

/**
 * Create a test auction before running scenarios
 * This runs once at the start of the test
 */
function createTestAuction(userContext, events, done) {
  (async () => {
    try {
      // Create admin user directly in MongoDB
      const adminUsername = `admin_artillery_${Date.now()}`;
      const { user, token } = await createTestUser(adminUsername);
      sharedState.adminToken = token;

      // Deposit funds via API
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
          title: `Artillery_LoadTest_${Date.now()}`,
          description: 'Automated Artillery load test auction',
          totalItems: 10,
          rounds: [
            { itemsCount: 5, durationMinutes: 30 },
            { itemsCount: 5, durationMinutes: 30 },
          ],
          minBidAmount: 100,
          minBidIncrement: 10,
          antiSnipingWindowMinutes: 1,
          antiSnipingExtensionMinutes: 1,
          maxExtensions: 5,
          botsEnabled: false,
        }),
      });

      if (!auctionResponse.ok) {
        const errorText = await auctionResponse.text();
        console.error('Failed to create auction:', errorText);
        return done();
      }

      const auctionData = await auctionResponse.json();
      sharedState.auctionId = auctionData.id;

      // Start the auction
      const startResponse = await fetch(`${API_URL}/api/auctions/${auctionData.id}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (startResponse.ok) {
        console.log(`[Artillery] Created and started auction: ${auctionData.id}`);
        userContext.vars.auctionId = auctionData.id;
      } else {
        console.error('Failed to start auction:', await startResponse.text());
      }

      done();
    } catch (error) {
      console.error('Error in createTestAuction:', error.message);
      done();
    }
  })();
}

/**
 * Login and get token - creates user directly in MongoDB
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
 * Set authorization header for authenticated requests
 */
function setAuthHeader(requestParams, context, ee, done) {
  if (context.vars.token) {
    requestParams.headers = requestParams.headers || {};
    requestParams.headers['Authorization'] = `Bearer ${context.vars.token}`;
  }
  return done();
}

/**
 * Log response details for debugging
 */
function logResponse(requestParams, response, context, ee, done) {
  if (response.statusCode >= 400) {
    console.log(`Request failed: ${response.statusCode} - ${response.body}`);
  }
  return done();
}

/**
 * Validate bid response - hook for afterResponse
 */
function validateBidResponse(requestParams, response, context, ee, done) {
  if (response.statusCode === 200 || response.statusCode === 201) {
    ee.emit('counter', 'successful_bids', 1);
  } else if (response.statusCode === 400) {
    // Expected failures (outbid, insufficient funds, etc.)
    ee.emit('counter', 'rejected_bids', 1);
  } else if (response.statusCode === 429) {
    ee.emit('counter', 'rate_limited', 1);
  } else {
    ee.emit('counter', 'error_bids', 1);
  }
  return done();
}

/**
 * Generate random think time
 */
function randomThink(userContext, events, done) {
  const minMs = 100;
  const maxMs = 500;
  const thinkTime = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  userContext.vars.thinkTime = thinkTime / 1000; // Convert to seconds
  return done();
}

/**
 * Track metrics for custom analysis
 */
function trackMetric(name, value) {
  return function(userContext, events, done) {
    events.emit('histogram', name, value);
    return done();
  };
}

/**
 * Cleanup function to run after tests
 */
function cleanup(userContext, events, done) {
  console.log('[Artillery] Load test completed. Bid counter:', sharedState.bidCounter);
  if (sharedState.mongoClient) {
    sharedState.mongoClient.close().catch(() => {});
  }
  return done();
}

module.exports = {
  generateUsername,
  generateBidAmount,
  calculateBidAmount,
  createTestAuction,
  loginUser,
  setAuthHeader,
  logResponse,
  validateBidResponse,
  randomThink,
  trackMetric,
  cleanup,
};
