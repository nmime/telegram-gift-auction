# Telegram Gift Auction System

**Production-grade multi-round auction platform for Telegram.**

[![Live Demo](https://img.shields.io/badge/Demo-funfiesta.games-blue?style=flat-square)](https://telegram-gift-auction.funfiesta.games)
[![Telegram Bot](https://img.shields.io/badge/Bot-@tggiftauctionbot-0088cc?style=flat-square&logo=telegram)](https://t.me/tggiftauctionbot)
[![API Docs](https://img.shields.io/badge/API-Swagger-orange?style=flat-square)](https://telegram-gift-auction.funfiesta.games/api/docs)

---
## [Русская версия](./README.ru.md) 

---

· [Architecture](./docs/architecture.md) · [API](./docs/api.md) · [Testing](./docs/testing.md) · [Deployment](./docs/deployment.md)

---

## Performance (Single Process)

```
WebSocket:  63,000 emit/sec peak, 43,000/sec sustained, 0ms latency
HTTP:       600 req/s raw, 138 req/s with rate limits, 18ms latency
Grade:      A+ (production-ready)
```

Full benchmarks: [BENCHMARK_REPORT.md](./backend/test/artillery/BENCHMARK_REPORT.md)

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-round auctions** | Items distributed across rounds (e.g., 3+5+2), partial winners each round |
| **5-layer concurrency** | Redlock → Redis cooldown → MongoDB transactions → optimistic locking → unique indexes |
| **Ultra-fast bidding** | Single Redis Lua script (~2ms), WebSocket bids bypass HTTP entirely |
| **Anti-sniping** | Configurable window with automatic round extensions |
| **Financial integrity** | Frozen balances, atomic operations, complete audit trail |
| **Telegram native** | Login Widget, Mini App auth, bot notifications (GrammyJS) |
| **Horizontal scaling** | Cluster mode + Redis adapter for multi-server deployments |

---

## Tech Stack

**Backend:** NestJS 11 + Fastify · MongoDB 8 · Redis + Redlock · Socket.IO · JWT
**Frontend:** React 19 + Vite · TypeScript · i18n (en/ru)
**Infra:** Docker Compose · Node.js 22+

---

## Quick Start

```bash
# Docker (recommended)
cp backend/.env.example backend/.env
docker compose up --build

# Local development
docker compose -f docker-compose.infra.yml up -d
npm install && npm run dev
```

**Access:** Frontend `localhost:5173` · API `localhost:4000/api` · Docs `localhost:4000/api/docs`

---

## How It Works

### Auction Flow
```
PENDING → ACTIVE → COMPLETED
            ├── Round 1: Top 3 win
            ├── Round 2: Top 5 win
            └── Round 3: Top 2 win → Remaining refunded
```

### Bid Flow (5-Layer Protection)
```
1. Redlock        → Acquire distributed lock (fail-fast)
2. Redis cooldown → 1s between bids per user
3. MongoDB tx     → Snapshot isolation + retry
4. Optimistic     → Version check on user/bid
5. Unique index   → No duplicate amounts
```

### Financial Model
```
balance        = available for bidding
frozenBalance  = locked in active bids

Place bid:   balance -= X, frozenBalance += X
Win:         frozenBalance -= X (spent)
Refund:      frozenBalance -= X, balance += X
```

---

## API Overview

### REST Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/telegram/webapp` | Mini App authentication |
| `GET /api/auctions` | List auctions |
| `POST /api/auctions/:id/bid` | Place bid (standard) |
| `POST /api/auctions/:id/fast-bid` | Place bid (Redis, high-perf) |
| `GET /api/auctions/:id/leaderboard` | Current rankings |
| `GET /api/users/balance` | Get balance |

### WebSocket Events

```javascript
// Authenticate & join
socket.emit('auth', jwtToken);
socket.emit('join-auction', auctionId);

// Place bid (63K/sec possible)
socket.emit('place-bid', { auctionId, amount: 1000 });

// Receive updates
socket.on('new-bid', data => { /* ... */ });
socket.on('bid-response', ({ success, amount }) => { /* ... */ });
```

---

## Configuration

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection (replica set required) |
| `REDIS_URL` | Redis connection |
| `JWT_SECRET` | JWT signing secret |
| `TELEGRAM_BOT_TOKEN` | Bot token for notifications |
| `CLUSTER_WORKERS` | `0`=single, `auto`=all cores |

### Rate Limits
- **Short:** 20/sec · **Medium:** 100/10sec · **Long:** 300/min

---

## Load Testing

```bash
# HTTP
pnpm run load-test           # Standard
pnpm run load-test:stress    # Extreme

# WebSocket
npx artillery run test/artillery/websocket-extreme.yml  # 63K emit/s
```

---

## Design Decisions

- **MongoDB transactions** — Atomic financial operations
- **Redis Lua scripts** — Single call for all validation + bid placement (~0.02ms)
- **Background sync** — 5s interval balances speed vs durability
- **WebSocket bidding** — Eliminates HTTP overhead for max throughput
- **Unique bid amounts** — Deterministic leaderboards, no ties

More details: [docs/architecture.md](./docs/architecture.md) · [docs/concurrency.md](./docs/concurrency.md)

---

## License

MIT
