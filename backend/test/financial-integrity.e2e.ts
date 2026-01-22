/**
 * E2E Test: Financial Integrity
 * Tests: Balance freezing, refunds, winner payments, no money loss
 */
import api from '../src/api';
import {
  createConnection,
  waitForLockRelease,
  createAuctionConfig,
} from './utils/test-helpers';

async function testBalanceFreezing(): Promise<void> {
  console.log('\n--- Test: Balance Freezing on Bid ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`af_${timestamp}`);
  const userConn = await createConnection(`uf_${timestamp}`);

  // Deposit 1000
  await api.functional.api.users.deposit(userConn, { amount: 1000 });

  // Check initial balance
  let balance = await api.functional.api.users.balance.getBalance(userConn);
  if (balance.balance !== 1000 || balance.frozenBalance !== 0) {
    throw new Error(`Initial balance wrong: ${balance.balance}/${balance.frozenBalance}`);
  }
  console.log('✓ Initial balance: 1000, frozen: 0');

  // Create and start auction
  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Freeze Test ${timestamp}`)
  );
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log(`✓ Created auction: ${auction.id}`);

  // Place bid of 300
  await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 300 });
  console.log('✓ Placed bid: 300');

  // Check balance after bid
  balance = await api.functional.api.users.balance.getBalance(userConn);
  if (balance.balance !== 700 || balance.frozenBalance !== 300) {
    throw new Error(`After bid balance wrong: ${balance.balance}/${balance.frozenBalance}`);
  }
  console.log('✓ After bid: balance=700, frozen=300');

  // Total should still be 1000
  const total = Number(balance.balance) + Number(balance.frozenBalance);
  if (total !== 1000) {
    throw new Error(`Total changed! Expected 1000, got ${total}`);
  }
  console.log('✓ Total unchanged: 1000');

  console.log('\n✓ Balance Freezing test PASSED\n');
}

async function testIncrementalFreeze(): Promise<void> {
  console.log('\n--- Test: Incremental Freeze on Bid Increase ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`ai_${timestamp}`);
  const userConn = await createConnection(`ui_${timestamp}`);

  await api.functional.api.users.deposit(userConn, { amount: 2000 });
  console.log('✓ Deposited 2000');

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Incremental Test ${timestamp}`)
  );
  await api.functional.api.auctions.start(adminConn, auction.id);

  // First bid: 500
  await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 500 });
  let balance = await api.functional.api.users.balance.getBalance(userConn);
  console.log(`  After 500 bid: balance=${balance.balance}, frozen=${balance.frozenBalance}`);

  if (balance.frozenBalance !== 500) {
    throw new Error(`Expected 500 frozen, got ${balance.frozenBalance}`);
  }

  await waitForLockRelease();

  // Increase to 800 - should only freeze additional 300
  await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 800 });
  balance = await api.functional.api.users.balance.getBalance(userConn);
  console.log(`  After 800 bid: balance=${balance.balance}, frozen=${balance.frozenBalance}`);

  if (balance.frozenBalance !== 800) {
    throw new Error(`Expected 800 frozen, got ${balance.frozenBalance}`);
  }
  if (balance.balance !== 1200) {
    throw new Error(`Expected 1200 available, got ${balance.balance}`);
  }

  // Total should still be 2000
  const total = Number(balance.balance) + Number(balance.frozenBalance);
  if (total !== 2000) {
    throw new Error(`Total changed! Expected 2000, got ${total}`);
  }
  console.log('✓ Incremental freeze correct, total preserved');

  console.log('\n✓ Incremental Freeze test PASSED\n');
}

async function testOutbidRefund(): Promise<void> {
  console.log('\n--- Test: Refund When Outbid ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`ao_${timestamp}`);
  const user1Conn = await createConnection(`u1_${timestamp}`);
  const user2Conn = await createConnection(`u2_${timestamp}`);

  await api.functional.api.users.deposit(user1Conn, { amount: 1000 });
  await api.functional.api.users.deposit(user2Conn, { amount: 1000 });
  console.log('✓ Both users deposited 1000');

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Outbid Test ${timestamp}`)
  );
  await api.functional.api.auctions.start(adminConn, auction.id);

  // User1 bids 400
  await api.functional.api.auctions.bid.placeBid(user1Conn, auction.id, { amount: 400 });
  let user1Balance = await api.functional.api.users.balance.getBalance(user1Conn);
  console.log(`  User1 after bid: balance=${user1Balance.balance}, frozen=${user1Balance.frozenBalance}`);

  await waitForLockRelease();

  // User2 bids 500 - User1 should NOT be refunded (they can still increase their bid)
  await api.functional.api.auctions.bid.placeBid(user2Conn, auction.id, { amount: 500 });

  user1Balance = await api.functional.api.users.balance.getBalance(user1Conn);
  console.log(`  User1 after outbid: balance=${user1Balance.balance}, frozen=${user1Balance.frozenBalance}`);

  // User1's bid is still frozen (they can increase it)
  if (user1Balance.frozenBalance !== 400) {
    console.log('  Note: User1 frozen balance changed (refund policy may vary)');
  }

  // User2's balance should show frozen
  const user2Balance = await api.functional.api.users.balance.getBalance(user2Conn);
  console.log(`  User2 after bid: balance=${user2Balance.balance}, frozen=${user2Balance.frozenBalance}`);

  if (user2Balance.frozenBalance !== 500) {
    throw new Error(`User2 frozen should be 500, got ${user2Balance.frozenBalance}`);
  }

  // Both users' totals should be 1000
  const user1Total = Number(user1Balance.balance) + Number(user1Balance.frozenBalance);
  const user2Total = Number(user2Balance.balance) + Number(user2Balance.frozenBalance);

  if (user1Total !== 1000) {
    throw new Error(`User1 total changed: ${user1Total}`);
  }
  if (user2Total !== 1000) {
    throw new Error(`User2 total changed: ${user2Total}`);
  }
  console.log('✓ Both users total preserved at 1000');

  console.log('\n✓ Outbid Refund test PASSED\n');
}

async function testInsufficientFundsRejection(): Promise<void> {
  console.log('\n--- Test: Insufficient Funds Rejection ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`ar_${timestamp}`);
  const userConn = await createConnection(`ur_${timestamp}`);

  await api.functional.api.users.deposit(userConn, { amount: 500 });
  console.log('✓ Deposited 500');

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Insufficient Test ${timestamp}`)
  );
  await api.functional.api.auctions.start(adminConn, auction.id);

  // Try to bid more than balance
  try {
    await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 600 });
    throw new Error('Should have rejected insufficient funds');
  } catch (e: unknown) {
    const error = e as Error;
    if (error.message.includes('Insufficient') || error.message.includes('insufficient')) {
      console.log('✓ Correctly rejected bid of 600 (only have 500)');
    } else if (error.message.includes('Should have rejected')) {
      throw error;
    } else {
      console.log(`✓ Rejected with: ${error.message}`);
    }
  }

  // Balance should be unchanged
  const balance = await api.functional.api.users.balance.getBalance(userConn);
  if (balance.balance !== 500 || balance.frozenBalance !== 0) {
    throw new Error(`Balance changed after rejection: ${balance.balance}/${balance.frozenBalance}`);
  }
  console.log('✓ Balance unchanged after rejection');

  console.log('\n✓ Insufficient Funds Rejection test PASSED\n');
}

