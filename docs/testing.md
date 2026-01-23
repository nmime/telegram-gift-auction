# Testing

[← Back to README](../README.md) · [Architecture](./architecture.md) · [API](./api.md) · [Auction Mechanics](./auction-mechanics.md) · [Concurrency](./concurrency.md) · [Deployment](./deployment.md)

---

## Load Test Suite

The system includes a comprehensive load test suite that validates behavior under stress conditions.

### Running Load Tests

```bash
cd backend

# Standard load test
npm run load-test

# Heavy stress test
npm run load-test -- --users 100 --deposit 100000 --stress-duration 10000
```

### Test Scenarios

The suite includes 11 test scenarios:

#### 1. Concurrent Bid Storm
- **What**: 100 different users bid simultaneously
- **Validates**: System handles concurrent load without data corruption
- **Expected**: All 100 bids succeed with unique amounts

#### 2. Rapid Sequential Bids
- **What**: Single user places 20 bids in rapid succession
- **Validates**: Bid increase logic and cooldown handling
- **Expected**: Bids processed correctly with cooldown enforcement

#### 3. Tie-Breaking (Same Amount)
- **What**: 10 users attempt to bid the same amount simultaneously
- **Validates**: Unique index enforcement and first-write-wins
- **Expected**: Exactly 1 bid succeeds, 9 rejected with 409 Conflict

#### 4. High-Frequency Stress
- **What**: Sustained high-frequency bidding over extended period
- **Validates**: System stability under continuous load
- **Expected**: >200 bids processed at >25 req/s

#### 5. Massive Concurrent Stress
- **What**: 300 concurrent requests
- **Validates**: System behavior at extreme concurrency
- **Expected**: >200 successful bids (some rejected due to contention)

**Understanding the results** (`226/300 @ 17.2 req/s`):
- **226 succeeded**: These bids were processed and stored correctly
- **74 failed**: Rejected by intentional protections (not errors)
- **17.2 req/s**: Throughput under extreme load

**Why not 300/300?** The system intentionally rejects some requests to maintain data integrity:
- **Distributed locking (Redlock)**: Prevents race conditions by rejecting concurrent requests for same user
- **Duplicate amount rejection**: Only one bid per amount allowed
- **Rate limiting**: Protects against spam/DoS attacks

**What would indicate problems:**
| Result | Meaning |
|--------|---------|
| `300/300` with duplicates in DB | Data corruption - CRITICAL BUG |
| Server crash or timeout | System can't handle load - needs optimization |
| `0/300` | System completely overwhelmed - needs scaling |
| `<100/300` with errors | Protection too aggressive or bugs |

**What indicates healthy system:**
| Result | Meaning |
|--------|---------|
| `>200/300` | Good throughput under extreme stress |
| `>15 req/s` | Acceptable processing rate |
| No duplicate bids | Data integrity maintained |
| No crashes | System stable under load |

#### 6. Insufficient Funds Rejection
- **What**: Users attempt to bid more than their balance
- **Validates**: Balance checking and rejection
- **Expected**: All bids rejected with 402 Payment Required

#### 7. Invalid Bid Rejection
- **What**: Various invalid bid attempts (negative, zero, below minimum)
- **Validates**: Input validation
- **Expected**: All rejected with 400 Bad Request

#### 8. Auth Validation
- **What**: Requests with invalid/missing authentication
- **Validates**: Authentication middleware
- **Expected**: 401 Unauthorized responses

#### 9. Same-User Race Condition
- **What**: Same user sends 10 concurrent bid requests
- **Validates**: Redlock prevents concurrent processing
- **Expected**: At most 1 succeeds (due to distributed lock)

#### 10. Bid Ordering Verification
- **What**: Verify leaderboard ordering after multiple bids
- **Validates**: Correct sorting by amount and timestamp
- **Expected**: Leaderboard matches expected order

#### 11. Financial Integrity
- **What**: Verify no money created or lost
- **Validates**: Accounting invariants
- **Expected**: Total deposits - withdrawals = balances + frozen + spent

### Sample Output (Standard Mode)

```
══════════════════════════════════════════════════
       AUCTION SYSTEM LOAD TEST SUITE
══════════════════════════════════════════════════

✓ Concurrent Bid Storm: 100/100 succeeded @ 19.9 req/s
✓ Rapid Sequential Bids: 20/20 succeeded, avg=15ms
✓ Tie-Breaking (Same Amount): 1 winner from 10 identical bids
✓ High-Frequency Stress: 219 bids @ 27.4 req/s
✓ Massive Concurrent Stress: 226/300 @ 17.2 req/s
✓ Insufficient Funds Rejection: 5/5 correctly rejected
✓ Invalid Bid Rejection: 4/4 rejected
✓ Auth Validation: InvalidToken=401, NoAuth=401
✓ Same-User Race Condition: 0/10 succeeded (expected ≤5)
✓ Bid Ordering Verification: ordering=correct
✓ Financial Integrity: VALID (diff=0.00)

══════════════════════════════════════════════════
  ALL TESTS PASSED
══════════════════════════════════════════════════
```

