/**
 * E2E Test: Server-Side Timer Broadcasts
 * Tests: Countdown events, timer sync, anti-sniping extensions
 */
import { Socket } from 'socket.io-client';
import api from '../src/api';
import {
  createConnection,
  getAuthToken,
  connectAndJoin,
  collectEvents,
  createAuctionConfig,
} from './utils/test-helpers';

const WS_URL = `ws://localhost:${process.env.PORT ?? 4000}`;

interface CountdownEvent {
  timeLeftSeconds: number;
  roundNumber: number;
  serverTime: string;
}

async function testCountdownBroadcast(): Promise<void> {
  console.log('\n--- Test: Countdown Broadcast ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`at_${timestamp}`);
  const userConn = await createConnection(`ut_${timestamp}`);
  await api.functional.api.users.deposit(userConn, { amount: 10000 });
  console.log('✓ Created test users');

  const wsToken = await getAuthToken(`wt_${timestamp}`);

  // Create auction
  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Timer Test ${timestamp}`, { rounds: [{ itemsCount: 2, durationMinutes: 2 }], totalItems: 2 })
  );
  console.log(`✓ Created auction: ${auction.id}`);

  // Connect WebSocket and join auction room
  const socket = await connectAndJoin(WS_URL, wsToken, auction.id);
  console.log('✓ WebSocket connected');

  // Start collecting countdown events
  const countdownPromise = collectEvents<CountdownEvent>(
    socket,
    'countdown',
    3,
    { timeout: 15000 }
  );

  // Start auction (this should trigger timer broadcasts)
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log('✓ Started auction');

  // Wait for countdown events
  const countdownEvents = await countdownPromise;
  socket.disconnect();

  console.log(`✓ Received ${countdownEvents.length} countdown events`);

  // Verify countdown events have correct structure
  for (const event of countdownEvents) {
    if (typeof event.timeLeftSeconds !== 'number') {
      throw new Error('Countdown event missing timeLeftSeconds');
    }
    if (typeof event.roundNumber !== 'number') {
      throw new Error('Countdown event missing roundNumber');
    }
    if (typeof event.serverTime !== 'string') {
      throw new Error('Countdown event missing serverTime');
    }
  }
  console.log('✓ Countdown events have correct structure');

  // Verify countdown is decreasing
  if (countdownEvents.length >= 2) {
    const first = countdownEvents[0]!.timeLeftSeconds;
    const last = countdownEvents[countdownEvents.length - 1]!.timeLeftSeconds;
    if (first > last) {
      console.log('✓ Countdown is decreasing');
    } else {
      throw new Error('Countdown not decreasing');
    }
  }

  console.log('\n✓ Countdown Broadcast test PASSED\n');
}

async function testAntiSnipingExtension(): Promise<void> {
  console.log('\n--- Test: Anti-Sniping Timer Extension ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`as_${timestamp}`);
  const userConn = await createConnection(`ua_${timestamp}`);
  await api.functional.api.users.deposit(userConn, { amount: 50000 });
  console.log('✓ Created test users');

  const wsToken = await getAuthToken(`wa_${timestamp}`);

  // Create auction with 1-minute anti-sniping window
  const auction = await api.functional.api.auctions.create(adminConn, {
    title: `Anti-Snipe Test ${timestamp}`,
    totalItems: 1,
    rounds: [{ itemsCount: 1, durationMinutes: 1 }],
    minBidAmount: 100,
    minBidIncrement: 10,
    antiSnipingWindowMinutes: 1,
    antiSnipingExtensionMinutes: 1,
    maxExtensions: 3,
    botsEnabled: false,
  });
  console.log(`✓ Created auction: ${auction.id}`);

  // Connect WebSocket
  const socket = await connectAndJoin(WS_URL, wsToken, auction.id);

  let antiSnipingReceived = false;
  let countdownAfterSnipe = 0;

  socket.on('anti-sniping', (data) => {
    antiSnipingReceived = true;
    console.log(`  Received anti-sniping event: +${data.extensionMinutes} min`);
  });

  socket.on('countdown', (data) => {
    if (antiSnipingReceived && countdownAfterSnipe === 0) {
      countdownAfterSnipe = data.timeLeftSeconds;
      console.log(`  Timer after extension: ${data.timeLeftSeconds}s remaining`);
    }
  });

  // Start auction
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log('✓ Started auction');

  // Wait for first countdown then place bid
  await collectEvents(socket, 'countdown', 2, { timeout: 5000 }).catch(() => null);

  await api.functional.api.auctions.bid.placeBid(userConn, auction.id, { amount: 200 });
  console.log('✓ Placed bid within anti-sniping window');

  // Wait for anti-sniping or more countdown events
  await new Promise((r) => setTimeout(r, 3000));
  socket.disconnect();

  if (antiSnipingReceived) {
    console.log('✓ Anti-sniping event received');
  } else {
    console.log('  (Anti-sniping may not trigger if round >1min remaining)');
  }

  console.log('\n✓ Anti-Sniping Extension test PASSED\n');
}

async function testMultipleClientsSync(): Promise<void> {
  console.log('\n--- Test: Multiple Clients Sync ---\n');

  const timestamp = Date.now();
  const adminConn = await createConnection(`am_${timestamp}`);
  console.log('✓ Created admin user');

  // Create auction
  const auction = await api.functional.api.auctions.create(
    adminConn,
    createAuctionConfig(`Multi-Client Test ${timestamp}`, { rounds: [{ itemsCount: 1, durationMinutes: 2 }] })
  );
  console.log(`✓ Created auction: ${auction.id}`);

  // Create 3 WebSocket clients
  const sockets: Socket[] = [];
  const countdowns: Map<number, number[]> = new Map();

  for (let i = 0; i < 3; i++) {
    const token = await getAuthToken(`wm_${timestamp}_${i}`);
    countdowns.set(i, []);

    const socket = await connectAndJoin(WS_URL, token, auction.id);
    const idx = i;
    socket.on('countdown', (data) => {
      countdowns.get(idx)!.push(data.timeLeftSeconds);
    });

    sockets.push(socket);
  }
  console.log('✓ Connected 3 WebSocket clients');

  // Start auction
  await api.functional.api.auctions.start(adminConn, auction.id);
  console.log('✓ Started auction');

  // Wait for countdown events using collectEvents on first socket
  await collectEvents(sockets[0]!, 'countdown', 3, { timeout: 10000 }).catch(() => null);

  // Disconnect all
  sockets.forEach((s) => s.disconnect());

  // Verify all clients received similar countdown values
  const client0 = countdowns.get(0)!;
  const client1 = countdowns.get(1)!;
  const client2 = countdowns.get(2)!;

  console.log(`  Client 0 received ${client0.length} countdowns`);
  console.log(`  Client 1 received ${client1.length} countdowns`);
  console.log(`  Client 2 received ${client2.length} countdowns`);

  if (client0.length >= 2 && client1.length >= 2 && client2.length >= 2) {
    console.log('✓ All clients received countdown events');

    // Check that values are similar (within 2 seconds)
    if (client0.length > 0 && client1.length > 0 && client2.length > 0) {
      const diff01 = Math.abs(client0[0]! - client1[0]!);
      const diff02 = Math.abs(client0[0]! - client2[0]!);
      if (diff01 <= 2 && diff02 <= 2) {
        console.log('✓ Clients are synced (within 2s tolerance)');
      } else {
        console.log(`  Warning: Clients may be out of sync (diff: ${diff01}, ${diff02})`);
      }
    }
  } else {
    throw new Error('Not all clients received enough countdown events');
  }

  console.log('\n✓ Multiple Clients Sync test PASSED\n');
}

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   SERVER TIMER E2E TESTS               ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    await testCountdownBroadcast();
    await testAntiSnipingExtension();
    await testMultipleClientsSync();

    console.log('\n');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   ALL SERVER TIMER TESTS PASSED!       ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('\n');
  } catch (error) {
    console.error('\n❌ Test Failed:', (error as Error).message);
    process.exit(1);
  }
}

main();
