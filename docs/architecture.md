# Architecture

## ⚡ Performance Highlights

| Feature | Throughput | Latency |
|---------|------------|---------|
| **WebSocket Bidding** | **~3,000 rps × number of CPUs** | p99 < 5ms |
| HTTP Fast Bid (Redis) | ~500 rps × number of CPUs | p99 < 20ms |
| Standard Bid (MongoDB) | ~20 bids/sec | p99 < 4s |

**Cluster Mode**: Set `CLUSTER_WORKERS=4` for multi-core scaling (linear throughput increase).

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (React + Vite)                      │
│  - Auction list & details        - Real-time bid updates            │
│  - Place/increase bids           - Server-synced countdown          │
│  - Balance management            - Bid carryover notifications      │
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
│  │  AuctionsService          UsersService         TimerService  │  │
│  │  ├─ placeBid()            ├─ deposit()         ├─ start()    │  │
│  │  ├─ placeBidFast()        ├─ withdraw()        ├─ stop()     │  │
│  │  ├─ completeRound()       └─ getBalance()      └─ broadcast()│  │
│  │  ├─ antiSniping()                                            │  │
│  │  └─ getLeaderboard()                                         │  │
│  │                                                               │  │
│  │  LeaderboardService       TransactionsService   BotService   │  │
│  │  ├─ addBid() [ZADD]       ├─ recordTransaction()├─ simulate()│  │
│  │  ├─ removeBid() [ZREM]    └─ getHistory()       └─ bid()     │  │
│  │  └─ getTop() [ZRANGE]                                        │  │
│  │                                                               │  │
│  │  BidCacheService (Ultra-Fast Path)                           │  │
│  │  ├─ placeBidUltraFast()   [Single Lua script]                │  │
│  │  ├─ warmupAuctionCache()                                     │  │
│  │  └─ getAuctionMeta()                                         │  │
│  │                                                               │  │
│  │  EventsGateway (⚡3k rps/CPU)    NotificationsService         │  │
│  │  ├─ handlePlaceBid()      ├─ notifyOutbid()                  │  │
│  │  ├─ handleAuth()          ├─ notifyWin()                     │  │
│  │  ├─ emitNewBid()          └─ notifyBidCarryover()            │  │
│  │  └─ emitRoundComplete()                                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                    │                                │
└────────────────────────────────────┼────────────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐
│       MongoDB       │  │        Redis        │  │    WebSocket    │
│                     │  │                     │  │    Clients      │
│  users              │  │  Distributed Locks  │  │                 │
│  ├─ balance         │  │  (Redlock)          │  │  Countdown sync │
│  └─ frozenBalance   │  │                     │  │  Bid updates    │
│                     │  │  Bid Cooldowns      │  │  Carryover      │
│  auctions           │  │  (per user/auction) │  │  notifications  │
│  ├─ roundsConfig[]  │  │                     │  │                 │
│  └─ rounds[]        │  │  Leaderboards       │  └─────────────────┘
│                     │  │  (ZSET per auction) │
│  bids               │  │                     │
│  ├─ amount          │  │  Timer Leader       │
│  ├─ status          │  │  (election key)     │
│  ├─ carriedOver     │  │                     │
│  └─ originalRound   │  └─────────────────────┘
│                     │
│  transactions       │
│  └─ audit trail     │
└─────────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| **Runtime** | Node.js 22+ | Latest LTS with modern async features |
| **Framework** | NestJS 11 + Fastify | 2-3x throughput vs Express |
| **Language** | TypeScript (strict) | Type safety for financial operations |
| **Database** | MongoDB 8.2+ | Transactions, flexible schemas, replica sets |
| **Cache/Locking** | Redis + Redlock | Distributed locking, ZSET leaderboards, leader election |
| **Real-time** | Socket.IO + Redis adapter | Scalable WebSocket with server-synced timers |
| **Auth** | JWT Bearer tokens | Stateless, distributed-friendly |
| **Telegram** | GrammyJS | Modern Telegram bot framework |
| **Frontend** | React 19 + Vite | Fast development, modern tooling |
| **Validation** | class-validator + Joi | Comprehensive input validation |

## Redis Keys

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| `leaderboard:{auctionId}` | ZSET | O(log N) leaderboard with composite score |
| `timer-service:leader` | STRING | Leader election for timer broadcasts (TTL 5s) |
| `bid:{auctionId}:{odId}` | STRING | Distributed lock for bid operations |
| `cooldown:{auctionId}:{odId}` | STRING | 1-second bid cooldown (TTL 1s) |
| `auction:{auctionId}:balance:{userId}` | HASH | User balance cache (available, frozen) |
| `auction:{auctionId}:meta` | HASH | Auction metadata cache (status, round, timing) |
| `auction:{auctionId}:dirty:users` | SET | Users with modified balances (for sync) |
| `auction:{auctionId}:dirty:bids` | SET | Modified bids (for sync) |

