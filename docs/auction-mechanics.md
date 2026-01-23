# Auction Mechanics

[← Back to README](../README.md) · [Architecture](./architecture.md) · [API](./api.md) · [Concurrency](./concurrency.md) · [Testing](./testing.md) · [Deployment](./deployment.md)

---

## Multi-Round Elimination System

Unlike simple "highest bid wins" auctions, this system implements a sophisticated multi-round elimination format where items are distributed across multiple rounds.

### Example Configuration

Auction with 10 items distributed as 3+5+2:

| Round | Winners | Items Awarded | Duration |
|-------|---------|---------------|----------|
| 1 | Top 3 bidders | Items #1-3 | 30 min |
| 2 | Top 5 from remaining | Items #4-8 | 20 min |
| 3 | Top 2 from remaining | Items #9-10 | 15 min |

### Auction Lifecycle

```
PENDING ──[start]──► ACTIVE ──[all rounds complete]──► COMPLETED
                        │
                        ├── Round 1: Active
                        │   ├── Winners selected, bids deducted
                        │   └── Losers carried over to Round 2
                        │
                        ├── Round 2: Active
                        │   ├── Winners from remaining bidders
                        │   └── Losers carried over to Round 3
                        │
                        └── Round 3: Active
                            ├── Final winners determined
                            └── Remaining bids refunded
```

### State Transitions

```typescript
// Auction states
type AuctionStatus = 'pending' | 'active' | 'completed';

// Round states
type RoundStatus = 'pending' | 'active' | 'completed';

// Bid states
type BidStatus = 'active' | 'won' | 'lost' | 'refunded';
```

## Bidding Model

### One Bid Per User

Each user has exactly one bid per auction:
- First bid creates a new bid record
- Subsequent bids increase the existing amount
- Bids cannot be decreased or withdrawn

```typescript
// First bid: Create
POST /api/auctions/123/bid { amount: 100 }
// Result: Bid created with amount=100

// Second bid: Increase
POST /api/auctions/123/bid { amount: 150 }
// Result: Existing bid updated to amount=150
// Note: Additional 50 frozen from balance
```

### Unique Amounts

Bid amounts must be unique within an auction:
- Prevents ambiguous rankings
- Ensures deterministic leaderboards
- If amount taken, API returns 409 Conflict

### Tie-Breaking