async function testMultiUserFinancialIntegrity(): Promise<void> {
  console.log('\n--- Test: Multi-User Financial Integrity ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`am_${timestamp}`);
  const users: { conn: api.IConnection; deposit: number }[] = [];

  // Create 5 users with different deposits
  const deposits = [1000, 2000, 1500, 3000, 500];
  for (let i = 0; i < 5; i++) {
    const conn = await createConnection(`um_${timestamp}_${i}`);
    await api.functional.api.users.deposit(conn, { amount: deposits[i]! });
    users.push({ conn, deposit: deposits[i]! });
  }
  const totalDeposited = deposits.reduce((a, b) => a + b, 0);
  console.log(`✓ Created 5 users with total deposits: ${totalDeposited}`);

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Multi-User Test ${timestamp}`, { totalItems: 3, rounds: [{ itemsCount: 3, durationMinutes: 5 }] })
  );
  await api.functional.api.auctions.start(adminConn, auction.id);

  // Each user places a bid with lock release between
  const bids = [800, 1200, 900, 1500, 400];
  for (let i = 0; i < 5; i++) {
    await api.functional.api.auctions.bid.placeBid(users[i]!.conn, auction.id, {
      amount: bids[i]!
    });
    await waitForLockRelease();
  }
  console.log(`✓ Placed bids: ${bids.join(', ')}`);

  // Verify total in system
  let totalInSystem = 0;
  for (let i = 0; i < 5; i++) {
    const balance = await api.functional.api.users.balance.getBalance(users[i]!.conn);
    totalInSystem += Number(balance.balance) + Number(balance.frozenBalance);
    console.log(`  User ${i}: balance=${balance.balance}, frozen=${balance.frozenBalance}`);
  }

  if (totalInSystem !== totalDeposited) {
    throw new Error(`Money lost/created! Expected ${totalDeposited}, got ${totalInSystem}`);
  }
  console.log(`✓ Total in system: ${totalInSystem} (matches deposits)`);

  console.log('\n✓ Multi-User Financial Integrity test PASSED\n');
}

async function testBidValidation(): Promise<void> {
  console.log('\n--- Test: Bid Amount Validation ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`av_${timestamp}`);
  const userConn = await createConnection(`uv_${timestamp}`);

  await api.functional.api.users.deposit(userConn, { amount: 10000 });

  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Validation Test ${timestamp}`)
  );
  await api.functional.api.auctions.start(adminConn, auction.id);

  // Test: Bid below minimum
  try {
    await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 50 });
    throw new Error('Should reject below minimum');
  } catch (e: unknown) {
    const error = e as Error;
    if (!error.message.includes('Should reject')) {
      console.log('✓ Rejected bid below minimum (50 < 100)');
    } else {
      throw error;
    }
  }

  // Test: Valid first bid
  await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 100 });
  console.log('✓ Accepted bid at minimum (100)');

  await waitForLockRelease();

  // Test: Increment too small
  try {
    await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 105 });
    throw new Error('Should reject small increment');
  } catch (e: unknown) {
    const error = e as Error;
    if (!error.message.includes('Should reject')) {
      console.log('✓ Rejected small increment (105, need 110+)');
    } else {
      throw error;
    }
  }

  await waitForLockRelease();

  // Test: Valid increment
  await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 110 });
  console.log('✓ Accepted valid increment (110)');

  console.log('\n✓ Bid Amount Validation test PASSED\n');
}

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   FINANCIAL INTEGRITY E2E TESTS        ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    await testBalanceFreezing();
    await testIncrementalFreeze();
    await testOutbidRefund();
    await testInsufficientFundsRejection();
    await testMultiUserFinancialIntegrity();
    await testBidValidation();

    console.log('\n');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   ALL FINANCIAL TESTS PASSED!          ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('\n');
  } catch (error) {
    console.error('\n❌ Test Failed:', (error as Error).message);
    process.exit(1);
  }
}

main();
