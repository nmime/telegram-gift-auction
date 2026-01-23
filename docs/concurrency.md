# Concurrency & Safety

[← Back to README](../README.md) · [Architecture](./architecture.md) · [API](./api.md) · [Testing](./testing.md) · [Deployment](./deployment.md)

---

## The Problem

Auction systems face extreme concurrency challenges:
- Multiple users bidding simultaneously
- Same user sending rapid-fire requests
- Network retries causing duplicate submissions
- Race conditions during round transitions
- Balance manipulation attempts
- Multiple server instances broadcasting timers

A naive implementation would quickly result in:
- Double-spending (bid with same money twice)
- Negative balances
- Duplicate bids
- Lost transactions
- Corrupted auction state
- Duplicate timer broadcasts

## 5-Layer Protection Model

We implement defense in depth with 5 independent protection layers:

```
┌─────────────────────────────────────────────────────────┐
│                    HTTP Request                          │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Distributed Lock (Redlock)                     │
│  ─────────────────────────────────────────────────────  │
│  • Acquire lock for user+auction combination             │
│  • Fail-fast mode (no waiting)                          │
│  • 10-second TTL (auto-release on crash)                │
│  • Prevents concurrent requests from same user           │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Redis Cooldown                                 │
│  ─────────────────────────────────────────────────────  │
│  • 1-second cooldown between bids per user per auction  │
│  • Prevents spam and accidental double-clicks           │
│  • Lightweight check before expensive operations        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3: MongoDB Transaction                            │
│  ─────────────────────────────────────────────────────  │
│  • Snapshot isolation level                             │
│  • Majority write concern                               │
│  • Automatic retry on transient errors                  │
│  • All-or-nothing semantics for financial operations    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 4: Optimistic Locking                             │
│  ─────────────────────────────────────────────────────  │
│  • Version field on user documents                      │
│  • Check version matches expected value before update   │
│  • Detects concurrent modifications                     │
│  • Fails if another request modified data first         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 5: Unique Indexes                                 │
│  ─────────────────────────────────────────────────────  │
│  • Unique index: (auctionId, odId, status='active')   │
│  • Unique index: (auctionId, amount)                    │
│  • Database-level enforcement                           │
│  • Last line of defense against duplicates              │
└─────────────────────────────────────────────────────────┘
```

## Redis Leader Election for Timers

In multi-server deployments, only one server should broadcast countdown timers to avoid duplicate events.

### Implementation

```typescript
// TimerService uses Redis key with TTL for leader election
const LEADER_KEY = 'timer-service:leader';
const LEADER_TTL = 5; // seconds

async tryBecomeLeader(): Promise<boolean> {
  // SET NX with TTL - only succeeds if key doesn't exist
  const result = await redis.set(LEADER_KEY, this.serverId, 'NX', 'EX', LEADER_TTL);
  return result === 'OK';
}

async refreshLeadership(): Promise<boolean> {
  // Only refresh if we're the current leader
  const currentLeader = await redis.get(LEADER_KEY);
  if (currentLeader === this.serverId) {
    await redis.expire(LEADER_KEY, LEADER_TTL);
    return true;
  }
  return false;
}
```

### Leader Responsibilities

- Broadcast `countdown` events every second
- Handle anti-sniping extension propagation
- Coordinate round transitions

### Failover

If leader crashes, key expires after 5 seconds, and another server becomes leader automatically.

## High-Performance Bid Path (Redis Lua Script)

The `/bid` endpoint uses a high-performance Redis Lua script for maximum throughput:

```
┌─────────────────────────────────────────────────────────┐
│                    HTTP Request                          │
│                  POST /auctions/:id/bid                  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Single Lua Script (Atomic, ~0.02ms)                    │
│  ─────────────────────────────────────────────────────  │
│  1. Check auction status from cached meta               │
│  2. Verify round timing (not expired)                   │
│  3. Validate user balance from Redis hash               │
│  4. Handle existing bid (return frozen funds)           │
│  5. Freeze new bid amount                               │
│  6. Update ZSET leaderboard with encoded score          │
│  7. Mark balance and bid as dirty for sync              │
│  8. Return success with amounts                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Async Operations (Non-blocking)                        │
│  ─────────────────────────────────────────────────────  │
│  • WebSocket new-bid event                              │
│  • Anti-sniping check (extend round if needed)          │
│  • Outbid notifications                                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Background Sync (Every 5 seconds)                      │
│  ─────────────────────────────────────────────────────  │
│  • Write dirty balances to MongoDB                      │
│  • Write dirty bids to MongoDB                          │
│  • Clear dirty flags                                    │
└─────────────────────────────────────────────────────────┘
```

### Performance

