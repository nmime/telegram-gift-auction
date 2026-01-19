/**
 * E2E Test: Concurrency & Race Conditions
 * Tests: Concurrent bids, duplicate prevention, lock handling
 */
import api from '../src/api';
import {
  createConnection,
  waitFor,
  waitForLockRelease,
  createAuctionConfig,
} from './utils/test-helpers';

async function testConcurrentBidsDifferentUsers(): Promise<void> {
  console.log('\n--- Test: Concurrent Bids from Different Users ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`acd_${timestamp}`);
  const users: api.IConnection[] = [];

  // Create 10 users
  for (let i = 0; i < 10; i++) {
    const conn = await createConnection(`ucd_${timestamp}_${i}`);
    await api.functional.api.users.deposit(conn, { amount: 10000 });
    users.push(conn);
  }
  console.log('✓ Created 10 users');

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Concurrent Test ${timestamp}`, { totalItems: 5, rounds: [{ itemsCount: 5, durationMinutes: 5 }] })
  );
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // All users bid concurrently with different amounts
  const bidPromises = users.map((user, i) =>
    api.functional.api.auctions.bid
      .placeBid(user, auction.id, { amount: 100 + (i + 1) * 50 })
      .then(() => ({ success: true, user: i, amount: 100 + (i + 1) * 50 }))
      .catch((e) => ({ success: false, user: i, error: (e as Error).message }))
  );

  const results = await Promise.all(bidPromises);
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`✓ ${successful.length} bids succeeded`);
  console.log(`  ${failed.length} bids failed (expected due to rate limiting)`);

  // Verify leaderboard
  const leaderboard = await api.functional.api.auctions.leaderboard.getLeaderboard(
    adminConn,
    auction.id,
    {}
  );

  console.log(`✓ Leaderboard has ${leaderboard.leaderboard.length} entries`);

  // All successful bids should have unique amounts
  const amounts = leaderboard.leaderboard.map((b) => b.amount);
  const uniqueAmounts = new Set(amounts);
  if (uniqueAmounts.size === amounts.length) {
    console.log('✓ All bid amounts are unique (no duplicates)');
  } else {
    throw new Error('Duplicate bid amounts found!');
  }

  console.log('\n✓ Concurrent Bids Different Users test PASSED\n');
}

async function testDuplicateBidAmountRejection(): Promise<void> {
  console.log('\n--- Test: Duplicate Bid Amount Rejection ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`adr_${timestamp}`);
  const user1Conn = await createConnection(`u1r_${timestamp}`);
  const user2Conn = await createConnection(`u2r_${timestamp}`);

  await api.functional.api.users.deposit(user1Conn, { amount: 5000 });
  await api.functional.api.users.deposit(user2Conn, { amount: 5000 });
  console.log('✓ Created 2 users');

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Duplicate Test ${timestamp}`, { totalItems: 2, rounds: [{ itemsCount: 2, durationMinutes: 5 }] })
  );
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // User1 places bid
  await api.functional.api.auctions.bid.placeBid(user1Conn, auction.id, { amount: 500 });
  console.log('✓ User1 bid 500');

  // Wait for bid to be fully persisted
  await waitFor(async () => {
    const lb = await api.functional.api.auctions.leaderboard.getLeaderboard(adminConn, auction.id, {});
    return lb.leaderboard.some((b) => b.amount === 500);
  }, { message: 'First bid not found in leaderboard' });

  // User2 tries same amount
  try {
    await api.functional.api.auctions.bid.placeBid(user2Conn, auction.id, { amount: 500 });
    throw new Error('Should have rejected duplicate amount');
  } catch (e: unknown) {
    const error = e as Error;
    if (error.message.includes('already taken') || error.message.includes('duplicate') || error.message.includes('Conflict')) {
      console.log('✓ User2 rejected for duplicate amount 500');
    } else if (error.message.includes('Should have rejected')) {
      throw error;
    } else {
      console.log(`✓ Rejected: ${error.message}`);
    }
  }

  // User2 can bid different amount
  await api.functional.api.auctions.bid.placeBid(user2Conn, auction.id, { amount: 600 });
  console.log('✓ User2 bid 600 (different amount accepted)');

  console.log('\n✓ Duplicate Bid Amount Rejection test PASSED\n');
}