---

## Artillery Load Tests (v2.0.27)

Production-grade load testing with Artillery for realistic traffic simulation.

### Quick Start

```bash
cd backend

# HTTP Tests
pnpm run load-test:smoke     # Quick 10s validation
pnpm run load-test           # Standard load test
pnpm run load-test:stress    # Stress test (via -e stress environment)
pnpm run load-test:http-max  # Max throughput (1.6K-2.8K req/s)
pnpm run load-test:edge      # Edge cases validation

# WebSocket Tests
pnpm run load-test:ws        # Standard WS (100% success)
pnpm run load-test:ws-max    # Max throughput (200K emit/s)
```

### Performance Results

#### Single-Core (1 worker)

| Protocol | Peak | Sustained | Latency | Grade |
|----------|------|-----------|---------|-------|
| **WebSocket** | **200,018 emit/s** | 175,970/s | 0ms | **A+** |
| **HTTP** | **2,779 req/s** | 1,623/s | 1.3ms mean (normal), 693ms (max load) | **A** |

#### Cluster Mode (12 cores)

| Protocol | Peak | Notes |
|----------|------|-------|
| **HTTP** | **3,352 req/s** | Rate limiting active in tests |
| **WebSocket** | ~2.4M emit/s | Theoretical (requires sticky sessions) |

Enable cluster mode: `CLUSTER_WORKERS=auto` in `.env`

### Maximum Throughput Results

```
╔══════════════════════════════════════════════════════════════╗
║  WEBSOCKET (single-core)                                     ║
║    🚀 PEAK:       200,018 emit/sec                          ║
║    ⚡ SUSTAINED:  175,970 emit/sec                           ║
║    📊 TOTAL:      11,305,542 emits in 67 seconds            ║
║    ⏱️  LATENCY:   0ms (sub-millisecond)                      ║
║                                                              ║
║  HTTP (single-core)                                          ║
║    🚀 PEAK:       2,779 req/sec (nuclear test)              ║
║    ⚡ SUSTAINED:  1,623 req/sec (max-throughput test)        ║
║    📊 TOTAL:      282,599 requests in ~167 seconds          ║
╚══════════════════════════════════════════════════════════════╝
```

### Test Files (5 tests)

```
test/artillery/
├── load-test.yml                # HTTP load test (smoke/load/stress/soak envs)
├── http-max-throughput.yml      # HTTP max throughput (1.6K-2.8K req/s)
├── edge-cases.yml               # Validation and error handling
├── websocket-test.yml           # WebSocket standard (100% success)
├── websocket-max-throughput.yml # WebSocket max (200K emit/s peak)
├── functions.js                 # HTTP helpers
├── edge-case-functions.js       # Edge case helpers
├── websocket-functions.js       # WS helpers
├── reports/                     # JSON + HTML reports
└── BENCHMARK_REPORT.md          # Full benchmark report
```

Full benchmark details: [`backend/test/artillery/BENCHMARK_REPORT.md`](../backend/test/artillery/BENCHMARK_REPORT.md)

---

## Unit & Integration Tests (Vitest)

The backend uses **Vitest** as the test framework with the following structure:

```
backend/src/
├── modules/
│   └── **/*.spec.ts          # Unit tests (co-located with source)
└── tests/
    ├── unit/                  # Additional unit tests
    │   └── *.spec.ts
    └── integration/           # Integration tests (MongoDB Memory Server)
        └── *.spec.ts
```

### Running Tests

```bash
cd backend

# Run all tests (857 tests)
pnpm test

# Run only unit tests (680 tests, faster)
pnpm test:unit

# Run only integration tests (177 tests)
pnpm test:integration

# Run with coverage
pnpm test:cov

# Run unit tests with coverage
pnpm test:cov:unit

# Run specific test file
pnpm test -- auctions.service.spec.ts

# Watch mode (re-runs on file changes)
pnpm test:watch

# Visual UI mode
pnpm test:ui

# Debug tests (with inspector)
pnpm test:debug
```

### Test Configuration

| Config File | Purpose |
|-------------|---------|
| `vitest.config.ts` | Base configuration (all tests) |
| `vitest.config.unit.ts` | Unit tests only (excludes integration/) |
| `vitest.config.integration.ts` | Integration tests only |

