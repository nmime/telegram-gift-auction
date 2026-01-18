# API Reference

Base URL: `/api`

All protected endpoints require `Authorization: Bearer <token>` header.

Interactive documentation available at `/api/docs` (Swagger UI).

## Authentication

### POST /auth/telegram/webapp

Authenticate via Telegram Mini App initData.

**Request:**
```json
{
  "initData": "query_id=AAHdF6IQ..."
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "telegramId": 123456789,
    "username": "john_doe",
    "firstName": "John",
    "balance": 1000,
    "frozenBalance": 0
  }
}
```

### POST /auth/telegram/widget

Authenticate via Telegram Login Widget.

**Request:**
```json
{
  "id": 123456789,
  "first_name": "John",
  "username": "john_doe",
  "auth_date": 1234567890,
  "hash": "abc123..."
}
```

### GET /auth/me

Get current authenticated user.

### POST /auth/refresh

Refresh JWT token.

---

## Auctions

### GET /auctions

List all auctions with pagination and filtering.

**Query Parameters:**
- `status` - Filter: `pending`, `active`, `completed`
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

### GET /auctions/:id

Get auction details including user's current bid.

**Response:**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "title": "Rare NFT Collection",
  "status": "active",
  "currentRound": 1,
  "rounds": [
    {
      "round": 1,
      "startTime": "2024-01-15T10:00:00Z",
      "endTime": "2024-01-15T10:30:00Z",
      "status": "active",
      "antiSnipingExtensions": 0
    }
  ],
  "totalBids": 25,
  "userBid": {
    "amount": 500,
    "rank": 3,
    "carriedOver": false,
    "originalRound": 1
  }
}
```

### POST /auctions/:id/bid

Place or increase a bid.

**Request:**
```json
{
  "amount": 500
}
```

**Response:**
```json
{
  "bid": {
    "id": "507f1f77bcf86cd799439012",
    "amount": 500,
    "round": 1,
    "status": "active",
    "rank": 3,
    "carriedOver": false,
    "originalRound": 1
  },
  "balanceAfter": 500,
  "frozenBalanceAfter": 500
}
```

**Error Responses:**
- `400` - Invalid amount
- `402` - Insufficient balance
- `409` - Amount already taken
- `429` - Cooldown active

### GET /auctions/:id/leaderboard

Get current auction rankings (Redis ZSET-powered).

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50)

**Response:**
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "odId": "abc123",
      "odName": "Alice",
      "amount": 500,
      "isWinning": true,
      "isCurrentUser": false
    }
  ],
  "currentRound": 1,
  "winnersThisRound": 3,
  "totalBids": 25
}
```

### GET /auctions/:id/past-winners

Get winners from completed rounds.

### GET /auctions/:id/min-winning-bid

Get minimum bid needed to be in winning position.

---

## Users

### GET /users/balance

```json
{
  "balance": 1000,
  "frozenBalance": 500,
  "totalBalance": 1500
}
```

### POST /users/deposit

Add funds to balance.

### POST /users/withdraw

Withdraw available funds.

---

## Transactions

### GET /transactions

Get transaction history with pagination.

### GET /transactions/verify-integrity

Verify system financial integrity.

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

---

## WebSocket Events

Connect to WebSocket at the base URL (same as API).

### Client → Server

**join-auction**
```typescript
socket.emit('join-auction', { auctionId: '123' });
```

**leave-auction**
```typescript
socket.emit('leave-auction', { auctionId: '123' });
```

### Server → Client

**countdown** (every second from server)
```typescript
{
  auctionId: string;
  round: number;
  remainingSeconds: number;
  endTime: string;          // ISO timestamp
}
```

**new-bid**
```typescript
{
  auctionId: string;
  odId: string;
  odName: string;
  amount: number;
  rank: number;
  timestamp: string;
}
```

**bid-carryover**
```typescript
{
  auctionId: string;
  odId: string;
  odName: string;
  amount: number;
  fromRound: number;
  toRound: number;
}
```

**anti-sniping**
```typescript
{
  auctionId: string;
  round: number;
  newEndTime: string;
  extensionNumber: number;
  maxExtensions: number;
}
```

**round-complete**
```typescript
{
  auctionId: string;
  round: number;
  winners: Array<{
    odId: string;
    odName: string;
    amount: number;
  }>;
  nextRound?: number;
  nextRoundEndTime?: string;
}
```

**round-start**
```typescript
{
  auctionId: string;
  round: number;
  endTime: string;
  winnersCount: number;
}
```

**auction-complete**
```typescript
{
  auctionId: string;
  totalRounds: number;
  message: string;
}
```

---

## Rate Limiting

Three-tier rate limiting:

| Tier | Limit | Window |
|------|-------|--------|
| Short | 20 requests | 1 second |
| Medium | 100 requests | 10 seconds |
| Long | 300 requests | 1 minute |

Headers included in responses:
```
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 19
X-RateLimit-Reset: 1705315200
```

Localhost bypasses rate limiting for development.

---

## Error Responses

Format:
```json
{
  "statusCode": 400,
  "message": "Bid amount must be greater than current bid",
  "error": "Bad Request"
}
```

Status codes:
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `402` - Payment Required (insufficient balance)
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict (duplicate bid amount)
- `429` - Too Many Requests (rate limited or cooldown)