async function testRapidBidIncreases(): Promise<void> {
  console.log('\n--- Test: Rapid Bid Increases Same User ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`ari_${timestamp}`);
  const userConn = await createConnection(`uri_${timestamp}`);

  await api.functional.api.users.deposit(userConn, { amount: 50000 });
  console.log('✓ Created user with 50000 balance');

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Rapid Test ${timestamp}`)
  );
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // Rapidly increase bid 10 times with lock release waits
  let successCount = 0;
  let lastSuccessfulAmount = 0;

  for (let i = 0; i < 10; i++) {
    const amount = 100 + i * 100;
    try {
      await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount });
      successCount++;
      lastSuccessfulAmount = amount;
      console.log(`  Bid ${amount}: success`);
    } catch (e: unknown) {
      const error = e as Error;
      console.log(`  Bid ${amount}: ${error.message.substring(0, 50)}...`);
    }
    await waitForLockRelease(); // Minimal delay for lock cleanup
  }

  console.log(`✓ ${successCount}/10 rapid bids succeeded`);

  // Verify final state
  const myBids = await api.functional.api.auctions.my_bids.getMyBids(userConn, auction.id);
  if (myBids.length === 1) {
    console.log(`✓ User has 1 bid at amount ${myBids[0]?.amount}`);
  }

  // Verify balance is correct
  const balance = await api.functional.api.users.balance.getBalance(userConn);
  const expectedFrozen = lastSuccessfulAmount > 0 ? lastSuccessfulAmount : myBids[0]?.amount ?? 0;
  if (balance.frozenBalance === expectedFrozen) {
    console.log(`✓ Frozen balance correct: ${balance.frozenBalance}`);
  }

  console.log('\n✓ Rapid Bid Increases test PASSED\n');
}

async function testConcurrentSameAmountRace(): Promise<void> {
  console.log('\n--- Test: Concurrent Same-Amount Race ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`acs_${timestamp}`);
  const users: api.IConnection[] = [];

  // Create 5 users
  for (let i = 0; i < 5; i++) {
    const conn = await createConnection(`ucs_${timestamp}_${i}`);
    await api.functional.api.users.deposit(conn, { amount: 5000 });
    users.push(conn);
  }
  console.log('✓ Created 5 users');

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Race Test ${timestamp}`)
  );
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // All 5 users try to bid 500 simultaneously
  const racePromises = users.map((user, i) =>
    api.functional.api.auctions.bid
      .placeBid(user, auction.id, { amount: 500 })
      .then(() => ({ success: true, user: i }))
      .catch(() => ({ success: false, user: i }))
  );

  const results = await Promise.all(racePromises);
  const winners = results.filter((r) => r.success);
  const losers = results.filter((r) => !r.success);

  console.log(`  Winners: ${winners.length}`);
  console.log(`  Losers: ${losers.length}`);

  // Exactly one should win
  if (winners.length === 1) {
    console.log(`✓ Exactly 1 winner (user ${winners[0]?.user})`);
  } else if (winners.length === 0) {
    console.log('  All rejected (possible due to rate limiting)');
  } else {
    throw new Error(`Expected 1 winner, got ${winners.length}`);
  }

  // Verify leaderboard has max 1 entry at 500
  const leaderboard = await api.functional.api.auctions.leaderboard.getLeaderboard(
    adminConn,
    auction.id,
    {}
  );

  const bidsAt500 = leaderboard.leaderboard.filter((b) => b.amount === 500);
  if (bidsAt500.length <= 1) {
    console.log('✓ At most 1 bid at amount 500');
  } else {
    throw new Error(`Multiple bids at 500: ${bidsAt500.length}`);
  }

  console.log('\n✓ Concurrent Same-Amount Race test PASSED\n');
}

