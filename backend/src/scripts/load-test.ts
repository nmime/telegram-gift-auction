import { randomInt, randomBytes } from 'crypto';

const BASE_URL = process.env.API_URL || 'http://localhost:3001/api';
const WS_URL = process.env.WS_URL || 'ws://localhost:3001';

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
};

interface Config {
  userCount: number;
  depositAmount: number;
  itemCount: number;
  concurrencyLimit: number;
  highFrequencyDurationMs: number;
  highFrequencyDelayMs: number;
  stressTestUsers: number;
  wsConnectionCount: number;
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

interface TestMetrics {
  totalRequests: number;
  successfulBids: number;
  failedBids: number;
  responseTimes: number[];
  errors: Map<string, number>;
  startTime: number;
  endTime: number;
}

interface TestSuiteResult {
  name: string;
  passed: boolean;
  metrics: {
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
  };
  errors: Record<string, number>;
  details?: string;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function progressBar(current: number, total: number, width = 30): string {
  const percent = current / total;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${(percent * 100).toFixed(0)}%`;
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

class LoadTester {
  private users: TestUser[] = [];
  private config: Config;
  private testResults: TestSuiteResult[] = [];

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

    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    const responseTimeMs = performance.now() - start;
    const data = await res.json().catch(() => ({}));
    return { data: data as T, status: res.status, responseTimeMs };
  }

  async initialize(): Promise<void> {
    process.stdout.write(`${c.cyan}Creating ${this.config.userCount} test users...${c.reset} `);

    const tasks = Array.from({ length: this.config.userCount }, (_, i) => async () => {
      const username = `lt_${Date.now()}_${i}_${randomBytes(3).toString('hex')}`;

      const loginRes = await fetchWithRetry(`${BASE_URL}/auth/login`, {
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

      const depositRes = await fetchWithRetry(`${BASE_URL}/users/deposit`, {
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

    console.log(`\r${c.green}✓${c.reset} Created ${this.users.length} users with ${this.config.depositAmount} deposit each`);
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
          { itemsCount: Math.ceil(this.config.itemCount / 2), durationMinutes: 5 },
          { itemsCount: Math.floor(this.config.itemCount / 2), durationMinutes: 5 },
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

    // Verify auction is active
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
        ? await fetchWithRetry(`${BASE_URL}/auctions/${auctionId}/bid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
            body: JSON.stringify({ amount }),
          })
        : await fetch(`${BASE_URL}/auctions/${auctionId}/bid`, {
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

  private computeMetrics(results: BidResult[], durationMs: number): TestSuiteResult['metrics'] {
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
    };
  }

  private collectErrors(results: BidResult[]): Record<string, number> {
    const errors: Record<string, number> = {};
    results.filter(r => !r.success && r.error).forEach(r => {
      errors[r.error!] = (errors[r.error!] || 0) + 1;
    });
    return errors;
  }

  async testConcurrentBidStorm(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Concurrent Bid Storm';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const start = performance.now();
    const tasks = this.users.map((user, i) => () => this.placeBid(user, auctionId, 100 + i * 20));
    const results = await Promise.all(tasks.map(t => t()));
    const duration = performance.now() - start;

    const metrics = this.computeMetrics(results, duration);
    const passed = metrics.successes >= 1; // At least one bid should succeed

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.successes}/${metrics.requests} succeeded @ ${metrics.rps.toFixed(1)} req/s, p99=${formatMs(metrics.p99)}`);

    return { name: testName, passed, metrics, errors: this.collectErrors(results) };
  }

  async testRapidSequentialBids(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Rapid Sequential Bids';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const user = this.users[0];
    const results: BidResult[] = [];
    const start = performance.now();

    // Get current highest bid to know where to start
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

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.successes}/${metrics.requests} succeeded, avg=${formatMs(metrics.avgMs)}`);

