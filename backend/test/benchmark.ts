/**
 * Benchmark Runner using @nestia/benchmark
 *
 * Run with: npm run benchmark
 *
 * Options via environment variables:
 *   PORT - Server port (default: 3001)
 *   BENCHMARK_COUNT - Total requests (default: 1000)
 *   BENCHMARK_THREADS - Worker threads (default: 4)
 *   BENCHMARK_SIMULTANEOUS - Simultaneous requests per thread (default: 8)
 */
import { DynamicBenchmarker } from "@nestia/benchmark";
import api from "../src/api";

async function setup(): Promise<{ auctionId: string; token: string }> {
  const host = `http://localhost:${process.env.PORT ?? 3001}`;
  const connection: api.IConnection = { host, headers: {} };

  console.log("Setting up benchmark data...");

  // Create test user and authenticate
  const username = `benchmark_${Date.now()}`;
  const authResult = await api.functional.api.auth.login(connection, { username });
  const token = authResult.accessToken;

  connection.headers = { Authorization: `Bearer ${token}` };

  // Deposit funds
  await api.functional.api.users.deposit(connection, { amount: 100000 });

  // Create test auction
  const auction = await api.functional.api.auctions.create(connection, {
    title: `Benchmark_${Date.now()}`,
    description: "Benchmark test auction",
    totalItems: 5,
    rounds: [
      { itemsCount: 3, durationMinutes: 30 },
      { itemsCount: 2, durationMinutes: 30 },
    ],
    minBidAmount: 100,
    minBidIncrement: 10,
    antiSnipingWindowMinutes: 1,
    antiSnipingExtensionMinutes: 1,
    maxExtensions: 3,
    botsEnabled: false,
  });

  // Start auction
  await api.functional.api.auctions.start(connection, auction.id);

  // Place initial bid
  await api.functional.api.auctions.bid.placeBid(connection, auction.id, { amount: 100 });

  console.log(`Created auction: ${auction.id}`);
  console.log(`Auth token: ${token.slice(0, 20)}...`);

  return { auctionId: auction.id, token };
}

async function main(): Promise<void> {
  const count = parseInt(process.env.BENCHMARK_COUNT ?? "1000", 10);
  const threads = parseInt(process.env.BENCHMARK_THREADS ?? "4", 10);
  const simultaneous = parseInt(process.env.BENCHMARK_SIMULTANEOUS ?? "8", 10);

  console.log("\n================================");
  console.log("Benchmark Configuration");
  console.log("================================");
  console.log(`Requests: ${count}`);
  console.log(`Threads: ${threads}`);
  console.log(`Simultaneous: ${simultaneous}`);
  console.log("================================\n");

  // Setup test data
  const { auctionId, token } = await setup();

  // Set env vars for servant workers
  process.env.BENCHMARK_AUCTION_ID = auctionId;
  process.env.BENCHMARK_TOKEN = token;

  console.log("\nRunning benchmark...\n");

  const report = await DynamicBenchmarker.master({
    servant: `${__dirname}/benchmark-servant.js`,
    count,
    threads,
    simultaneous,
    progress: (complete: number) => {
      if (complete % Math.floor(count / 10) === 0) {
        const percent = Math.round((complete / count) * 100);
        process.stdout.write(`\rProgress: ${complete}/${count} (${percent}%)`);
      }
    },
  });

  console.log("\n\n================================");
  console.log("Benchmark Results");
  console.log("================================\n");

  // Generate markdown report
  const markdown = DynamicBenchmarker.markdown(report);
  console.log(markdown);
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});
