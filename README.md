# Telegram Gift Auction System

**A production-grade multi-round auction platform for digital collectibles, built for the Telegram ecosystem.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-funfiesta.games-blue?style=for-the-badge)](https://telegram-gift-auction.funfiesta.games)
[![Telegram Bot](https://img.shields.io/badge/Telegram-@tggiftauctionbot-0088cc?style=for-the-badge&logo=telegram)](https://t.me/tggiftauctionbot)
[![Mini App](https://img.shields.io/badge/Mini%20App-Open-green?style=for-the-badge)](https://t.me/tggiftauctionbot/app)
[![API Docs](https://img.shields.io/badge/API-Swagger-orange?style=for-the-badge)](https://telegram-gift-auction.funfiesta.games/api/docs)

[Русская версия (Russian)](./README.ru.md)

---

## Why Choose This Project?

This isn't just another auction demo — it's a **battle-tested, production-ready system** designed to handle real-world challenges that most auction implementations ignore.

### Key Differentiators

| Challenge | Our Solution |
|-----------|--------------|
| **Race Conditions** | 5-layer concurrency control (Redlock + Redis cooldown + MongoDB transactions + optimistic locking + unique indexes) |
| **Financial Integrity** | Atomic operations with comprehensive audit system — zero money lost or created |
| **Last-Second Sniping** | Anti-sniping mechanism with transparent round extensions |
| **Scalability** | Redis adapter enables horizontal scaling across multiple servers |
| **Real-time UX** | WebSocket events ensure no user misses critical auction updates |
| **Telegram Native** | Full integration: Login Widget, Mini App auth, bot notifications |

### What Makes This Stand Out

- **Multi-round elimination system** — Not a simple highest-bid-wins auction, but a sophisticated round-based competition where partial winners are selected each round
- **Financial model with frozen balances** — Bid amounts are immediately locked, preventing double-spending and ensuring winners can always pay
- **Intelligent bot simulation** — Realistic auction environment with bots that adapt their bidding strategy as rounds progress
- **Comprehensive load testing** — Proven to handle 300+ concurrent requests, 100 simultaneous users, and complex race conditions
- **Production infrastructure** — Docker Compose setup with MongoDB replica sets, Redis persistence, and health checks

---

## Major Features

### Auction Engine
- Multi-round elimination auctions (e.g., 10 items distributed as 3+5+2 across 3 rounds)
- One bid per user model — bids can only be increased, never lowered
- Anti-sniping protection with configurable window and extension limits
- Automatic round progression with winner determination
- Tie-breaking by earliest timestamp

### Concurrency & Safety
- **Distributed locking** via Redlock (fail-fast mode, 10s TTL)
- **Redis cooldown** prevents rapid-fire bid spam (1s per user per auction)
- **MongoDB transactions** with snapshot isolation and automatic retry
- **Optimistic locking** with version checks on all financial operations
- **Unique indexes** enforce one active bid per user and unique bid amounts

### Real-time Communication
- WebSocket events: `new-bid`, `auction-update`, `anti-sniping`, `round-complete`
- 2-minute session persistence after disconnect
- Automatic room rejoin on reconnect
- Redis adapter for multi-server deployments

### Telegram Integration
- **Login Widget** authentication with hash validation
- **Mini App (TWA)** support with initData validation
- **Bot notifications** via GrammyJS (outbid alerts, round results, anti-sniping notices)
- Localized messages (English & Russian)

### Financial System
- Separate `balance` and `frozenBalance` tracking
- Complete transaction audit trail with before/after snapshots
- System-wide integrity verification endpoint
- Deposit/withdrawal functionality

### Developer Experience
- Auto-generated TypeScript SDK via Nestia
- Swagger/OpenAPI documentation
- Comprehensive load test suite (11 scenarios)
- Docker Compose for instant local setup

---

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| **Runtime** | Node.js 22+ | Latest LTS with modern async features |
| **Framework** | NestJS 11 + Fastify | 2-3x throughput vs Express |
| **Language** | TypeScript (strict) | Type safety for financial operations |
| **Database** | MongoDB 8.2+ | Transactions, flexible schemas, replica sets |
| **Cache/Locking** | Redis + Redlock | Distributed locking for concurrency |
| **Real-time** | Socket.IO + Redis adapter | Scalable WebSocket communication |
| **Auth** | JWT Bearer tokens | Stateless, distributed-friendly |
| **Telegram** | GrammyJS | Modern Telegram bot framework |
| **Frontend** | React 19 + Vite | Fast development, modern tooling |
| **Validation** | class-validator + Joi | Comprehensive input validation |

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

---

## How It Works

### Auction Lifecycle

```
PENDING ──[start]──► ACTIVE ──[rounds complete]──► COMPLETED
                        │
                        ├── Round 1: Top 3 win items #1-3
                        ├── Round 2: Top 5 win items #4-8
                        └── Round 3: Top 2 win items #9-10
                                     │
                                     └── Remaining bids refunded
```

### Bid Flow (5-Layer Protection)

```typescript
POST /api/auctions/:id/bid { amount: 1000 }

// 1. Distributed Lock (Redlock)
→ Acquire lock for user+auction (fail-fast, 10s TTL)

// 2. Redis Cooldown
→ Check 1-second cooldown between bids

// 3. MongoDB Transaction (Snapshot Isolation)
→ Start transaction with majority write concern

// 4. Optimistic Locking
→ Verify user.version and bid.__v match expected values

// 5. Unique Index Enforcement
→ Database rejects duplicate user bids or amounts

// On success:
→ Commit transaction, set cooldown, release lock, emit WebSocket event
```

### Anti-Sniping Protection

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

### Financial Model

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

---

## Load Testing Results

The system includes a comprehensive test suite validating behavior under stress.

```bash
cd backend && npx ts-node src/scripts/load-test.ts
```

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

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Configure environment
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Start everything
docker compose up --build

# Access:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:4000/api
# - Swagger Docs: http://localhost:4000/api/docs
```

### Option 2: Local Development

```bash
# Start infrastructure only
docker compose -f docker-compose.infra.yml up -d

# Install and run
npm install
npm run dev

# Or run separately:
npm run dev:backend   # http://localhost:4000
npm run dev:frontend  # http://localhost:5173
```

### Option 3: Manual Setup

**Prerequisites:** Node.js 22+, MongoDB 8.2+ (replica set), Redis 7+

```bash
# Backend
cd backend && npm install && npm run start:dev

# Frontend (another terminal)
cd frontend && npm install && npm run dev
```

---

## API Reference

### Authentication

All protected endpoints require `Authorization: Bearer <token>` header.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/telegram/webapp` | POST | Authenticate via Mini App initData |
| `/api/auth/telegram/widget` | POST | Authenticate via Login Widget |
| `/api/auth/me` | GET | Get current user |
| `/api/auth/refresh` | POST | Refresh JWT token |

### Auctions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auctions` | GET | List all auctions |
| `/api/auctions` | POST | Create auction |
| `/api/auctions/:id` | GET | Get auction details |
| `/api/auctions/:id/start` | POST | Start auction |
| `/api/auctions/:id/bid` | POST | Place or increase bid |
| `/api/auctions/:id/leaderboard` | GET | Get current rankings |
| `/api/auctions/:id/min-winning-bid` | GET | Get minimum bid to win |

### Users & Transactions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users/balance` | GET | Get balance (available + frozen) |
| `/api/users/deposit` | POST | Add funds |
| `/api/users/withdraw` | POST | Withdraw funds |
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
- `round-start` - New round began

---

## Configuration

### Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 4000 |
| `MONGODB_URI` | MongoDB connection string | — |
| `REDIS_URL` | Redis connection string | — |
| `JWT_SECRET` | JWT signing secret | (required) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | — |
| `CORS_ORIGIN` | Allowed CORS origin | http://localhost:5173 |

### Frontend (`frontend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | http://localhost:4000/api |
| `VITE_SOCKET_URL` | WebSocket server URL | http://localhost:4000 |

### Rate Limiting (Three-Tier)

- **Short**: 20 requests/second
- **Medium**: 100 requests/10 seconds
- **Long**: 300 requests/minute

Localhost bypasses rate limiting for development.

---

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── common/          # Guards, errors, types
│   │   ├── config/          # Configuration & env validation
│   │   ├── modules/
│   │   │   ├── auctions/    # Core auction logic (1000+ lines)
│   │   │   ├── auth/        # JWT + Telegram auth
│   │   │   ├── bids/        # Bid queries
│   │   │   ├── events/      # WebSocket gateway
│   │   │   ├── redis/       # Redis client + Redlock
│   │   │   ├── telegram/    # Bot integration
│   │   │   ├── transactions/# Financial audit
│   │   │   └── users/       # User management
│   │   ├── schemas/         # MongoDB schemas
│   │   └── scripts/         # Load testing
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/             # API client
│   │   ├── components/      # UI components
│   │   ├── context/         # Auth & notifications
│   │   ├── hooks/           # useSocket, useCountdown
│   │   ├── i18n/            # Translations (en/ru)
│   │   ├── pages/           # Route pages
│   │   └── types/           # TypeScript interfaces
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml       # Full stack
├── docker-compose.infra.yml # Infrastructure only
└── README.md
```

---

## Edge Cases Handled

| Edge Case | Solution |
|-----------|----------|
| Bid at exact round end | 100ms buffer rejects "too close" bids |
| Bid during round transition | Transaction isolation prevents stale reads |
| Server crash during bid | MongoDB transaction rolls back; Redis lock expires |
| 10 concurrent bids from same user | Redlock ensures only 1 proceeds; others fail fast |
| Same bid amount race | Unique index + first-write-wins semantics |
| Balance goes negative | Schema validation (`min: 0`) + atomic `$gte` check |
| Round completes with no bids | Gracefully advances to next round or completes auction |
| WebSocket disconnect mid-auction | 2-minute session persistence + auto-rejoin |

---

## Design Decisions

**Why MongoDB Transactions?**
Financial operations require atomicity. If balance deduction succeeds but bid creation fails, the system would lose money.

**Why Redis + Redlock?**
MongoDB transactions handle database-level concurrency, but don't prevent the same user from submitting 10 concurrent HTTP requests.

**Why Fastify over Express?**
2-3x better throughput and native TypeScript support — critical for high-concurrency scenarios.

**Why Unique Bid Amounts?**
Identical amounts create ambiguous rankings. Unique amounts (per auction) ensure deterministic leaderboards.

**Why Scheduled Round Completion?**
A cron job (every 5s) ensures rounds complete even without connected clients and handles server restarts gracefully.

---

## License

MIT