### Test Statistics

| Category | Files | Tests | Duration |
|----------|-------|-------|----------|
| **Unit** | 15 | 680 | ~3s |
| **Integration** | 5 | 177 | ~50s |
| **Total** | 20 | 857 | ~12s (parallel) |

### Key Testing Features

- **Parallel execution**: Tests run in parallel by default
- **MongoDB Memory Server**: Integration tests use in-memory MongoDB with replica set
- **Redis Mock**: `ioredis-mock` for Redis operations
- **SWC Transform**: Fast TypeScript compilation
- **Typia Integration**: Runtime validation via `@ryoppippi/unplugin-typia`

---

## Nestia E2E Tests

The system includes comprehensive E2E tests covering all critical functionality.

### Running E2E Tests

```bash
cd backend

# Run all E2E tests
for test in test/*.e2e.ts; do npx ts-node "$test"; done

# Run specific test suite
npx ts-node test/concurrency.e2e.ts
npx ts-node test/financial-integrity.e2e.ts
npx ts-node test/websocket-events.e2e.ts
```

### Test Suites

#### 1. Concurrency Tests (`concurrency.e2e.ts`)
| Test | Description |
|------|-------------|
| Concurrent Bids Different Users | 10 users bid simultaneously with different amounts |
| Duplicate Bid Amount Rejection | Second user rejected when bidding same amount |
| Rapid Bid Increases | Same user increases bid 10 times rapidly |
| Concurrent Same-Amount Race | 5 users bid same amount - exactly 1 wins |
| Bidding on Inactive Auction | Bids rejected on pending auction |
| Leaderboard Consistency | Verify ordering under 20 concurrent bids |

#### 2. Financial Integrity Tests (`financial-integrity.e2e.ts`)
| Test | Description |
|------|-------------|
| Balance Freezing | Bid of 300 freezes 300, available drops by 300 |
| Incremental Freeze | Increasing bid only freezes the difference |
| Outbid Refund | Verify totals preserved when outbid |
| Insufficient Funds Rejection | Can't bid more than available balance |
| Multi-User Financial Integrity | Total money in system always equals total deposits |
| Bid Amount Validation | Rejects below minimum and insufficient increment |

#### 3. WebSocket Events Tests (`websocket-events.e2e.ts`)
| Test | Description |
|------|-------------|
| New Bid Event | Clients receive `new-bid` when bid placed |
| Auction Update Event | Clients receive `auction-update` on state change |
| Room Isolation | Clients only receive events from joined auction |
| Multiple Connections Same User | All user's connections receive events |
| Leave Auction Room | No events after leaving room |

#### 4. Server Timer Tests (`server-timer.e2e.ts`)
| Test | Description |
|------|-------------|
| Countdown Broadcast | Server broadcasts countdown every second |
| Anti-Sniping Extension | Timer extends on late bids |
| Multiple Clients Sync | All clients receive synced countdown |

#### 5. Redis Leaderboard Tests (`redis-leaderboard.e2e.ts`)
| Test | Description |
|------|-------------|
| Leaderboard Ordering | Bids sorted by amount descending |
| Leaderboard Pagination | Offset/limit work correctly |
| Bid Update | Updating bid updates leaderboard (no duplicates) |
| Tie Breaking | Earlier bid wins on same amount |

#### 6. Bid Carryover Tests (`bid-carryover.e2e.ts`)
| Test | Description |
|------|-------------|
| Multi-Round Auction Setup | 3-round auction created correctly |
| Bids in Multi-Round | Top N bids marked as winning |
| Min Winning Bid Calculation | Returns correct amount to enter winning |
| Carryover Schema | Bid schema supports carryover fields |

#### 7. Auction Flow Tests (`auction-flow.e2e.ts`)
| Test | Description |
|------|-------------|
| Full Auction Flow | Create → Start → Bid → Leaderboard cycle |

### Test Utilities

All tests use shared helpers from `test/utils/test-helpers.ts`:

```typescript
// Event-based waiting (no arbitrary sleeps)
await waitFor(() => bids.length === 5, { timeout: 5000 });

// Wait for WebSocket events
const events = await collectEvents(socket, 'new-bid', 3);

// Minimal delay for Redlock cleanup
await waitForLockRelease(); // 100ms

// Connect and join auction room
const socket = await connectAndJoin(WS_URL, token, auctionId);
```

### Sample Output

