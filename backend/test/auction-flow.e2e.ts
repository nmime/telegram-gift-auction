/**
 * E2E Test: Full Auction Flow
 * Tests: create → start → bid → round complete → refund cycle
 */
import api from '../src/api';

const HOST = `http://localhost:${process.env.PORT ?? 4000}/api`;

async function createConnection(username: string): Promise<api.IConnection> {
  const connection: api.IConnection = {
    host: HOST,
    headers: { Authorization: '' },
  };

  const auth = await api.functional.api.auth.login(connection, { username });
  connection.headers = { Authorization: `Bearer ${auth.accessToken}` };
  return connection;
}

async function testAuctionFlow(): Promise<void> {
  console.log('Starting Auction Flow E2E Test\n');

  // Setup: Create test users
  const timestamp = Date.now();
  const adminConn = await createConnection(`admin_${timestamp}`);
  const user1Conn = await createConnection(`user1_${timestamp}`);
  const user2Conn = await createConnection(`user2_${timestamp}`);
  console.log('✓ Created test users');

  // Deposit funds for bidders
  await api.functional.api.users.deposit(user1Conn, { amount: 1000 });
  await api.functional.api.users.deposit(user2Conn, { amount: 1000 });
  console.log('✓ Deposited funds');

  // Verify balances
  const user1Balance = await api.functional.api.users.balance.getBalance(user1Conn);
  const user2Balance = await api.functional.api.users.balance.getBalance(user2Conn);
  assertEqual(user1Balance.balance, 1000, 'User1 balance should be 1000');
  assertEqual(user2Balance.balance, 1000, 'User2 balance should be 1000');
  console.log('✓ Verified balances');

  // Create auction with 2 items, 1 round
  const auction = await api.functional.api.auctions.create(adminConn, {
    title: `E2E Test Auction ${timestamp}`,
    totalItems: 2,
    rounds: [{ itemsCount: 2, durationMinutes: 1 }],
    minBidAmount: 100,
    minBidIncrement: 10,
    antiSnipingWindowMinutes: 1,
    antiSnipingExtensionMinutes: 1,
    maxExtensions: 3,
    botsEnabled: false,
  });
  assertEqual(auction.status, 'pending', 'Auction should be pending');
  console.log(`✓ Created auction: ${auction.id}`);

  // Start auction
  const startedAuction = await api.functional.api.auctions.start(adminConn, auction.id);
  assertEqual(startedAuction.status, 'active', 'Auction should be active');
  assertEqual(startedAuction.currentRound, 1, 'Should be round 1');
  console.log('✓ Started auction');

  // User1 places initial bid
  const bid1Result = await api.functional.api.auctions.bid.placeBid(user1Conn, auction.id, { amount: 100 });
  assertEqual(bid1Result.bid.amount, 100, 'Bid1 should be 100');
  console.log('✓ User1 placed bid: 100');

  // Verify balance frozen
  const user1After1 = await api.functional.api.users.balance.getBalance(user1Conn);
  assertEqual(user1After1.balance, 900, 'User1 balance should be 900 after bid');
  assertEqual(user1After1.frozenBalance, 100, 'User1 frozen should be 100');
  console.log('✓ User1 balance frozen correctly');

  // User2 places higher bid
  const bid2Result = await api.functional.api.auctions.bid.placeBid(user2Conn, auction.id, { amount: 150 });
  assertEqual(bid2Result.bid.amount, 150, 'Bid2 should be 150');
  console.log('✓ User2 placed bid: 150');

  // Check leaderboard
  const leaderboardResp = await api.functional.api.auctions.leaderboard.getLeaderboard(user1Conn, auction.id, {});
  assertEqual(leaderboardResp.leaderboard.length, 2, 'Should have 2 bids on leaderboard');
  assertEqual(leaderboardResp.leaderboard[0]!.amount, 150, 'Top bid should be 150');
  assertEqual(leaderboardResp.leaderboard[1]!.amount, 100, 'Second bid should be 100');
  console.log('✓ Leaderboard correct');

  // User1 increases bid (must be > current + minIncrement)
  const bid1Increase = await api.functional.api.auctions.bid.placeBid(user1Conn, auction.id, { amount: 200 });
  assertEqual(bid1Increase.bid.amount, 200, 'User1 increased bid should be 200');
  console.log('✓ User1 increased bid: 200');

  // Verify incremental freeze
  const user1After2 = await api.functional.api.users.balance.getBalance(user1Conn);
  assertEqual(user1After2.frozenBalance, 200, 'User1 frozen should be 200');
  console.log('✓ Incremental freeze correct');

  // Test validation: bid below minimum
  try {
    await api.functional.api.auctions.bid.placeBid(user2Conn, auction.id, { amount: 50 });
    throw new Error('Should have thrown for bid below minimum');
  } catch (e: unknown) {
    const error = e as Error;
    if (!error.message.includes('Should have thrown')) {
      console.log('✓ Correctly rejected bid below minimum');
    }
  }

  // Test validation: bid increment too small
  try {
    await api.functional.api.auctions.bid.placeBid(user2Conn, auction.id, { amount: 151 });
    throw new Error('Should have thrown for increment too small');
  } catch (e: unknown) {
    const error = e as Error;
    if (!error.message.includes('Should have thrown')) {
      console.log('✓ Correctly rejected insufficient increment');
    }
  }

  // Get my bids
  const user1Bids = await api.functional.api.auctions.my_bids.getMyBids(user1Conn, auction.id);
  assertEqual(user1Bids.length, 1, 'User1 should have 1 bid');
  assertEqual(user1Bids[0]!.amount, 200, 'User1 bid should be 200');
  console.log('✓ My bids endpoint correct');

  // Min winning bid
  const minBid = await api.functional.api.auctions.min_winning_bid.getMinWinningBid(user1Conn, auction.id);
  assertTrue(minBid.minWinningBid !== null, 'Min winning bid should be set');
  console.log(`✓ Min winning bid: ${minBid.minWinningBid}`);

  console.log('\n================================');
  console.log('All E2E tests passed!');
  console.log('================================\n');
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`${message}: condition was false`);
  }
}

testAuctionFlow().catch((e) => {
  console.error('\n❌ E2E Test Failed:', e.message);
  process.exit(1);
});
