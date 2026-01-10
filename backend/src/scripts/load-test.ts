import { randomInt, randomBytes } from 'crypto';
import { io, Socket } from 'socket.io-client';

// ═════════════════════════════════════════════════════════════════════════════
// CONFIGURATION & TYPES
// ═════════════════════════════════════════════════════════════════════════════

const VERSION = '2.0.0';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

interface Config {
  apiUrl: string;
  wsUrl: string;
  userCount: number;
  depositAmount: number;
  itemCount: number;
  concurrencyLimit: number;
  highFrequencyDurationMs: number;
  highFrequencyDelayMs: number;
  wsConnectionCount: number;
  warmupRequests: number;
  testSuites: string[];
  verbose: boolean;
}

interface TestUser {
  id: string;
  username: string;
  token: string;
  initialDeposit: number;
}

interface BidResult {
  success: boolean;
  responseTimeMs: number;
  error?: string;
  statusCode?: number;
}

interface WsResult {
  connected: boolean;
  latencyMs: number;
  messagesReceived: number;
  error?: string;
}

interface TestMetrics {
  requests: number;
  successes: number;
  failures: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
  minMs: number;
  avgMs: number;
  rps: number;
  stdDev: number;
}

interface TestSuiteResult {
  name: string;
  passed: boolean;
  metrics: TestMetrics;
  errors: Record<string, number>;
  details?: string;
  histogram?: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const squareDiffs = arr.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function progressBar(current: number, total: number, width = 30): string {
  const percent = current / total;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${(percent * 100).toFixed(0)}%`;
}

function histogram(times: number[], buckets = 10): string {
  if (times.length === 0) return '';
  const sorted = [...times].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min || 1;
  const bucketSize = range / buckets;

  const counts: number[] = new Array(buckets).fill(0);
  for (const t of times) {
    const idx = Math.min(Math.floor((t - min) / bucketSize), buckets - 1);
    counts[idx]++;
  }

  const maxCount = Math.max(...counts);
  const lines: string[] = [];
  const barWidth = 20;

  for (let i = 0; i < buckets; i++) {
    const start = min + i * bucketSize;
    const end = start + bucketSize;
    const bar = '▓'.repeat(Math.round((counts[i] / maxCount) * barWidth));
    const label = `${formatMs(start).padStart(7)} - ${formatMs(end).padEnd(7)}`;
    lines.push(`  ${label} ${bar.padEnd(barWidth)} ${counts[i]}`);
  }

  return lines.join('\n');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 5,
  baseDelayMs = 200
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    const delay = baseDelayMs * Math.pow(2, attempt) + randomInt(100);
    await sleep(delay);
  }
  return fetch(url, options);
}

async function limitConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = [];
  let completed = 0;
  let idx = 0;

  async function runNext(): Promise<void> {
    const currentIdx = idx++;
    if (currentIdx >= tasks.length) return;
    results[currentIdx] = await tasks[currentIdx]();
    completed++;
    onProgress?.(completed, tasks.length);
    await runNext();
  }

  const workers = Array(Math.min(limit, tasks.length)).fill(null).map(() => runNext());
  await Promise.all(workers);
  return results;
}

function parseArgs(args: string[]): Partial<Config> & { help?: boolean } {
  const config: Partial<Config> & { help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '-h':
      case '--help':
        config.help = true;
        break;
      case '-u':
      case '--users':
        config.userCount = parseInt(nextArg, 10);
        i++;
        break;
      case '-d':
      case '--deposit':
        config.depositAmount = parseInt(nextArg, 10);
        i++;
        break;
      case '-i':
      case '--items':
        config.itemCount = parseInt(nextArg, 10);
        i++;
        break;
      case '-c':
      case '--concurrency':
        config.concurrencyLimit = parseInt(nextArg, 10);
        i++;
        break;
      case '-w':
      case '--ws-connections':
        config.wsConnectionCount = parseInt(nextArg, 10);
        i++;
        break;
      case '--warmup':
        config.warmupRequests = parseInt(nextArg, 10);
        i++;
        break;
      case '-s':
      case '--suites':
        config.testSuites = nextArg.split(',');
        i++;
        break;
      case '--api-url':
        config.apiUrl = nextArg;
        i++;
        break;
      case '--ws-url':
        config.wsUrl = nextArg;
        i++;
        break;
      case '-v':
      case '--verbose':
        config.verbose = true;
        break;
      case '--stress-duration':
        config.highFrequencyDurationMs = parseInt(nextArg, 10);
        i++;
        break;
      case '--stress-delay':
        config.highFrequencyDelayMs = parseInt(nextArg, 10);
        i++;
        break;
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
${c.bold}Auction System Load Test Suite v${VERSION}${c.reset}

${c.cyan}USAGE:${c.reset}
  ts-node load-test.ts [OPTIONS]

${c.cyan}OPTIONS:${c.reset}
  -h, --help                Show this help message
  -u, --users <n>           Number of test users (default: 20)
  -d, --deposit <n>         Deposit amount per user (default: 50000)
  -i, --items <n>           Number of auction items (default: 10)
  -c, --concurrency <n>     Max concurrent requests (default: 50)
  -w, --ws-connections <n>  WebSocket connections for WS test (default: 50)
  --warmup <n>              Warmup requests before tests (default: 10)
  -s, --suites <list>       Comma-separated test suites to run:
                            all, core, stress, edge, ws, verify
                            (default: all)
  --api-url <url>           API base URL (default: http://localhost:4000/api)
  --ws-url <url>            WebSocket URL (default: ws://localhost:4000)
  --stress-duration <ms>    High-frequency test duration (default: 5000)
  --stress-delay <ms>       Delay between stress bids (default: 50)
  -v, --verbose             Enable verbose output

${c.cyan}TEST SUITES:${c.reset}
  ${c.bold}core${c.reset}     - Concurrent bids, sequential bids, tie-breaking
  ${c.bold}stress${c.reset}   - High-frequency, massive concurrent, rate limit
  ${c.bold}edge${c.reset}     - Insufficient funds, invalid amounts, auth validation
  ${c.bold}ws${c.reset}       - WebSocket connections, real-time updates
  ${c.bold}verify${c.reset}   - Bid ordering, financial integrity

${c.cyan}EXAMPLES:${c.reset}
  # Run all tests with defaults
  ts-node load-test.ts

  # Heavy stress test with 100 users
  ts-node load-test.ts -u 100 -d 100000 --stress-duration 10000

  # Only run WebSocket and verification tests
  ts-node load-test.ts -s ws,verify

  # Test against production with verbose output
  ts-node load-test.ts --api-url https://api.example.com/api -v
`);
}