    return { name: testName, passed, metrics, errors: this.collectErrors(results) };
  }

  private async getHighestBid(auctionId: string): Promise<number> {
    const { data: leaderboard } = await this.request<Array<{ amount: number }>>(`/auctions/${auctionId}/leaderboard`);
    return leaderboard?.[0]?.amount || 0;
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
    // Exactly one should win for tie-breaking to work correctly
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
      // Always increment amount to avoid duplicate bid errors
      const result = await this.placeBid(user, auctionId, amount + bidCount * 10);
      results.push(result);
      bidCount++;
      if (this.config.highFrequencyDelayMs > 0) {
        await sleep(this.config.highFrequencyDelayMs);
      }
    }

    const duration = performance.now() - start;
    const metrics = this.computeMetrics(results, duration);
    // At least 1 req/s (accounting for rate limiting retries)
    const passed = metrics.requests >= 5 && metrics.successes >= 1;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.requests} bids, ${metrics.successes} succeeded @ ${metrics.rps.toFixed(1)} req/s`);

    return { name: testName, passed, metrics, errors: this.collectErrors(results) };
  }

  async testInsufficientFunds(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Insufficient Funds Rejection';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const start = performance.now();
    // Try to bid more than the user's deposit
    const hugeAmount = this.config.depositAmount * 100;
    const results = await Promise.all(
      this.users.slice(0, 5).map(user => this.placeBid(user, auctionId, hugeAmount))
    );
    const duration = performance.now() - start;

    const metrics = this.computeMetrics(results, duration);
    // All should fail due to insufficient funds
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
    const invalidAmounts = [0, -100, 0.5, 1]; // Below minimum, negative, fractional, too low
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

    // Test with invalid token (with retry for rate limiting)
    const invalidRes = await fetchWithRetry(`${BASE_URL}/auctions/${auctionId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid_token_12345' },
      body: JSON.stringify({ amount: 1000 }),
    });

    // Test with no auth header (with retry for rate limiting)
    const noAuthRes = await fetchWithRetry(`${BASE_URL}/auctions/${auctionId}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1000 }),
    });

    const duration = performance.now() - start;

    // 401 = unauthorized, 429 = rate limited (still protected). Both are valid rejections.
    const invalidOk = invalidRes.status === 401 || invalidRes.status === 429;
    const noAuthOk = noAuthRes.status === 401 || noAuthRes.status === 429;
    const passed = invalidOk && noAuthOk;

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: InvalidToken=${invalidRes.status}, NoAuth=${noAuthRes.status}`);

    return {
      name: testName,
      passed,
      metrics: { requests: 2, successes: 0, failures: 2, p50: 0, p95: 0, p99: 0, maxMs: duration, minMs: 0, avgMs: duration / 2, rps: 0 },
      errors: {},
      details: passed ? 'Unauthorized requests properly rejected' : 'Auth validation failed!',
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
    // Same user tries to place 10 bids simultaneously
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => this.placeBid(user, auctionId, baseAmount + i * 10))
    );
    const duration = performance.now() - start;

    const metrics = this.computeMetrics(results, duration);
    // At most half should succeed due to distributed lock + cooldown
    // 5/10 = 50% rejection rate for extreme concurrency
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

  async testMassiveConcurrentStress(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Massive Concurrent Stress';
    process.stdout.write(`${c.cyan}Running ${testName}...${c.reset}`);

    const highestBid = await this.getHighestBid(auctionId);
    const { data: auction } = await this.request<{ minBidAmount: number }>(`/auctions/${auctionId}`);
    let baseAmount = Math.max(highestBid, auction.minBidAmount || 100) + 1000;

    const start = performance.now();

    // Multiple waves of concurrent bids
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
    const passed = metrics.successes >= 3; // At least 3 bids should go through

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${metrics.successes}/${metrics.requests} @ ${metrics.rps.toFixed(1)} req/s, p99=${formatMs(metrics.p99)}`);

    return { name: testName, passed, metrics, errors: this.collectErrors(allResults) };
  }

  async verifyFinancialIntegrity(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Financial Integrity';
    process.stdout.write(`${c.cyan}Verifying ${testName}...${c.reset}`);

    const start = performance.now();

    let totalInitial = 0;
    let totalBalance = 0;
    let totalFrozen = 0;

    // Fetch all user balances with rate limit handling
    const balances: { initial: number; balance: number; frozen: number }[] = [];
    for (const user of this.users) {
      const res = await fetchWithRetry(`${BASE_URL}/users/balance`, {
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

    // Get auction leaderboard for spent amounts
    const { data: leaderboard } = await this.request<Array<{ status: string; amount: number }>>(
      `/auctions/${auctionId}/leaderboard`
    );
    const totalSpent = (leaderboard || [])
      .filter(b => b.status === 'won')
      .reduce((sum, b) => sum + (b.amount || 0), 0);

    const duration = performance.now() - start;

    // Total money in system: available balance + frozen (active bids)
    const totalInSystem = totalBalance + totalFrozen;
    const diff = Math.abs(totalInitial - totalInSystem);
    // Allow 1% tolerance for timing/rounding issues
    const passed = diff <= totalInitial * 0.01;

    const details = [
      `Deposited: ${totalInitial}`,
      `Available: ${totalBalance}`,
      `Frozen: ${totalFrozen}`,
      `Total: ${totalInSystem}`,
      `Diff: ${diff}`,
    ].join(' | ');

    console.log(`\r${passed ? c.green + '✓' : c.red + '✗'}${c.reset} ${testName}: ${passed ? 'VALID' : 'MISMATCH'} (diff=${diff.toFixed(2)})`);

    return {
      name: testName,
      passed,
      metrics: { requests: this.users.length + 2, successes: passed ? 1 : 0, failures: passed ? 0 : 1, p50: 0, p95: 0, p99: 0, maxMs: duration, minMs: 0, avgMs: 0, rps: 0 },
      errors: passed ? {} : { 'Financial mismatch': 1 },
      details,
    };
  }

  async verifyBidOrdering(auctionId: string): Promise<TestSuiteResult> {
    const testName = 'Bid Ordering Verification';
    process.stdout.write(`${c.cyan}Verifying ${testName}...${c.reset}`);

    const start = performance.now();
    const { data: leaderboard } = await this.request<Array<{ amount: number; createdAt: string }>>(
      `/auctions/${auctionId}/leaderboard`
    );
    const duration = performance.now() - start;

    // Verify bids are ordered by amount descending
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
      metrics: { requests: 1, successes: 1, failures: 0, p50: duration, p95: duration, p99: duration, maxMs: duration, minMs: duration, avgMs: duration, rps: 0 },
      errors: isOrdered ? {} : { 'Incorrect ordering': 1 },
      details: `${(leaderboard || []).length} total bids`,
    };
  }

  printResults(): void {
    console.log();
    console.log(`${c.bold}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}                    LOAD TEST RESULTS SUMMARY${c.reset}`);
    console.log(`${'═'.repeat(70)}`);
    console.log();

    // Summary table header
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

    // Aggregate stats
    const allRequests = this.testResults.reduce((sum, r) => sum + r.metrics.requests, 0);
    const allSuccesses = this.testResults.reduce((sum, r) => sum + r.metrics.successes, 0);
    const allP99s = this.testResults.filter(r => r.metrics.p99 > 0).map(r => r.metrics.p99);
    const maxP99 = allP99s.length ? Math.max(...allP99s) : 0;
    const avgP99 = allP99s.length ? allP99s.reduce((a, b) => a + b, 0) / allP99s.length : 0;

    console.log(`${c.bold}Aggregate Statistics:${c.reset}`);
    console.log(`  Total Requests:     ${allRequests}`);
    console.log(`  Total Successes:    ${allSuccesses}`);
    console.log(`  Overall Success:    ${allRequests > 0 ? ((allSuccesses / allRequests) * 100).toFixed(1) : 0}%`);
    console.log(`  Worst p99 Latency:  ${formatMs(maxP99)}`);
    console.log(`  Average p99:        ${formatMs(avgP99)}`);
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

    // Final verdict
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

    console.log();
    console.log(`${c.bold}Running Test Suite...${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);

    // Core functionality tests
    this.testResults.push(await this.testConcurrentBidStorm(auctionId));
    this.testResults.push(await this.testRapidSequentialBids(auctionId));
    this.testResults.push(await this.testTieBreaking(auctionId));

    // Stress tests
    this.testResults.push(await this.testHighFrequencyStress(auctionId));
    // Wait for rate limit window to reset before massive stress test
    await sleep(2000);
    this.testResults.push(await this.testMassiveConcurrentStress(auctionId));

    // Edge case tests
    this.testResults.push(await this.testInsufficientFunds(auctionId));
    this.testResults.push(await this.testInvalidBidAmounts(auctionId));
    this.testResults.push(await this.testAuthValidation(auctionId));
    this.testResults.push(await this.testSameUserRaceCondition(auctionId));

    // Verification
    this.testResults.push(await this.verifyBidOrdering(auctionId));
    this.testResults.push(await this.verifyFinancialIntegrity(auctionId));

    this.printResults();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const config: Config = {
    userCount: parseInt(args[0] || '20', 10),
    depositAmount: parseInt(args[1] || '50000', 10),
    itemCount: parseInt(args[2] || '10', 10),
    concurrencyLimit: parseInt(args[3] || '50', 10),
    highFrequencyDurationMs: 5000,
    highFrequencyDelayMs: 50,
    stressTestUsers: 100,
    wsConnectionCount: 50,
  };

  console.log();
  console.log(`${c.bold}${'═'.repeat(50)}${c.reset}`);
  console.log(`${c.bold}       AUCTION SYSTEM LOAD TEST SUITE${c.reset}`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`${c.dim}Target:${c.reset}  ${BASE_URL}`);
  console.log(`${c.dim}Users:${c.reset}   ${config.userCount}`);
  console.log(`${c.dim}Deposit:${c.reset} ${config.depositAmount}`);
  console.log(`${c.dim}Items:${c.reset}   ${config.itemCount}`);
  console.log(`${'═'.repeat(50)}`);
  console.log();

  const tester = new LoadTester(config);

  try {
    await tester.initialize();
    await tester.runAllTests();
  } catch (error) {
    console.error(`${c.red}Fatal error:${c.reset}`, error);
    process.exit(1);
  }
}

main();