```
╔════════════════════════════════════════╗
║   CONCURRENCY E2E TESTS                ║
╚════════════════════════════════════════╝

--- Test: Concurrent Bids from Different Users ---

✓ Created 10 users
✓ Created auction: 696ca0f8dbc93b6282beb123
✓ 10 bids succeeded
  0 bids failed (expected due to rate limiting)
✓ Leaderboard has 10 entries
✓ All bid amounts are unique (no duplicates)

✓ Concurrent Bids Different Users test PASSED

...

╔════════════════════════════════════════╗
║   ALL CONCURRENCY TESTS PASSED!        ║
╚════════════════════════════════════════╝
```

---

## Test Coverage

### Current Test Summary

| Test Type | Framework | Count | Status |
|-----------|-----------|-------|--------|
| Unit Tests | Vitest | 680 | ✅ |
| Integration Tests | Vitest + MongoDB Memory Server | 177 | ✅ |
| E2E Tests | Nestia | 7 suites | ✅ |
| Load Tests | Artillery | 5 configs | ✅ |

### Coverage Goals

| Area | Target |
|------|--------|
| Service layer | >80% |
| Controllers | >70% |
| Guards/Middleware | >90% |
| Critical paths (bidding) | >95% |

### Generate Coverage Report

```bash
cd backend

# Full coverage report
pnpm test:cov

# Unit tests only (faster)
pnpm test:cov:unit

# View HTML report
open coverage/index.html
```

---

## Manual Testing

### Testing Bid Flow

1. Create test user with balance:
```bash
curl -X POST http://localhost:4000/api/users/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
```

2. Place a bid:
```bash
curl -X POST http://localhost:4000/api/auctions/$AUCTION_ID/bid \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'
```

3. Verify leaderboard:
```bash
curl http://localhost:4000/api/auctions/$AUCTION_ID/leaderboard \
  -H "Authorization: Bearer $TOKEN"
```

### Testing WebSocket

```javascript
// Browser console or Node.js
const io = require('socket.io-client');

const socket = io('http://localhost:4000', {
  auth: { token: 'your-jwt-token' }
});

socket.on('connect', () => {
  console.log('Connected');
  socket.emit('join-auction', { auctionId: '...' });
});

socket.on('new-bid', (data) => {
  console.log('New bid:', data);
});

socket.on('anti-sniping', (data) => {
  console.log('Round extended:', data);
});
```

### Testing Anti-Sniping

1. Create auction with short round (5 minutes)
2. Wait until anti-sniping window (last 5 minutes)
3. Place a bid
4. Verify round end time extended
5. Check WebSocket received `anti-sniping` event

### Testing Concurrent Bids

```bash
# Using GNU parallel
seq 1 100 | parallel -j100 'curl -s -X POST \
  http://localhost:4000/api/auctions/$AUCTION_ID/bid \
  -H "Authorization: Bearer $TOKEN_{}" \
  -H "Content-Type: application/json" \
  -d "{\"amount\": {}00}"'
```

---

## Financial Integrity Verification

Run integrity check to ensure no money leaked:

```bash
curl http://localhost:4000/api/transactions/verify-integrity \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected response:
```json
{
  "valid": true,
  "totalDeposits": 50000,
  "totalWithdrawals": 10000,
  "totalUserBalances": 35000,
  "totalFrozenBalances": 5000,
  "totalSpentOnWins": 0,
  "difference": 0
}
```

If `difference` is not 0, investigate:
1. Check transaction logs
2. Verify all bid state transitions recorded
3. Look for interrupted transactions in MongoDB oplog

---

## CI/CD Integration

### GitHub Actions Configuration

The project uses a comprehensive CI workflow (`.github/workflows/ci.yml`):

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Unit tests (fast, no external deps)
      - name: Run unit tests
        run: pnpm --filter backend test:unit
        env:
          CI: true
          NODE_OPTIONS: --max-old-space-size=4096

      # Integration tests (MongoDB Memory Server)
      - name: Run integration tests
        run: pnpm --filter backend test:integration
        env:
          CI: true
          NODE_OPTIONS: --max-old-space-size=4096
          MONGOMS_REPLSET: rs0

      # Coverage report
      - name: Generate coverage report
        run: pnpm --filter backend test:cov
        env:
          CI: true
```

### CI Pipeline Overview

| Job | Description | Duration |
|-----|-------------|----------|
| **CodeQL** | Security vulnerability scanning | ~3min |
| **Trivy** | Dependency vulnerability scan | ~1min |
| **Lint** | ESLint code quality checks | ~30s |
| **Test (Unit)** | Vitest unit tests (680 tests) | ~1min |
| **Test (Integration)** | Vitest integration tests (177 tests) | ~2min |
| **Build** | NestJS production build | ~1min |

### Running Tests Locally (CI-style)

```bash
cd backend

# Run exactly what CI runs
pnpm test:unit && pnpm test:integration

# With coverage (as in CI)
CI=true pnpm test:cov
```