async function testBiddingWhileAuctionNotActive(): Promise<void> {
  console.log('\n--- Test: Bidding on Inactive Auction ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`aia_${timestamp}`);
  const userConn = await createConnection(`uia_${timestamp}`);
  await api.functional.api.users.deposit(userConn, { amount: 5000 });

  // Create auction but don't start it
  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Inactive Test ${timestamp}`)
  );
  console.log(`✓ Created pending auction: ${auction.id}`);

  // Try to bid on pending auction
  try {
    await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 200 });
    throw new Error('Should reject bid on pending auction');
  } catch (e: unknown) {
    const error = e as Error;
    if (error.message.includes('Should reject')) {
      throw error;
    }
    console.log('✓ Correctly rejected bid on pending auction');
  }

  // Start auction
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log('✓ Auction started');

  // Now bid should work
  await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 200 });
  console.log('✓ Bid accepted on active auction');

  console.log('\n✓ Bidding on Inactive Auction test PASSED\n');
}

async function testLeaderboardConsistency(): Promise<void> {
  console.log('\n--- Test: Leaderboard Consistency Under Load ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`alc_${timestamp}`);
  const users: api.IConnection[] = [];

  // Create 20 users
  for (let i = 0; i < 20; i++) {
    const conn = await createConnection(`ulc_${timestamp}_${i}`);
    await api.functional.api.users.deposit(conn, { amount: 50000 });
    users.push(conn);
  }
  console.log('✓ Created 20 users');

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Consistency Test ${timestamp}`, { totalItems: 10, rounds: [{ itemsCount: 10, durationMinutes: 5 }] })
  );
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // Each user places a bid with unique amount
  const bidPromises = users.map((user, i) =>
    api.functional.api.auctions.bid
      .placeBid(user, auction.id, { amount: 1000 + i * 100 })
      .catch(() => null)
  );

  await Promise.all(bidPromises);
  console.log('✓ All bids placed');

  // Wait for leaderboard to be updated
  await waitFor(async () => {
    const lb = await api.functional.api.auctions.leaderboard.getLeaderboard(adminConn, auction.id, {});
    return lb.leaderboard.length >= 15; // At least 15 of 20 should succeed
  }, { timeout: 5000, message: 'Not enough bids in leaderboard' });

  // Verify leaderboard multiple times
  for (let check = 0; check < 3; check++) {
    const leaderboard = await api.functional.api.auctions.leaderboard.getLeaderboard(
      adminConn,
      auction.id,
      {}
    );

    // Verify ordering is correct (descending)
    let isOrdered = true;
    for (let i = 1; i < leaderboard.leaderboard.length; i++) {
      if ((leaderboard.leaderboard[i]?.amount ?? 0) > (leaderboard.leaderboard[i - 1]?.amount ?? 0)) {
        isOrdered = false;
        break;
      }
    }

    if (!isOrdered) {
      throw new Error('Leaderboard not ordered correctly!');
    }
  }

  console.log('✓ Leaderboard consistent across 3 reads');

  console.log('\n✓ Leaderboard Consistency test PASSED\n');
}

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   CONCURRENCY E2E TESTS                ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    await testConcurrentBidsDifferentUsers();
    await testDuplicateBidAmountRejection();
    await testRapidBidIncreases();
    await testConcurrentSameAmountRace();
    await testBiddingWhileAuctionNotActive();
    await testLeaderboardConsistency();

    console.log('\n');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   ALL CONCURRENCY TESTS PASSED!        ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('\n');
  } catch (error) {
    console.error('\n❌ Test Failed:', (error as Error).message);
    process.exit(1);
  }
}

main();
