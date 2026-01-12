# Telegram Gift Auction System

A multi-round auction backend for digital collectibles, inspired by Telegram Gift Auctions.

**Live Demo:** [https://telegram-gift-auction.funfiesta.games](https://telegram-gift-auction.funfiesta.games)

**API Docs:** [https://telegram-gift-auction.funfiesta.games/api/docs](https://telegram-gift-auction.funfiesta.games/api/docs)

[Русская версия (Russian)](./README.ru.md)

## Product Analysis: Understanding Telegram Gift Auctions

### How Telegram Gift Auctions Work

Telegram conducts auctions for limited-edition digital gifts. Unlike traditional single-deadline auctions, this is a **multi-round elimination system**:

1. **Multiple Rounds**: An auction consists of several rounds (e.g., 3 rounds for 10 items: 3+5+2)
2. **Partial Winners Per Round**: At the end of each round, the top N bidders win items
3. **Losers Continue**: Non-winners keep their bids and compete in subsequent rounds
4. **Anti-Sniping**: Last-second bids extend the round to ensure fair competition
5. **Single Bid Per User**: Each user has ONE bid that can only be increased, never lowered

### Key Mechanics Observed

| Aspect | Behavior |
|--------|----------|
| **Bid Model** | One bid per user per auction (increase only) |
| **Ranking** | Highest bid wins; tie-breaker is earliest timestamp |
| **Winner Selection** | Top N bidders at round end (N = items in round) |
| **Money Flow** | Bid amount frozen immediately; spent on win, refunded on loss |
| **Round Transition** | Automatic; losers carry over with their current bid |
| **Anti-Sniping** | Bids in final minutes extend round duration |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (React + Vite)                      │
│  - Auction list & details        - Real-time bid updates            │
│  - Place/increase bids           - Balance management               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Backend (NestJS + Fastify)                      │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐  │
│  │  REST API  │  │  WebSocket │  │  Scheduler │  │    Guards    │  │
│  │ (Fastify)  │  │ (Socket.IO)│  │   (Cron)   │  │ (Auth/Rate)  │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘  │
│        │               │               │                 │          │
│        ▼               ▼               ▼                 ▼          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      Service Layer                            │  │
│  │                                                               │  │
│  │  AuctionsService          UsersService         BotService    │  │
│  │  ├─ placeBid()            ├─ deposit()         ├─ simulate() │  │
│  │  ├─ completeRound()       ├─ withdraw()        └─ bid()      │  │
│  │  ├─ antiSniping()         └─ getBalance()                    │  │
│  │  └─ getLeaderboard()                                         │  │
│  │                                                               │  │
│  │  TransactionsService      EventsGateway                      │  │
│  │  ├─ recordTransaction()   ├─ emitNewBid()                    │  │
│  │  └─ getHistory()          ├─ emitRoundComplete()             │  │
│  │                           └─ emitAntiSniping()               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                    │                                │
└────────────────────────────────────┼────────────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐
│       MongoDB       │  │        Redis        │  │                 │
│                     │  │                     │  │                 │
│  users              │  │  Distributed Locks  │  │    WebSocket    │
│  ├─ balance         │  │  (Redlock)          │  │    Clients      │
│  └─ frozenBalance   │  │                     │  │                 │
│                     │  │  Bid Cooldowns      │  │                 │
│  auctions           │  │  (per user/auction) │  │                 │
│  ├─ roundsConfig[]  │  │                     │  │                 │
│  └─ rounds[]        │  └─────────────────────┘  └─────────────────┘
│                     │
│  bids               │
│  ├─ amount          │
│  └─ status          │
│                     │
│  transactions       │
│  └─ audit trail     │
└─────────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 22+ |
| Language | TypeScript (strict) |
| Framework | NestJS 11 with Fastify |
| Database | MongoDB 8.2+ (replica set) |
| Cache/Locking | Redis + Redlock |
| Real-time | Socket.IO |
| Auth | JWT (Bearer token) |
| Validation | class-validator, Joi |

---

## How It Works

### 1. Auction Lifecycle

```
PENDING ──[start]──► ACTIVE ──[rounds complete]──► COMPLETED
                        │
                        ├── Round 1: Top 3 win items #1-3
                        ├── Round 2: Top 5 win items #4-8
                        └── Round 3: Top 2 win items #9-10
                                     │
                                     └── Remaining bids refunded
```

### 2. Placing a Bid

```typescript
// User places bid of 1000
POST /api/auctions/:id/bid { amount: 1000 }

// System flow:
1. Acquire distributed lock (Redlock) → prevents concurrent bids from same user
2. Check Redis cooldown → prevents rapid-fire bids
3. Start MongoDB transaction (snapshot isolation)
4. Validate: auction active, round not ended, sufficient balance
5. Freeze funds: balance -= 1000, frozenBalance += 1000
6. Create/update bid record
7. Check anti-sniping: extend round if within window
8. Commit transaction
9. Set cooldown in Redis
10. Release lock
11. Emit WebSocket event
```

### 3. Financial Model

```
User Balance:
  ├── balance (available for bidding)
  └── frozenBalance (locked in active bids)

Invariant: A user's total value = balance + frozenBalance + spent on wins

Bid Lifecycle:
  Place:  balance -= amount,  frozenBalance += amount
  Win:    frozenBalance -= amount  (money spent)
  Refund: frozenBalance -= amount, balance += amount (money returned)
```

### 4. Anti-Sniping Mechanism

```
Round End: 10:00:00
Anti-sniping Window: 5 minutes
Extension: 5 minutes
Max Extensions: 6

Timeline:
  09:54:59 - Bid placed → No extension (outside window)
  09:55:01 - Bid placed → Round extended to 10:05:00 (extension #1)
  10:04:30 - Bid placed → Round extended to 10:10:00 (extension #2)
  ... up to 6 extensions maximum
```

### 5. Winner Determination

```typescript
// At round end:
const bids = await Bid.find({ status: 'active' })
  .sort({ amount: -1, createdAt: 1 });  // Highest amount, earliest timestamp

const winners = bids.slice(0, itemsInRound);
const losers = bids.slice(itemsInRound);

// Winners: bid.status = 'won', frozenBalance deducted
// Losers: continue to next round (or refund if last round)
```

---

## Concurrency & Race Condition Handling

The system handles extreme concurrency through multiple layers:

### Layer 1: Distributed Locking (Redis + Redlock)

```typescript
// Only one request per user per auction can proceed at a time
const lock = await redlock.acquire([`bid-lock:${userId}:${auctionId}`], 10000);
try {
  // Process bid
} finally {
  await lock.release();
}
```

- **Fail-fast mode**: Concurrent requests immediately rejected (no waiting)
- **TTL protection**: Lock auto-expires after 10 seconds (prevents deadlocks)

### Layer 2: Redis Cooldown

```typescript
// After successful bid, set 1-second cooldown
await redis.set(`bid-cooldown:${userId}:${auctionId}`, '1', 'PX', 1000);

// Subsequent requests within 1 second are rejected
if (await redis.exists(cooldownKey)) {
  throw new ConflictException('Please wait before placing another bid');
}
```

### Layer 3: MongoDB Transactions

```typescript
session.startTransaction({
  readConcern: { level: 'snapshot' },  // Consistent reads
  writeConcern: { w: 'majority' },     // Durable writes
});
```

- **Snapshot isolation**: Transaction sees consistent data from start
- **Automatic retry**: Transient errors (WriteConflict) trigger exponential backoff retry

### Layer 4: Optimistic Locking

```typescript
// User balance update with version check
await User.findOneAndUpdate(
  { _id: userId, version: user.version },  // Must match current version
  { $inc: { balance: -amount, version: 1 } }
);

// Bid update with version check
await Bid.findOneAndUpdate(
  { _id: bidId, __v: originalVersion },
  { amount: newAmount, $inc: { __v: 1 } }
);
```

### Layer 5: Unique Database Indexes

```typescript
// Only one active bid per user per auction
BidSchema.index(
  { auctionId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

// Only one bid at each amount per auction
BidSchema.index(
  { auctionId: 1, amount: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);
```

---

## API Reference

### Authentication

All protected endpoints require `Authorization: Bearer <token>` header.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Login/register (returns JWT) |
| `/api/auth/logout` | POST | Logout |
| `/api/auth/me` | GET | Get current user |

### Users

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users/balance` | GET | Get balance (available + frozen) |
| `/api/users/deposit` | POST | Add funds |
| `/api/users/withdraw` | POST | Withdraw funds |

### Auctions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auctions` | GET | List all auctions |
| `/api/auctions` | POST | Create auction |
| `/api/auctions/:id` | GET | Get auction details |
| `/api/auctions/:id/start` | POST | Start auction |
| `/api/auctions/:id/bid` | POST | Place or increase bid |
| `/api/auctions/:id/leaderboard` | GET | Get current rankings |
| `/api/auctions/:id/my-bids` | GET | Get user's bids |

### Transactions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transactions` | GET | Get transaction history |

### WebSocket Events

**Client → Server:**
- `join-auction` - Subscribe to auction updates
- `leave-auction` - Unsubscribe

**Server → Client:**
- `new-bid` - New bid placed
- `auction-update` - Auction state changed
- `anti-sniping` - Round extended
- `round-complete` - Round ended with winners
- `auction-complete` - Auction finished

**Connection Recovery:**
- Sessions persist for 2 minutes after disconnect
- Automatic room rejoin on reconnect (no re-subscription needed)
- Missed events delivered on recovery
- Powered by Socket.IO + Redis adapter

---

## Load Testing

The system includes a comprehensive load test suite that validates behavior under concurrent stress.

### Running Tests

```bash
cd backend
npx ts-node src/scripts/load-test.ts
```

### Test Scenarios

| Test | What It Validates | Expected Result |
|------|-------------------|-----------------|
| **Concurrent Bid Storm** | 20 users bid simultaneously | All bids processed |
| **Rapid Sequential Bids** | 20 quick sequential bids | All succeed |
| **Tie-Breaking** | 10 users bid same amount | Only 1 wins (first timestamp) |
| **High-Frequency Stress** | 75 bids rapid-fire | High success rate |
| **Massive Concurrent** | 60 simultaneous requests | All processed correctly |
| **Insufficient Funds** | Bid with no balance | Rejected with 400 |
| **Invalid Bid** | Negative/zero amounts | Rejected with 400 |
| **Auth Validation** | Invalid/missing token | Rejected with 401 |
| **Same-User Race** | 10 concurrent bids from 1 user | Only 3-5 succeed (lock prevents rest) |
| **Bid Ordering** | Verify leaderboard order | Correct ranking |
| **Financial Integrity** | Verify no money lost/created | Balance equation holds |

### Sample Output

```
══════════════════════════════════════════════════
       AUCTION SYSTEM LOAD TEST SUITE
══════════════════════════════════════════════════

✓ Concurrent Bid Storm: 20/20 succeeded @ 35.3 req/s
✓ Rapid Sequential Bids: 20/20 succeeded, avg=13ms
✓ Tie-Breaking (Same Amount): 1 winner from 10 identical bids
✓ High-Frequency Stress: 75 bids @ 14.9 req/s
✓ Massive Concurrent Stress: 60/60 @ 16.3 req/s
✓ Insufficient Funds Rejection: 5/5 correctly rejected
✓ Invalid Bid Rejection: 4/4 rejected
✓ Auth Validation: InvalidToken=401, NoAuth=401
✓ Same-User Race Condition: 4/10 succeeded (expected ≤5)
✓ Bid Ordering Verification: ordering=correct
✓ Financial Integrity: VALID (diff=0.00)

══════════════════════════════════════════════════
  ALL 11 TESTS PASSED
══════════════════════════════════════════════════
```

---

## Quick Start

**First, configure environment files:**

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### Option 1: Docker Compose (Recommended)

```bash
docker compose up --build

# Access:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:4000/api
# - Swagger Docs: http://localhost:4000/api/docs
```

### Option 2: Local Development

```bash
# 1. Start infrastructure (MongoDB + Redis)
docker compose -f docker-compose.infra.yml up -d

# 2. Install dependencies and run
npm install
npm run dev

# Or run separately:
npm run dev:backend   # http://localhost:4000
npm run dev:frontend  # http://localhost:5173
```

### Option 3: Manual Setup

**Prerequisites:**
- Node.js 22+
- MongoDB 8.2+ (with replica set)
- Redis 7+

```bash
# Backend
cd backend
npm install
npm run start:dev

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

---

## Configuration

### Backend Environment Variables (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | 4000 |
| `MONGODB_URI` | MongoDB connection string | mongodb://localhost:27017/auction |
| `REDIS_URL` | Redis connection string | redis://localhost:6379 |
| `JWT_SECRET` | JWT signing secret | (required in production) |
| `CORS_ORIGIN` | Allowed CORS origin | http://localhost:5173 |
| `THROTTLE_TTL` | Rate limit window (ms) | 60000 |
| `THROTTLE_LIMIT` | Max requests per window | 300 |

### Frontend Environment Variables (`frontend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | http://localhost:4000/api |
| `VITE_SOCKET_URL` | WebSocket server URL | http://localhost:4000 |

### Rate Limiting

Three tiers per IP address:
- **Short**: 20 requests/second
- **Medium**: 100 requests/10 seconds
- **Long**: 300 requests/minute

Localhost (`127.0.0.1`, `::1`) bypasses rate limiting for development.

---

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── common/
│   │   │   ├── errors/              # MongoDB error type guards
│   │   │   ├── guards/              # Auth & throttle guards
│   │   │   └── types/               # Shared TypeScript interfaces
│   │   ├── config/
│   │   │   ├── configuration.ts     # App configuration loader
│   │   │   └── env.validation.ts    # Joi schema for env validation
│   │   ├── modules/
│   │   │   ├── auctions/
│   │   │   │   ├── auctions.service.ts        # Core bid/round logic
│   │   │   │   ├── auctions.controller.ts     # REST endpoints
│   │   │   │   ├── auction-scheduler.service.ts  # Cron for round completion
│   │   │   │   ├── bot.service.ts             # Bot simulation
│   │   │   │   └── dto/                       # Request/response DTOs
│   │   │   ├── auth/                # JWT authentication
│   │   │   ├── bids/                # Bid queries
│   │   │   ├── events/              # WebSocket gateway (Socket.IO)
│   │   │   ├── redis/               # Redis client + Redlock
│   │   │   ├── transactions/        # Financial audit trail
│   │   │   └── users/               # User & balance management
│   │   ├── schemas/
│   │   │   ├── auction.schema.ts    # Auction + rounds
│   │   │   ├── bid.schema.ts        # Bids with unique indexes
│   │   │   ├── user.schema.ts       # Balance + frozenBalance
│   │   │   └── transaction.schema.ts # Audit log
│   │   ├── scripts/
│   │   │   └── load-test.ts         # Comprehensive load testing
│   │   ├── app.module.ts            # Root module
│   │   └── main.ts                  # Application entry point
│   ├── test/                        # E2E tests
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/                     # API client functions
│   │   ├── components/              # Reusable UI components
│   │   ├── context/                 # Auth & notification providers
│   │   ├── hooks/                   # useSocket, useCountdown
│   │   ├── pages/
│   │   │   ├── AuctionsPage.tsx     # Auction list
│   │   │   ├── AuctionPage.tsx      # Single auction view
│   │   │   ├── CreateAuctionPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   └── TransactionsPage.tsx
│   │   ├── types/                   # TypeScript interfaces
│   │   ├── App.tsx                  # Router setup
│   │   └── main.tsx                 # Entry point
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml               # Full stack (MongoDB, Redis, Backend, Frontend)
├── docker-compose.infra.yml         # Infrastructure only (MongoDB, Redis)
├── package.json                     # Workspace root
└── README.md
```

---

## Design Decisions

### Why MongoDB Transactions?
Financial operations require atomicity. If balance deduction succeeds but bid creation fails, the system would lose money. Transactions ensure all-or-nothing behavior.

### Why Redis + Redlock?
MongoDB transactions handle database-level concurrency, but don't prevent the same user from submitting 10 concurrent HTTP requests. Redlock provides distributed locking at the application level.

### Why Fastify over Express?
Fastify offers 2-3x better throughput and native TypeScript support. Critical for high-concurrency auction scenarios.

### Why Scheduled Round Completion?
A cron job checks for expired rounds every 5 seconds. This ensures rounds complete even if no clients are connected, and handles server restarts gracefully.

### Why Unique Bid Amounts?
Allowing identical bid amounts creates ambiguous rankings. By enforcing unique amounts (per auction), the leaderboard is always deterministic.

---

## Edge Cases Handled

| Edge Case | Solution |
|-----------|----------|
| Bid at exact round end | 100ms buffer before deadline rejects "too close" bids |
| Bid during round transition | Transaction isolation prevents stale reads |
| Server crash during bid | MongoDB transaction rolls back; Redis lock expires |
| 10 concurrent bids from same user | Redlock ensures only 1 proceeds; others fail fast |
| Same bid amount race | Unique index + first-write-wins semantics |
| Balance goes negative | MongoDB schema validation (`min: 0`) + atomic `$gte` check |
| Round completes with no bids | Gracefully moves to next round or completes auction |

---

## License

MIT