### Leaderboard Score Formula

```
score = amount × 10^13 + (MAX_TIMESTAMP - createdAt)
```

This composite score ensures:
- Higher amounts rank first
- Earlier bids win ties (first-come-first-served)
- Single ZSET operation for both criteria

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── common/          # Guards, errors, types
│   │   ├── config/          # Configuration & env validation
│   │   ├── modules/
│   │   │   ├── auctions/    # Core auction logic + TimerService
│   │   │   ├── auth/        # JWT + Telegram auth
│   │   │   ├── bids/        # Bid queries
│   │   │   ├── events/      # WebSocket gateway (countdown, carryover)
│   │   │   ├── redis/       # Redis client + Redlock + LeaderboardService
│   │   │   ├── notifications/# Telegram notifications (carryover, outbid)
│   │   │   ├── telegram/    # Bot integration
│   │   │   ├── transactions/# Financial audit
│   │   │   └── users/       # User management
│   │   ├── schemas/         # MongoDB schemas
│   │   └── scripts/         # Load testing
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/             # API client
│   │   ├── components/      # UI components
│   │   ├── context/         # Auth & notifications
│   │   ├── hooks/           # useSocket, useCountdown (hybrid sync)
│   │   ├── i18n/            # Translations (en/ru)
│   │   ├── pages/           # Route pages
│   │   └── types/           # TypeScript interfaces
│   └── Dockerfile
├── docs/                    # Documentation (en + ru)
├── docker-compose.yml       # Full stack
└── docker-compose.infra.yml # Infrastructure only
```

## Data Models

### User

```typescript
{
  telegramId: number;       // Telegram user ID
  username?: string;        // @username
  firstName: string;
  lastName?: string;
  balance: number;          // Available funds (min: 0)
  frozenBalance: number;    // Locked in active bids (min: 0)
  version: number;          // Optimistic locking
}
```

### Auction

```typescript
{
  title: string;
  description: string;
  imageUrl: string;
  status: 'pending' | 'active' | 'completed';
  currentRound: number;
  totalItems: number;
  roundsConfig: [{
    round: number;
    winnersCount: number;
    durationMinutes: number;
  }];
  rounds: [{
    round: number;
    startTime: Date;
    endTime: Date;
    status: 'pending' | 'active' | 'completed';
    antiSnipingExtensions: number;
  }];
  antiSnipingEnabled: boolean;
  antiSnipingWindowMinutes: number;
  antiSnipingExtensionMinutes: number;
  maxAntiSnipingExtensions: number;
}
```

### Bid

```typescript
{
  auctionId: ObjectId;
  odId: ObjectId;
  telegramId: number;
  amount: number;
  round: number;
  status: 'active' | 'won' | 'lost' | 'refunded';
  carriedOver: boolean;     // true if bid was carried from previous round
  originalRound: number;    // round where bid was first placed
  createdAt: Date;
  updatedAt: Date;
}
```

### Transaction

```typescript
{
  odId: ObjectId;
  type: 'deposit' | 'withdraw' | 'bid_place' | 'bid_increase' |
        'bid_won' | 'bid_refund';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  frozenBefore: number;
  frozenAfter: number;
  relatedBidId?: ObjectId;
  relatedAuctionId?: ObjectId;
}
```

## Key Services

### LeaderboardService

Redis ZSET-based leaderboard with O(log N) operations:

```typescript
// Add/update bid in leaderboard
await leaderboardService.addBid(auctionId, odId visibleName, amount, createdAt);

// Remove bid (on win)
await leaderboardService.removeBid(auctionId, odId visibleName visibleName);

// Get top N bids
const top = await leaderboardService.getTop(auctionId, limit, offset);

// Fallback to MongoDB if Redis unavailable
```

### TimerService

Server-side countdown broadcasts with Redis leader election:

```typescript
// Only one server instance broadcasts timers (leader)
// Leader election via Redis key with 5s TTL
// Broadcasts every second to all connected clients
// Ensures all clients see synchronized countdown
```

### NotificationsService

Telegram bot notifications:

```typescript
// Notify when outbid
await notificationsService.notifyOutbid(odId auctionTitle, newAmount);

// Notify bid carryover to next round
await notificationsService.notifyBidCarryover(odId auctionTitle, round, amount);

// Notify win
await notificationsService.notifyWin(odId auctionTitle, amount);
```

### EventsGateway (⚡ WebSocket Bidding)

**Maximum throughput path: ~3,000 rps × number of CPUs with p99 < 5ms**

```typescript
// Client-side usage
const socket = io('ws://localhost:4000', { transports: ['websocket'] });

// 1. Authenticate socket with JWT
socket.emit('auth', jwtToken);
socket.on('auth-response', ({ success, userId }) => { /* ... */ });