When amounts are somehow equal (shouldn't happen due to uniqueness):
- Earlier timestamp wins
- Composite score in Redis ZSET handles this automatically

## Bid Carryover

When a round completes, losing bidders are automatically carried over to the next round.

### How It Works

```
Round 1 ends with 10 bidders, 3 winners:
├── Top 3 → status: 'won', removed from leaderboard
└── Bottom 7 → status: 'lost', new bid created for Round 2
    └── New bid marked: carriedOver=true, originalRound=1
```

### Carryover Fields

```typescript
{
  carriedOver: boolean;   // true if auto-carried from previous round
  originalRound: number;  // round where user first placed bid
}
```

### Notifications

Users receive Telegram notification when their bid is carried over:

```
🔄 Your bid has been carried over!

Auction: "Rare NFT Collection"
Your bid of 500 TON was not in the top 3 for Round 1.
Your bid has been automatically carried over to Round 2.

Good luck!
```

### WebSocket Event

Frontend receives `bid-carryover` event:

```typescript
{
  auctionId: string;
  odId: string visibleName
  odName: string;
  amount: number;
  fromRound: number;
  toRound: number;
}
```

## Anti-Sniping Protection

Prevents last-second bid manipulation by extending rounds when bids arrive near the end.

### Configuration

```typescript
{
  antiSnipingEnabled: true,
  antiSnipingWindowMinutes: 5,      // Watch last 5 minutes
  antiSnipingExtensionMinutes: 5,   // Extend by 5 minutes
  maxAntiSnipingExtensions: 6       // Up to 6 extensions (30 min max)
}
```

### Timeline Example

```
Original Round End: 10:00:00
Anti-sniping Window: 5 minutes (starts 09:55:00)

Timeline:
  09:54:59 - Bid placed → No extension (outside window)
  09:55:01 - Bid placed → Round extended to 10:05:00 (extension #1)
  10:04:30 - Bid placed → Round extended to 10:10:00 (extension #2)
  ... continues until max extensions reached or no bids in window
```

### WebSocket Notification

```typescript
socket.emit('anti-sniping', {
  auctionId: '123',
  round: 1,
  newEndTime: '2024-01-15T10:05:00Z',
  extensionNumber: 1,
  maxExtensions: 6
});
```

## Server-Side Countdown

Server broadcasts countdown every second to ensure all clients are synchronized.

### Why Server-Side?

- Client clocks can drift
- Anti-sniping extensions need instant propagation
- Prevents manipulation of local timers

### Hybrid Client Implementation

```typescript
// Frontend useCountdown hook
// 1. Receives server countdown every second
// 2. Interpolates between server updates for smooth display
// 3. Shows sync indicator when server time differs
```

### WebSocket Event

```typescript
socket.emit('countdown', {
  auctionId: string;
  round: number;
  remainingSeconds: number;
  endTime: string;
});
```

## Financial Model

### Balance Types

```typescript
User {
  balance: number;        // Available for bidding
  frozenBalance: number;  // Locked in active bids
}
```

**Invariant**: User's total value never changes unexpectedly
```
totalValue = balance + frozenBalance + spentOnWinningBids
```

### Bid Lifecycle Flows

#### Place New Bid

```
Before: balance=1000, frozen=0
Action: Bid 300

balance  -= 300  →  700
frozen   += 300  →  300

After: balance=700, frozen=300
```

#### Increase Existing Bid

```
Before: balance=700, frozen=300 (existing bid=300)
Action: Increase to 500 (delta=200)

balance  -= 200  →  500
frozen   += 200  →  500

After: balance=500, frozen=500
```

#### Win Auction

```
Before: balance=500, frozen=500 (bid=500)
Action: Bid wins

frozen   -= 500  →  0
(money is spent, user owns item)

After: balance=500, frozen=0
```

#### Lose/Refund (Final Round)

```
Before: balance=500, frozen=500 (bid=500)
Action: Bid loses in final round, refund issued

frozen   -= 500  →  0
balance  += 500  →  1000

After: balance=1000, frozen=0
```

#### Carryover (Non-Final Round)

```
Before: balance=500, frozen=500 (bid=500)
Action: Bid loses in Round 1, carried to Round 2

frozen stays at 500 (still locked)
New bid created for Round 2 with carriedOver=true

After: balance=500, frozen=500 (bid active in Round 2)
```

## Leaderboard

Real-time ranking powered by Redis ZSET with O(log N) operations.

### Data Flow

```
1. User places bid
2. ZADD to Redis leaderboard (O(log N))
3. WebSocket broadcasts new-bid event
4. Frontend updates leaderboard display
5. On round complete, winners removed via ZREM
```

### API Response

```typescript
GET /api/auctions/:id/leaderboard

{
  leaderboard: [
    { rank: 1, odId: 'abc', odName: 'Alice', amount: 500, isWinning: true },
    { rank: 2, odId: 'def', odName: 'Bob', amount: 450, isWinning: true },
    { rank: 3, odId: 'ghi', odName: 'Charlie', amount: 400, isWinning: true },
    { rank: 4, odId: 'jkl', odName: 'Dave', amount: 350, isWinning: false },
  ],
  currentRound: 1,
  winnersThisRound: 3,
  totalBids: 15
}
```

### Fallback

If Redis is unavailable, system falls back to MongoDB query with proper indexing.

## Round Completion Process

Executed by cron job every 5 seconds:

```typescript
async completeRound(auction, roundNumber) {
  // 1. Get all active bids from Redis leaderboard (or MongoDB fallback)
  const bids = await leaderboardService.getAll(auctionId);

  // 2. Determine winners (top N by roundConfig)
  const winnersCount = auction.roundsConfig[roundNumber - 1].winnersCount;
  const winners = bids.slice(0, winnersCount);
  const losers = bids.slice(winnersCount);

  // 3. Process winners
  for (const bid of winners) {
    bid.status = 'won';
    await leaderboardService.removeBid(auctionId, odId visibleName visibleName);
    await User.updateOne({ _id: odId }, { $inc: { frozenBalance: -bid.amount } });
    await notificationsService.notifyWin(odId ...);
  }

  // 4. Handle losers
  if (isLastRound) {
    // Refund all losers
    for (const bid of losers) {
      bid.status = 'refunded';
      await User.updateOne(
        { _id: odId },
        { $inc: { frozenBalance: -bid.amount, balance: bid.amount } }
      );
    }
  } else {
    // Carry over to next round
    for (const bid of losers) {
      bid.status = 'lost';
      await Bid.create({
        ...bid,
        round: roundNumber + 1,
        status: 'active',
        carriedOver: true,
        originalRound: bid.originalRound || roundNumber
      });
      await notificationsService.notifyBidCarryover(odId ...);
      eventsGateway.emitBidCarryover(...);
    }
  }

  // 5. Start next round or complete auction
  if (isLastRound) {
    auction.status = 'completed';
    timerService.stop(auctionId);
  } else {
    auction.currentRound++;
    timerService.restart(auctionId, newEndTime);
  }
}
```
