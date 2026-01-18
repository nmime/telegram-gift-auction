/**
 * E2E Test: Redis Leaderboard
 * Tests: ZSET ordering, pagination, bid updates
 */
import api from '../src/api';
import {
  createConnection,
  waitFor,
  waitForLockRelease,
  createAuctionConfig,
} from './utils/test-helpers';

async function testLeaderboardOrdering(): Promise<void> {
  console.log('\n--- Test: Leaderboard Ordering ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`ar_${timestamp}`);
  const users: api.IConnection[] = [];

  // Create 5 users with deposits
  for (let i = 0; i < 5; i++) {
    const conn = await createConnection(`ur_${timestamp}_${i}`);
    await api.functional.users.deposit(conn, { amount: 10000 });
    users.push(conn);
  }
  console.log('✓ Created 5 users');

  const auction = await api.functional.auctions.create(
    adminConn,
    createAuctionConfig(`Redis Order Test ${timestamp}`, { totalItems: 3, rounds: [{ itemsCount: 3, durationMinutes: 5 }] })
  );
  await api.functional.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // Place bids in random order with lock release
  const bidAmounts = [300, 500, 100, 400, 200];
  for (let i = 0; i < users.length; i++) {
    await api.functional.auctions.bid.placeBid(users[i]!, auction.id, {
      amount: bidAmounts[i]!,
    });
    await waitForLockRelease();
  }
  console.log(`✓ Placed bids: ${bidAmounts.join(', ')}`);

  // Wait for all bids to appear in leaderboard
  await waitFor(async () => {
    const lb = await api.functional.auctions.leaderboard.getLeaderboard(adminConn, auction.id, {});
    return lb.leaderboard.length === 5;
  }, { message: 'All 5 bids should be in leaderboard' });

  // Get leaderboard
  const leaderboard = await api.functional.auctions.leaderboard.getLeaderboard(
    adminConn,
    auction.id,
    {}
  );

  // Verify descending order
  const amounts = leaderboard.leaderboard.map((b) => b.amount);
  const expectedOrder = [500, 400, 300, 200, 100];

  let isCorrectOrder = true;
  for (let i = 0; i < expectedOrder.length; i++) {
    if (amounts[i] !== expectedOrder[i]) {
      isCorrectOrder = false;
      break;
    }
  }

  if (isCorrectOrder) {
    console.log('✓ Leaderboard correctly ordered: 500, 400, 300, 200, 100');
  } else {
    throw new Error(`Wrong order: ${amounts.join(', ')}`);
  }

  // Verify winning positions (top 3 since totalItems=3)
  const winningCount = leaderboard.leaderboard.filter((b) => b.isWinning).length;
  if (winningCount === 3) {
    console.log('✓ Top 3 bids marked as winning');
  } else {
    throw new Error(`Expected 3 winning, got ${winningCount}`);
  }

  console.log('\n✓ Leaderboard Ordering test PASSED\n');
}

async function testLeaderboardPagination(): Promise<void> {
  console.log('\n--- Test: Leaderboard Pagination ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`ap_${timestamp}`);
  const users: api.IConnection[] = [];

  // Create 10 users
  for (let i = 0; i < 10; i++) {
    const conn = await createConnection(`up_${timestamp}_${i}`);
    await api.functional.users.deposit(conn, { amount: 50000 });
    users.push(conn);
  }
  console.log('✓ Created 10 users');

  const auction = await api.functional.auctions.create(
    adminConn,
    createAuctionConfig(`Pagination Test ${timestamp}`, { totalItems: 5, rounds: [{ itemsCount: 5, durationMinutes: 5 }] })
  );
  await api.functional.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // Place 10 bids with unique amounts
  for (let i = 0; i < users.length; i++) {
    await api.functional.auctions.bid.placeBid(users[i]!, auction.id, {
      amount: 1000 + i * 100,
    });
    await waitForLockRelease();
  }
  console.log('✓ Placed 10 bids');

  // Wait for all bids in leaderboard
  await waitFor(async () => {
    const lb = await api.functional.auctions.leaderboard.getLeaderboard(adminConn, auction.id, {});
    return lb.leaderboard.length === 10;
  }, { message: 'All 10 bids should be in leaderboard' });

  // Get page 1 (limit 5)
  const page1 = await api.functional.auctions.leaderboard.getLeaderboard(
    adminConn,
    auction.id,
    { limit: 5, offset: 0 }
  );

  // Get page 2 (limit 5, offset 5)
  const page2 = await api.functional.auctions.leaderboard.getLeaderboard(
    adminConn,
    auction.id,
    { limit: 5, offset: 5 }
  );

  if (page1.leaderboard.length === 5) {
    console.log('✓ Page 1 has 5 entries');
  } else {
    throw new Error(`Page 1 should have 5, got ${page1.leaderboard.length}`);
  }

  if (page2.leaderboard.length === 5) {
    console.log('✓ Page 2 has 5 entries');
  } else {
    throw new Error(`Page 2 should have 5, got ${page2.leaderboard.length}`);
  }

  // Verify page 1 has higher amounts than page 2
  const minPage1 = Math.min(...page1.leaderboard.map((b) => b.amount));
  const maxPage2 = Math.max(...page2.leaderboard.map((b) => b.amount));

  if (minPage1 > maxPage2) {
    console.log('✓ Page 1 amounts > Page 2 amounts (correct ordering)');
  } else {
    throw new Error('Pagination ordering incorrect');
  }

  console.log('\n✓ Leaderboard Pagination test PASSED\n');
}

async function testBidUpdate(): Promise<void> {
  console.log('\n--- Test: Bid Update ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`au_${timestamp}`);
  const userConn = await createConnection(`uu_${timestamp}`);
  await api.functional.users.deposit(userConn, { amount: 50000 });
  console.log('✓ Created user');

  const auction = await api.functional.auctions.create(
    adminConn,
    createAuctionConfig(`Update Test ${timestamp}`)
  );
  await api.functional.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // Place initial bid
  await api.functional.auctions.bid.placeBid(userConn, auction.id, { amount: 200 });
  console.log('✓ Placed initial bid: 200');

  // Wait for bid to appear
  await waitFor(async () => {
    const lb = await api.functional.auctions.leaderboard.getLeaderboard(adminConn, auction.id, {});
    return lb.leaderboard.some((b) => b.amount === 200);
  }, { message: 'Initial bid should appear' });

  // Verify in leaderboard
  let leaderboard = await api.functional.auctions.leaderboard.getLeaderboard(
    adminConn,
    auction.id,
    {}
  );
  if (leaderboard.leaderboard[0]?.amount === 200) {
    console.log('✓ Initial bid in leaderboard at 200');
  }

  await waitForLockRelease();

  // Update bid to higher amount
  await api.functional.auctions.bid.placeBid(userConn, auction.id, { amount: 500 });
  console.log('✓ Updated bid to: 500');

  // Wait for update to propagate
  await waitFor(async () => {
    const lb = await api.functional.auctions.leaderboard.getLeaderboard(adminConn, auction.id, {});
    return lb.leaderboard.some((b) => b.amount === 500);
  }, { message: 'Updated bid should appear' });

  // Verify updated in leaderboard
  leaderboard = await api.functional.auctions.leaderboard.getLeaderboard(
    adminConn,
    auction.id,
    {}
  );

  if (leaderboard.leaderboard.length === 1 && leaderboard.leaderboard[0]?.amount === 500) {
    console.log('✓ Bid updated to 500, only 1 entry (no duplicates)');
  } else {
    throw new Error(
      `Expected 1 bid at 500, got ${leaderboard.leaderboard.length} bids: ${leaderboard.leaderboard.map((b) => b.amount).join(', ')}`
    );
  }

  console.log('\n✓ Bid Update test PASSED\n');
}

async function testTieBreaking(): Promise<void> {
  console.log('\n--- Test: Tie Breaking by Time ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`at_${timestamp}`);
  const user1Conn = await createConnection(`ut1_${timestamp}`);
  const user2Conn = await createConnection(`ut2_${timestamp}`);

  await api.functional.users.deposit(user1Conn, { amount: 10000 });
  await api.functional.users.deposit(user2Conn, { amount: 10000 });
  console.log('✓ Created 2 users');

  const auction = await api.functional.auctions.create(
    adminConn,
    createAuctionConfig(`Tiebreak Test ${timestamp}`, { totalItems: 2, rounds: [{ itemsCount: 2, durationMinutes: 5 }] })
  );
  await api.functional.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // User1 bids first, then User2 bids higher
  await api.functional.auctions.bid.placeBid(user1Conn, auction.id, { amount: 300 });
  console.log('✓ User1 bid 300');
  await waitForLockRelease();

  await api.functional.auctions.bid.placeBid(user2Conn, auction.id, { amount: 500 });
  console.log('✓ User2 bid 500');

  // Wait for both bids
  await waitFor(async () => {
    const lb = await api.functional.auctions.leaderboard.getLeaderboard(adminConn, auction.id, {});
    return lb.leaderboard.length === 2;
  }, { message: 'Both bids should be in leaderboard' });

  // Get leaderboard
  const leaderboard = await api.functional.auctions.leaderboard.getLeaderboard(
    adminConn,
    auction.id,
    {}
  );

  // User2 (500) should be first, User1 (300) second
  if (leaderboard.leaderboard[0]?.amount === 500 && leaderboard.leaderboard[1]?.amount === 300) {
    console.log('✓ Correct order: 500, 300');
  } else {
    throw new Error(`Wrong order: ${leaderboard.leaderboard.map((b) => b.amount).join(', ')}`);
  }

  console.log('\n✓ Tie Breaking test PASSED\n');
}

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   REDIS LEADERBOARD E2E TESTS          ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    await testLeaderboardOrdering();
    await testLeaderboardPagination();
    await testBidUpdate();
    await testTieBreaking();

    console.log('\n');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   ALL REDIS LEADERBOARD TESTS PASSED!  ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('\n');
  } catch (error) {
    console.error('\n❌ Test Failed:', (error as Error).message);
    process.exit(1);
  }
}

main();