| Metric | Value |
|--------|-------|
| Latency | 1.4ms mean, 4ms p99 |
| Peak Throughput | 3,362 req/s (single-core), 13,812 req/s (12-core) |
| Consistency | Eventual (5s sync to MongoDB) |
| Protection | Atomic Lua + Dirty Tracking |

---

## Bid Flow Details

```typescript
POST /api/auctions/:id/bid { amount: 1000 }

// Layer 1: Distributed Lock
const lockKey = `bid:${auctionId}:${odId}`;
const lock = await redlock.acquire([lockKey], 10000, {
  retryCount: 0  // fail-fast, don't wait
});

try {
  // Layer 2: Redis Cooldown
  const cooldownKey = `cooldown:${auctionId}:${odId}`;
  const hasCooldown = await redis.get(cooldownKey);
  if (hasCooldown) {
    throw new TooManyRequestsException('Please wait before bidding again');
  }

  // Layer 3: MongoDB Transaction
  const session = await mongoose.startSession();
  session.startTransaction({
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' }
  });

  try {
    // Layer 4: Optimistic Locking
    const user = await User.findById(odId).session(session);
    const expectedVersion = user.version;

    // Perform bid logic...
    const updateResult = await User.updateOne(
      { _id: odId, version: expectedVersion },
      { $inc: { balance: -amount, frozenBalance: amount, version: 1 } }
    ).session(session);

    if (updateResult.modifiedCount === 0) {
      throw new ConflictException('Concurrent modification detected');
    }

    // Layer 5: Unique Index (enforced by MongoDB)
    await Bid.create([{ auctionId, odId, amount, status: 'active' }], { session });

    await session.commitTransaction();

    // Update Redis leaderboard
    await leaderboardService.addBid(auctionId, odId visibleName, amount, createdAt);

    // Set cooldown after success
    await redis.setex(cooldownKey, 1, '1');

  } catch (error) {
    await session.abortTransaction();
    throw error;
  }
} finally {
  await lock.release();
}
```

## Edge Cases Handled

| Edge Case | Protection Layer | Behavior |
|-----------|------------------|----------|
| 10 concurrent bids from same user | Redlock | Only 1 proceeds, 9 fail fast |
| Rapid-fire clicking | Redis cooldown | Rejected with 429 status |
| Server crash mid-transaction | MongoDB transaction | Automatic rollback |
| Two users bid same amount | Unique index | Second bid rejected |
| Balance race condition | Optimistic locking | Retry or fail |
| Stale read during round transition | Snapshot isolation | Consistent view |
| Multiple servers broadcasting timers | Leader election | Only leader broadcasts |
| Leader server crashes | TTL expiration | New leader elected in 5s |

## Balance Protection

User balance operations use atomic MongoDB operators with guards:

```typescript
// Deduct balance (only if sufficient funds)
await User.updateOne(
  {
    _id: odId,
    balance: { $gte: amount }  // Guard: must have funds
  },
  {
    $inc: {
      balance: -amount,
      frozenBalance: amount
    }
  }
);

// Schema-level protection
const userSchema = new Schema({
  balance: { type: Number, min: 0 },       // Cannot go negative
  frozenBalance: { type: Number, min: 0 }  // Cannot go negative
});
```

## Leaderboard Consistency

Redis ZSET operations are atomic, but we need consistency with MongoDB:

```typescript
// On successful bid (within transaction)
1. MongoDB: Create/update bid document
2. Redis: ZADD to leaderboard

// On round complete
1. MongoDB: Update bid status to 'won'
2. Redis: ZREM from leaderboard

// Fallback
If Redis fails, getLeaderboard() falls back to MongoDB query
```

## Financial Integrity Verification

The system includes a verification endpoint that checks:

```typescript
// Invariant that must always hold:
totalDeposits - totalWithdrawals =
  sum(user.balance) + sum(user.frozenBalance) + totalSpentOnWins

// Verification runs on demand via API
GET /api/transactions/verify-integrity
// Returns: { valid: true, difference: 0 }
```

## Distributed Scaling

For multi-server deployments:

1. **Redlock** uses Redis for distributed locks
2. **Leader Election** ensures single timer broadcaster
3. **Socket.IO Redis adapter** broadcasts events across servers
4. **ZSET Leaderboard** shared across all instances
5. **MongoDB replica set** ensures data consistency
6. **Stateless JWT auth** allows request routing to any server

```yaml
# docker-compose.yml for scaling
services:
  backend:
    deploy:
      replicas: 3
    depends_on:
      - redis
      - mongodb
```

All instances share:
- Redis leaderboards (ZSET)
- Redis locks and cooldowns
- Redis leader election key
- MongoDB data
- WebSocket events (via Redis adapter)