// 2. Place bids via WebSocket (bypasses HTTP entirely!)
socket.emit('place-bid', { auctionId: '...', amount: 1000 });
socket.on('bid-response', ({ success, amount, previousAmount, error }) => {
  // Instant response with bid confirmation
});

// Server handles:
// - JWT verification via JwtService
// - Direct call to BidCacheService.placeBidUltraFast()
// - Broadcast new-bid event to auction room
// - Async anti-sniping check (non-blocking)
```

### BidCacheService (Ultra-Fast Path)

High-performance Redis-based bidding (~1ms latency, ~3,000 rps × number of CPUs):

```typescript
// Single Lua script does ALL validation + bid placement atomically:
// - Check auction status (ACTIVE, not completed)
// - Verify round timing (not expired)
// - Validate user balance
// - Handle existing bid (return frozen funds)
// - Freeze new bid amount
// - Update ZSET leaderboard
// - Mark as dirty for background sync
// - Return ALL auction meta (eliminates extra Redis call)

const result = await bidCacheService.placeBidUltraFast(
  auctionId,
  userId,
  amount
);
// Returns: { success, amount, previousAmount, isNewBid, needsWarmup,
//            roundEndTime, antiSnipingWindowMs, antiSnipingExtensionMs,
//            maxExtensions, itemsInRound, currentRound }

// Cache warmup on auction start
await bidCacheService.warmupAuctionCache(
  auctionId,
  users,           // All users with balance > 0
  auctionMeta      // Status, timing, anti-sniping config
);

// Background sync every 5 seconds
await cacheSyncService.fullSync(auctionId);
// Writes dirty balances and bids to MongoDB
```

## Design Decisions

### Why Redis ZSET for Leaderboard?

MongoDB `find().sort()` is O(N log N). Redis ZSET provides O(log N) for inserts and O(log N + M) for range queries. With high bid frequency, this significantly reduces latency.

### Why Server-Side Timer Broadcasts?

Client-side timers drift and can be manipulated. Server broadcasts ensure:
- All clients see identical countdown
- Anti-sniping extensions propagate instantly
- No client-side clock skew issues

### Why Redis Leader Election for Timers?

In multi-server deployments, only one server should broadcast timers to avoid duplicate events. Redis key with TTL provides simple leader election.

### Why Bid Carryover Tracking?

When losing bidders are carried to the next round, tracking `carriedOver` and `originalRound` allows:
- User notification about automatic carryover
- Analytics on bid behavior
- Clear audit trail

### Why MongoDB Transactions?

Financial operations require atomicity. If balance deduction succeeds but bid creation fails, the system would lose money.

### Why Fastify over Express?

2-3x better throughput — critical for high-concurrency auction scenarios.

### Why Single Lua Script for Ultra-Fast Bidding?

MongoDB transactions add ~50-100ms latency under concurrent load. A single Lua script in Redis:
- Executes atomically in ~0.02ms
- Eliminates network round-trips (HGETALL + validation + update in one call)
- Does ALL validation + bid placement in one call
- Returns all auction meta (no extra Redis call needed for anti-sniping/notifications)
- Enables ~3,000 rps × number of CPUs vs ~20 bids/sec with MongoDB

### Why Background Sync Instead of Write-Through?

Real-time MongoDB writes would negate speed benefits. A 5-second sync interval:
- Provides excellent durability (max 5s of data loss in catastrophic failure)
- Maintains sub-1ms bid latency
- Uses bulk operations for efficiency

### Why Eager User Warmup?

Lazy cache loading adds 5-10ms latency for the first bidder. Eager warmup on auction start:
- Pre-loads all users with positive balance
- Ensures consistent sub-1ms latency for everyone
- Trade-off: Higher memory usage, but acceptable for active auctions

### Why WebSocket Bidding?

HTTP requests add ~5-10ms overhead for headers, connection handling, and response formatting. WebSocket bidding eliminates this entirely:
- Bid payload goes directly to server over established connection
- Combined with Lua script: **~3,000 rps × number of CPUs** with p99 < 5ms
- No rate limiting overhead (connection is already authenticated)
- Instant bid confirmations via `bid-response` event

### Why Cluster Mode?

Node.js is single-threaded. Cluster mode enables:
- Multiple worker processes utilizing all CPU cores
- Linear scaling: 4 workers ≈ 4x throughput
- Auto-restart of failed workers
- Redis adapter syncs Socket.IO events across workers

```bash
# Auto-detect CPU cores
CLUSTER_WORKERS=auto pnpm start

# Or specify exact worker count
CLUSTER_WORKERS=4 pnpm start

# Workers share same port via cluster module
# Each worker is a full NestJS instance
# Redis adapter ensures WebSocket events reach all clients
```