// ═════════════════════════════════════════════════════════════════════════════
// LOAD TESTER CLASS
// ═════════════════════════════════════════════════════════════════════════════

class LoadTester {
  private users: TestUser[] = [];
  private config: Config;
  private testResults: TestSuiteResult[] = [];
  private startMemory: number = 0;

  constructor(config: Config) {
    this.config = config;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    token?: string
  ): Promise<{ data: T; status: number; responseTimeMs: number }> {
    const start = performance.now();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.config.apiUrl}${path}`, { ...options, headers });
    const responseTimeMs = performance.now() - start;
    const data = await res.json().catch(() => ({}));
    return { data: data as T, status: res.status, responseTimeMs };
  }

  async initialize(): Promise<void> {
    this.startMemory = process.memoryUsage().heapUsed;
    process.stdout.write(`${c.cyan}Creating ${this.config.userCount} test users...${c.reset} `);

    const tasks = Array.from({ length: this.config.userCount }, (_, i) => async () => {
      const username = `lt_${Date.now()}_${i}_${randomBytes(3).toString('hex')}`;

      const loginRes = await fetchWithRetry(`${this.config.apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });

      if (!loginRes.ok) {
        throw new Error(`Login failed for ${username}: ${loginRes.status}`);
      }

      const loginData = (await loginRes.json()) as { user: { id: string }; accessToken: string };
      if (!loginData.user?.id || !loginData.accessToken) {
        throw new Error(`Invalid login response for ${username}: ${JSON.stringify(loginData)}`);
      }
      const token = loginData.accessToken;

      const depositRes = await fetchWithRetry(`${this.config.apiUrl}/users/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: this.config.depositAmount }),
      });

      if (!depositRes.ok) {
        throw new Error(`Deposit failed for ${username}: ${depositRes.status}`);
      }

      return { id: loginData.user.id, username, token, initialDeposit: this.config.depositAmount };
    });

    this.users = await limitConcurrency(tasks, 5, (done, total) => {
      process.stdout.write(`\r${c.cyan}Creating ${this.config.userCount} test users...${c.reset} ${progressBar(done, total)}`);
    });

    console.log(`\r${c.green}✓${c.reset} Created ${this.users.length} users with ${formatNumber(this.config.depositAmount)} deposit each`);
  }

  async warmup(): Promise<void> {
    if (this.config.warmupRequests <= 0) return;

    process.stdout.write(`${c.cyan}Warming up API...${c.reset}`);

    for (let i = 0; i < this.config.warmupRequests; i++) {
      await this.request('/auctions');
      process.stdout.write(`\r${c.cyan}Warming up API...${c.reset} ${progressBar(i + 1, this.config.warmupRequests)}`);
    }

    console.log(`\r${c.green}✓${c.reset} Warmup complete (${this.config.warmupRequests} requests)`);
  }

  async createAndStartAuction(): Promise<string> {
    process.stdout.write(`${c.cyan}Creating auction...${c.reset} `);

    const { data: auction, status: createStatus } = await this.request<{ id: string }>('/auctions', {
      method: 'POST',
      body: JSON.stringify({
        title: `LoadTest_${Date.now()}`,
        description: 'Automated load test',
        totalItems: this.config.itemCount,
        rounds: [
          { itemsCount: Math.ceil(this.config.itemCount / 2), durationMinutes: 10 },
          { itemsCount: Math.floor(this.config.itemCount / 2), durationMinutes: 10 },
        ],
        minBidAmount: 100,
        minBidIncrement: 10,
        antiSnipingWindowMinutes: 1,
        antiSnipingExtensionMinutes: 1,
        maxExtensions: 5,
        botsEnabled: false,
      }),
    }, this.users[0].token);

    if (createStatus !== 201 || !auction.id) {
      throw new Error(`Failed to create auction: ${JSON.stringify(auction)}`);
    }

    const { status: startStatus, data: startResult } = await this.request<{ status?: string; message?: string }>(
      `/auctions/${auction.id}/start`,
      { method: 'POST' },
      this.users[0].token
    );

    if (startStatus !== 200 && startStatus !== 201) {
      throw new Error(`Failed to start auction: ${startStatus} - ${JSON.stringify(startResult)}`);
    }

    await sleep(200);
    const { data: verifyAuction } = await this.request<{ status: string; currentRound: number }>(
      `/auctions/${auction.id}`
    );

    if (verifyAuction.status !== 'active' || verifyAuction.currentRound !== 1) {
      throw new Error(`Auction not properly started: status=${verifyAuction.status}, round=${verifyAuction.currentRound}`);
    }

    console.log(`\r${c.green}✓${c.reset} Auction ${c.dim}${auction.id}${c.reset} created and active`);
    return auction.id;
  }

  private async placeBid(user: TestUser, auctionId: string, amount: number, retry = true): Promise<BidResult> {
    const start = performance.now();
    try {
      const res = retry
        ? await fetchWithRetry(`${this.config.apiUrl}/auctions/${auctionId}/bid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
            body: JSON.stringify({ amount }),
          })
        : await fetch(`${this.config.apiUrl}/auctions/${auctionId}/bid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
            body: JSON.stringify({ amount }),
          });

      const responseTimeMs = performance.now() - start;

      if (res.ok) {
        return { success: true, responseTimeMs };
      }

      const error = await res.json().catch(() => ({ message: 'Unknown' }));
      return { success: false, responseTimeMs, error: error.message, statusCode: res.status };
    } catch (err) {
      return { success: false, responseTimeMs: performance.now() - start, error: (err as Error).message };
    }
  }

  private computeMetrics(results: BidResult[], durationMs: number): TestMetrics {
    const times = results.map(r => r.responseTimeMs);
    const successes = results.filter(r => r.success).length;
    return {
      requests: results.length,
      successes,
      failures: results.length - successes,
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      maxMs: times.length ? Math.max(...times) : 0,
      minMs: times.length ? Math.min(...times) : 0,
      avgMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      rps: durationMs > 0 ? (results.length / durationMs) * 1000 : 0,
      stdDev: stdDev(times),
    };
  }

  private collectErrors(results: BidResult[]): Record<string, number> {
    const errors: Record<string, number> = {};
    results.filter(r => !r.success && r.error).forEach(r => {
      errors[r.error!] = (errors[r.error!] || 0) + 1;
    });
    return errors;
  }

  private async getHighestBid(auctionId: string): Promise<number> {
    const { data: leaderboard } = await this.request<Array<{ amount: number }>>(`/auctions/${auctionId}/leaderboard`);
    return leaderboard?.[0]?.amount || 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  async testConcurrentBidStorm(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Concurrent Bid Storm';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const start = performance.now();
    const tasks = this.users.map((user, i) => () => this.placeBid(user, auctionId, 100 + i * 20));
    const results = await Promise.all(tasks.map(t => t()));
    const duration = performance.now() - start;

    const metrics = this.computeMetrics(results, duration);
    const passed = metrics.successes >= 1;
    const times = results.map(r => r.responseTimeMs);

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.successes}/${metrics.requests} @ ${metrics.rps.toFixed(1)} req/s, p99=${formatMs(metrics.p99)}`);

    return {
      name: testName,
      passed,
      metrics,
      errors: this.collectErrors(results),
      histogram: this.config.verbose ? histogram(times) : undefined,
    };
  }

  async testRapidSequentialBids(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Rapid Sequential Bids';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const user = this.users[0];
    const results: BidResult[] = [];
    const start = performance.now();

    const highestBid = await this.getHighestBid(auctionId);
    const { data: auction } = await this.request<{ minBidAmount: number }>(`/auctions/${auctionId}`);
    let amount = Math.max(highestBid, auction.minBidAmount || 100) + 50;

    for (let i = 0; i < 20; i++) {
      const result = await this.placeBid(user, auctionId, amount);
      results.push(result);
      if (result.success) amount += 20;
    }

    const duration = performance.now() - start;
    const metrics = this.computeMetrics(results, duration);
    const passed = metrics.successes >= 10;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.successes}/${metrics.requests}, avg=${formatMs(metrics.avgMs)}`);

    return { name: testName, passed, metrics, errors: this.collectErrors(results) };
  }

  async testTieBreaking(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Tie-Breaking (Same Amount)';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const { data: auction } = await this.request<{ minBidAmount: number }>(`/auctions/${auctionId}`);
    const highestBid = await this.getHighestBid(auctionId);
    const tieAmount = Math.max(highestBid, auction.minBidAmount || 100) + 200;

    const start = performance.now();
    const tasks = this.users.slice(0, 10).map(user => () => this.placeBid(user, auctionId, tieAmount));
    const results = await Promise.all(tasks.map(t => t()));
    const duration = performance.now() - start;

    const metrics = this.computeMetrics(results, duration);
    const passed = metrics.successes === 1;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.successes} winner(s) from ${metrics.requests} identical bids`);

    return {
      name: testName,
      passed,
      metrics,
      errors: this.collectErrors(results),
      details: passed ? 'Tie-breaking works correctly' : `Expected 1 winner, got ${metrics.successes}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STRESS TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  async testHighFrequencyStress(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'High-Frequency Stress';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const results: BidResult[] = [];
    const endTime = Date.now() + this.config.highFrequencyDurationMs;
    let bidCount = 0;

    const highestBid = await this.getHighestBid(auctionId);
    const { data: auction } = await this.request<{ minBidAmount: number }>(`/auctions/${auctionId}`);
    let amount = Math.max(highestBid, auction.minBidAmount || 100) + 100;

    const start = performance.now();

    while (Date.now() < endTime) {
      const user = this.users[bidCount % this.users.length];
      const result = await this.placeBid(user, auctionId, amount + bidCount * 10);
      results.push(result);
      bidCount++;
      if (this.config.highFrequencyDelayMs > 0) {
        await sleep(this.config.highFrequencyDelayMs);
      }
    }

    const duration = performance.now() - start;
    const metrics = this.computeMetrics(results, duration);
    const passed = metrics.requests >= 5 && metrics.successes >= 1;
    const times = results.map(r => r.responseTimeMs);

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.requests} bids @ ${metrics.rps.toFixed(1)} req/s, success=${((metrics.successes / metrics.requests) * 100).toFixed(0)}%`);

    return {
      name: testName,
      passed,
      metrics,
      errors: this.collectErrors(results),
      histogram: this.config.verbose ? histogram(times) : undefined,
    };
  }

  async testMassiveConcurrentStress(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Massive Concurrent Stress';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const highestBid = await this.getHighestBid(auctionId);
    const { data: auction } = await this.request<{ minBidAmount: number }>(`/auctions/${auctionId}`);
    let baseAmount = Math.max(highestBid, auction.minBidAmount || 100) + 1000;

    const start = performance.now();
    const allResults: BidResult[] = [];

    for (let wave = 0; wave < 3; wave++) {
      const results = await Promise.all(
        this.users.map((user, i) => this.placeBid(user, auctionId, baseAmount + wave * 500 + i * 10))
      );
      allResults.push(...results);
      baseAmount += this.users.length * 10 + 100;
      await sleep(100);
    }

    const duration = performance.now() - start;
    const metrics = this.computeMetrics(allResults, duration);
    const passed = metrics.successes >= 3;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.successes}/${metrics.requests} @ ${metrics.rps.toFixed(1)} req/s, p99=${formatMs(metrics.p99)}`);

    return { name: testName, passed, metrics, errors: this.collectErrors(allResults) };
  }

  async testRateLimitBehavior(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Rate Limit Behavior';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const user = this.users[0];
    const highestBid = await this.getHighestBid(auctionId);
    const { data: auction } = await this.request<{ minBidAmount: number }>(`/auctions/${auctionId}`);
    let amount = Math.max(highestBid, auction.minBidAmount || 100) + 5000;

    const results: BidResult[] = [];
    const start = performance.now();

    // Fire 50 requests rapidly without retry
    const rapidTasks = Array.from({ length: 50 }, () =>
      this.placeBid(user, auctionId, amount++, false)
    );
    const rapidResults = await Promise.all(rapidTasks);
    results.push(...rapidResults);

    const duration = performance.now() - start;
    const metrics = this.computeMetrics(results, duration);

    // Rate limiting should kick in - we expect 429s
    const rateLimited = results.filter(r => r.statusCode === 429).length;
    const passed = rateLimited > 0 || metrics.failures > metrics.successes;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${rateLimited} rate-limited, ${metrics.successes} succeeded`);

    return {
      name: testName,
      passed,
      metrics,
      errors: this.collectErrors(results),
      details: `Rate limited: ${rateLimited}/${results.length}`,
    };
  }

  async testSameUserRaceCondition(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Same-User Race Condition';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const user = this.users[1];
    const highestBid = await this.getHighestBid(auctionId);
    const { data: auction } = await this.request<{ minBidAmount: number }>(`/auctions/${auctionId}`);
    const baseAmount = Math.max(highestBid, auction.minBidAmount || 100) + 500;

    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => this.placeBid(user, auctionId, baseAmount + i * 10))
    );
    const duration = performance.now() - start;

    const metrics = this.computeMetrics(results, duration);
    const passed = metrics.successes <= 5;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.successes}/${metrics.requests} succeeded (expected ≤5)`);

    return {
      name: testName,
      passed,
      metrics,
      errors: this.collectErrors(results),
      details: `Same user concurrent bids: ${metrics.successes} accepted`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE CASE TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  async testInsufficientFunds(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Insufficient Funds Rejection';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const start = performance.now();
    const hugeAmount = this.config.depositAmount * 100;
    const results = await Promise.all(
      this.users.slice(0, 5).map(user => this.placeBid(user, auctionId, hugeAmount))
    );
    const duration = performance.now() - start;

    const metrics = this.computeMetrics(results, duration);
    const passed = metrics.failures === results.length;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.failures}/${metrics.requests} correctly rejected`);

    return {
      name: testName,
      passed,
      metrics,
      errors: this.collectErrors(results),
      details: passed ? 'All oversized bids rejected' : 'Some invalid bids were accepted!',
    };
  }

  async testInvalidBidAmounts(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Invalid Bid Rejection';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const user = this.users[0];
    const invalidAmounts = [0, -100, 0.5, 1];
    const results: BidResult[] = [];

    const start = performance.now();
    for (const amount of invalidAmounts) {
      results.push(await this.placeBid(user, auctionId, amount));
    }
    const duration = performance.now() - start;

    const metrics = this.computeMetrics(results, duration);
    const passed = metrics.failures === results.length;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.failures}/${metrics.requests} invalid bids rejected`);

    return {
      name: testName,
      passed,
      metrics,
      errors: this.collectErrors(results),
      details: passed ? 'All invalid amounts rejected' : 'Some invalid bids were accepted!',
    };
  }

  async testAuthValidation(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Auth Validation';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const start = performance.now();

    const invalidRes = await fetchWithRetry(`${this.config.apiUrl}/auctions/${auctionId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid_token_12345' },
      body: JSON.stringify({ amount: 1000 }),
    });

    const noAuthRes = await fetchWithRetry(`${this.config.apiUrl}/auctions/${auctionId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1000 }),
    });

    const duration = performance.now() - start;

    const invalidOk = invalidRes.status === 401 || invalidRes.status === 429;
    const noAuthOk = noAuthRes.status === 401 || noAuthRes.status === 429;
    const passed = invalidOk && noAuthOk;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: InvalidToken=${invalidRes.status}, NoAuth=${noAuthRes.status}`);

    return {
      name: testName,
      passed,
      metrics: {
        requests: 2, successes: 0, failures: 2,
        p50: 0, p95: 0, p99: 0,
        maxMs: duration, minMs: 0, avgMs: duration / 2, rps: 0, stdDev: 0,
      },
      errors: {},
      details: passed ? 'Unauthorized requests properly rejected' : 'Auth validation failed!',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBSOCKET TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  async testWebSocketConnections(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'WebSocket Connections';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const results: WsResult[] = [];
    const sockets: Socket[] = [];
    const connectionCount = Math.min(this.config.wsConnectionCount, this.users.length);

    const start = performance.now();

    // Connect multiple WebSocket clients
    const connectionPromises = this.users.slice(0, connectionCount).map((user, i) => {
      return new Promise<WsResult>((resolve) => {
        const connectStart = performance.now();
        let messagesReceived = 0;

        const socket = io(this.config.wsUrl, {
          transports: ['websocket'],
          auth: { token: user.token },
          timeout: 5000,
        });

        sockets.push(socket);

        const timeout = setTimeout(() => {
          socket.disconnect();
          resolve({
            connected: false,
            latencyMs: performance.now() - connectStart,
            messagesReceived: 0,
            error: 'Connection timeout',
          });
        }, 5000);

        socket.on('connect', () => {
          clearTimeout(timeout);
          socket.emit('joinAuction', { auctionId });
        });

        socket.on('auctionJoined', () => {
          resolve({
            connected: true,
            latencyMs: performance.now() - connectStart,
            messagesReceived,
          });
        });

        socket.on('newBid', () => messagesReceived++);
        socket.on('auctionUpdate', () => messagesReceived++);

        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          resolve({
            connected: false,
            latencyMs: performance.now() - connectStart,
            messagesReceived: 0,
            error: err.message,
          });
        });
      });
    });

    const connectionResults = await Promise.all(connectionPromises);
    results.push(...connectionResults);

    // Place a bid to test real-time updates
    await sleep(500);
    const highestBid = await this.getHighestBid(auctionId);
    const { data: auction } = await this.request<{ minBidAmount: number }>(`/auctions/${auctionId}`);
    const bidAmount = Math.max(highestBid, auction.minBidAmount || 100) + 10000;

    await this.placeBid(this.users[0], auctionId, bidAmount);
    await sleep(500);

    // Cleanup
    sockets.forEach(s => s.disconnect());

    const duration = performance.now() - start;
    const connected = results.filter(r => r.connected).length;
    const avgLatency = results.length > 0
      ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length
      : 0;

    const passed = connected >= connectionCount * 0.8; // 80% success rate

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${connected}/${connectionCount} connected, avg latency=${formatMs(avgLatency)}`);

    const errors: Record<string, number> = {};
    results.filter(r => !r.connected && r.error).forEach(r => {
      errors[r.error!] = (errors[r.error!] || 0) + 1;
    });

    return {
      name: testName,
      passed,
      metrics: {
        requests: connectionCount,
        successes: connected,
        failures: connectionCount - connected,
        p50: percentile(results.map(r => r.latencyMs), 50),
        p95: percentile(results.map(r => r.latencyMs), 95),
        p99: percentile(results.map(r => r.latencyMs), 99),
        maxMs: Math.max(...results.map(r => r.latencyMs)),
        minMs: Math.min(...results.map(r => r.latencyMs)),
        avgMs: avgLatency,
        rps: 0,
        stdDev: stdDev(results.map(r => r.latencyMs)),
      },
      errors,
      details: `${connected} connections established`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICATION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  async verifyBidOrdering(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Bid Ordering Verification';
    process.stdout.write(`${c.cyan}Verifying ${testName}...${c.reset}`);

    const start = performance.now();
    const { data: leaderboard } = await this.request<Array<{ amount: number; createdAt: string }>>(
      `/auctions/${auctionId}/leaderboard`
    );
    const duration = performance.now() - start;

    let isOrdered = true;
    for (let i = 1; i < (leaderboard || []).length; i++) {
      if (leaderboard[i].amount > leaderboard[i - 1].amount) {
        isOrdered = false;
        break;
      }
    }

    console.log(`\r${isOrdered ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${(leaderboard || []).length} bids, ordering=${isOrdered ? 'correct' : 'WRONG'}`);

    return {
      name: testName,
      passed: isOrdered,
      metrics: {
        requests: 1, successes: 1, failures: 0,
        p50: duration, p95: duration, p99: duration,
        maxMs: duration, minMs: duration, avgMs: duration, rps: 0, stdDev: 0,
      },
      errors: isOrdered ? {} : { 'Incorrect ordering': 1 },
      details: `${(leaderboard || []).length} total bids`,
    };
  }

  async verifyFinancialIntegrity(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Financial Integrity';
    process.stdout.write(`${c.cyan}Verifying ${testName}...${c.reset}`);

    const start = performance.now();

    let totalInitial = 0;
    let totalBalance = 0;
    let totalFrozen = 0;

    const balances: { initial: number; balance: number; frozen: number }[] = [];
    for (const user of this.users) {
      const res = await fetchWithRetry(`${this.config.apiUrl}/users/balance`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const data = await res.json().catch(() => ({})) as { balance?: number; frozenBalance?: number };
      balances.push({
        initial: user.initialDeposit,
        balance: data.balance ?? 0,
        frozen: data.frozenBalance ?? 0,
      });
    }

    balances.forEach(b => {
      totalInitial += b.initial;
      totalBalance += b.balance;
      totalFrozen += b.frozen;
    });

    const duration = performance.now() - start;

    const totalInSystem = totalBalance + totalFrozen;
    const diff = Math.abs(totalInitial - totalInSystem);
    const passed = diff <= totalInitial * 0.01;

    const details = [
      `Deposited: ${formatNumber(totalInitial)}`,
      `Available: ${formatNumber(totalBalance)}`,
      `Frozen: ${formatNumber(totalFrozen)}`,
      `Total: ${formatNumber(totalInSystem)}`,
      `Diff: ${diff.toFixed(2)}`,
    ].join(' | ');

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${passed ? 'VALID' : 'MISMATCH'} (diff=${diff.toFixed(2)})`);

    return {
      name: testName,
      passed,
      metrics: {
        requests: this.users.length, successes: passed ? 1 : 0, failures: passed ? 0 : 1,
        p50: 0, p95: 0, p99: 0, maxMs: duration, minMs: 0, avgMs: 0, rps: 0, stdDev: 0,
      },
      errors: passed ? {} : { 'Financial mismatch': 1 },
      details,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════════════

  printResults(): void {
    const currentMemory = process.memoryUsage().heapUsed;
    const memoryDelta = currentMemory - this.startMemory;

    console.log();
    console.log(`${c.bold}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}                    LOAD TEST RESULTS SUMMARY${c.reset}`);
    console.log(`${'═'.repeat(70)}`);
    console.log();

    console.log(`${c.dim}${'─'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}Test Name                          Status    Reqs   Success   p99${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(70)}${c.reset}`);

    let totalPassed = 0;
    let totalFailed = 0;

    for (const result of this.testResults) {
      const status = result.passed ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`;
      const successRate = result.metrics.requests > 0
        ? `${((result.metrics.successes / result.metrics.requests) * 100).toFixed(0)}%`
        : 'N/A';
      const p99 = result.metrics.p99 > 0 ? formatMs(result.metrics.p99) : '-';

      console.log(
        `${result.name.padEnd(35)} ${status.padEnd(13)} ${String(result.metrics.requests).padStart(5)}   ${successRate.padStart(7)}   ${p99.padStart(6)}`
      );

      if (result.passed) totalPassed++;
      else totalFailed++;
    }

    console.log(`${c.dim}${'─'.repeat(70)}${c.reset}`);
    console.log();

    // Verbose output
    if (this.config.verbose) {
      for (const result of this.testResults) {
        if (result.histogram) {
          console.log(`${c.bold}${result.name} - Latency Distribution:${c.reset}`);
          console.log(result.histogram);
          console.log();
        }
      }
    }

    // Aggregate stats
    const allRequests = this.testResults.reduce((sum, r) => sum + r.metrics.requests, 0);
    const allSuccesses = this.testResults.reduce((sum, r) => sum + r.metrics.successes, 0);
    const allP99s = this.testResults.filter(r => r.metrics.p99 > 0).map(r => r.metrics.p99);
    const maxP99 = allP99s.length ? Math.max(...allP99s) : 0;
    const avgP99 = allP99s.length ? allP99s.reduce((a, b) => a + b, 0) / allP99s.length : 0;

    console.log(`${c.bold}Aggregate Statistics:${c.reset}`);
    console.log(`  Total Requests:     ${formatNumber(allRequests)}`);
    console.log(`  Total Successes:    ${formatNumber(allSuccesses)}`);
    console.log(`  Overall Success:    ${allRequests > 0 ? ((allSuccesses / allRequests) * 100).toFixed(1) : 0}%`);
    console.log(`  Worst p99 Latency:  ${formatMs(maxP99)}`);
    console.log(`  Average p99:        ${formatMs(avgP99)}`);
    console.log(`  Memory Delta:       ${(memoryDelta / 1024 / 1024).toFixed(2)} MB`);
    console.log();

    // Collect all errors
    const allErrors: Record<string, number> = {};
    this.testResults.forEach(r => {
      Object.entries(r.errors).forEach(([msg, count]) => {
        allErrors[msg] = (allErrors[msg] || 0) + count;
      });
    });

    if (Object.keys(allErrors).length > 0) {
      console.log(`${c.bold}Error Summary:${c.reset}`);
      Object.entries(allErrors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([msg, count]) => {
          console.log(`  ${c.dim}${count}x${c.reset} ${msg}`);
        });
      console.log();
    }

    console.log(`${'═'.repeat(70)}`);
    if (totalFailed === 0) {
      console.log(`${c.bgGreen}${c.white}${c.bold}  ALL ${totalPassed} TESTS PASSED  ${c.reset}`);
    } else {
      console.log(`${c.bgRed}${c.white}${c.bold}  ${totalFailed} TEST(S) FAILED, ${totalPassed} PASSED  ${c.reset}`);
    }
    console.log(`${'═'.repeat(70)}`);
    console.log();
  }

  async runAllTests(): Promise<void> {
    const auctionId = await this.createAndStartAuction();
    const suites = this.config.testSuites;

    console.log();
    console.log(`${c.bold}Running Test Suite...${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);

    const runCore = suites.includes('all') || suites.includes('core');
    const runStress = suites.includes('all') || suites.includes('stress');
    const runEdge = suites.includes('all') || suites.includes('edge');
    const runWs = suites.includes('all') || suites.includes('ws');
    const runVerify = suites.includes('all') || suites.includes('verify');

    // Core functionality tests
    if (runCore) {
      this.testResults.push(await this.testConcurrentBidStorm(auctionId));
      this.testResults.push(await this.testRapidSequentialBids(auctionId));
      this.testResults.push(await this.testTieBreaking(auctionId));
    }

    // Stress tests
    if (runStress) {
      this.testResults.push(await this.testHighFrequencyStress(auctionId));
      await sleep(2000);
      this.testResults.push(await this.testMassiveConcurrentStress(auctionId));
      this.testResults.push(await this.testRateLimitBehavior(auctionId));
      this.testResults.push(await this.testSameUserRaceCondition(auctionId));
    }

    // Edge case tests
    if (runEdge) {
      this.testResults.push(await this.testInsufficientFunds(auctionId));
      this.testResults.push(await this.testInvalidBidAmounts(auctionId));
      this.testResults.push(await this.testAuthValidation(auctionId));
    }

    // WebSocket tests
    if (runWs) {
      this.testResults.push(await this.testWebSocketConnections(auctionId));
    }

    // Verification
    if (runVerify) {
      this.testResults.push(await this.verifyBidOrdering(auctionId));
      this.testResults.push(await this.verifyFinancialIntegrity(auctionId));
    }

    this.printResults();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsedArgs = parseArgs(args);

  if (parsedArgs.help) {
    printHelp();
    process.exit(0);
  }

  const config: Config = {
    apiUrl: parsedArgs.apiUrl || process.env.API_URL || 'http://localhost:4000/api',
    wsUrl: parsedArgs.wsUrl || process.env.WS_URL || 'ws://localhost:4000',
    userCount: parsedArgs.userCount || 20,
    depositAmount: parsedArgs.depositAmount || 50000,
    itemCount: parsedArgs.itemCount || 10,
    concurrencyLimit: parsedArgs.concurrencyLimit || 50,
    highFrequencyDurationMs: parsedArgs.highFrequencyDurationMs || 5000,
    highFrequencyDelayMs: parsedArgs.highFrequencyDelayMs || 50,
    wsConnectionCount: parsedArgs.wsConnectionCount || 50,
    warmupRequests: parsedArgs.warmupRequests || 10,
    testSuites: parsedArgs.testSuites || ['all'],
    verbose: parsedArgs.verbose || false,
  };

  console.log();
  console.log(`${c.bold}${'═'.repeat(50)}${c.reset}`);
  console.log(`${c.bold}   AUCTION SYSTEM LOAD TEST SUITE v${VERSION}${c.reset}`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`${c.dim}API:${c.reset}       ${config.apiUrl}`);
  console.log(`${c.dim}WebSocket:${c.reset} ${config.wsUrl}`);
  console.log(`${c.dim}Users:${c.reset}     ${config.userCount}`);
  console.log(`${c.dim}Deposit:${c.reset}   ${formatNumber(config.depositAmount)}`);
  console.log(`${c.dim}Items:${c.reset}     ${config.itemCount}`);
  console.log(`${c.dim}Suites:${c.reset}    ${config.testSuites.join(', ')}`);
  console.log(`${'═'.repeat(50)}`);
  console.log();

  const tester = new LoadTester(config);

  try {
    await tester.initialize();
    await tester.warmup();
    await tester.runAllTests();
  } catch (error) {
    console.error(`${c.red}Fatal error:${c.reset}`, error);
    process.exit(1);
  }
}

main();
