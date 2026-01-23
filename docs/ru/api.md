# Справочник API

[← К README](../../README.ru.md) · [Архитектура](./architecture.md) · [Конкурентность](./concurrency.md) · [Тестирование](./testing.md) · [Деплой](./deployment.md)

---

Базовый URL: `/api`

Все защищённые эндпоинты требуют заголовок `Authorization: Bearer <token>`.

Интерактивная документация доступна по адресу `/api/docs` (Swagger UI).

## Аутентификация

### POST /auth/telegram/webapp

Аутентификация через Telegram Mini App initData.

**Запрос:**
```json
{
  "initData": "query_id=AAHdF6IQ..."
}
```

**Ответ:**
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

Аутентификация через Telegram Login Widget.

**Запрос:**
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

Получить текущего аутентифицированного пользователя.

### POST /auth/refresh

Обновить JWT токен.

---

## Аукционы

### GET /auctions

Список аукционов с пагинацией и фильтрацией.

**Query параметры:**
- `status` - Фильтр: `pending`, `active`, `completed`
- `page` - Номер страницы (по умолчанию: 1)
- `limit` - Элементов на странице (по умолчанию: 20)

### GET /auctions/:id

Получить детали аукциона включая текущую ставку пользователя.

**Ответ:**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "title": "Редкая NFT коллекция",
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

Сделать или увеличить ставку. Использует высокопроизводительный Redis путь (~1.4мс латентность).

**Запрос:**
```json
{
  "amount": 500
}
```

**Ответ:**
```json
{
  "success": true,
  "amount": 500,
  "previousAmount": 100,
  "rank": 3,
  "isNewBid": false
}
```

**Ответ с ошибкой:**
```json
{
  "success": false,
  "error": "INSUFFICIENT_BALANCE"
}
```

**Ошибки:**
- `400` - Некорректная сумма
- `402` - Недостаточно средств
- `409` - Сумма уже занята
- `429` - Активен кулдаун

### GET /auctions/:id/leaderboard

Получить текущий рейтинг (на Redis ZSET).

**Query параметры:**
- `page` - Номер страницы (по умолчанию: 1)
- `limit` - Элементов на странице (по умолчанию: 50)

**Ответ:**
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "odId": "abc123",
      "odName": "Алиса",
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

Получить победителей завершённых раундов.

### GET /auctions/:id/min-winning-bid

Получить минимальную ставку для победной позиции.

---

## Пользователи

### GET /users/balance

```json
{
  "balance": 1000,
  "frozenBalance": 500,
  "totalBalance": 1500
}
```

### POST /users/deposit

Пополнить баланс.

### POST /users/withdraw

Вывести доступные средства.

---

## Транзакции

### GET /transactions

Получить историю транзакций с пагинацией.

### GET /transactions/verify-integrity

Проверить финансовую целостность системы.

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

## WebSocket события

Подключение к WebSocket по базовому URL (тот же, что и API).

### Клиент → Сервер

**join-auction**
```typescript
socket.emit('join-auction', { auctionId: '123' });
```

**leave-auction**
```typescript
socket.emit('leave-auction', { auctionId: '123' });
```

### Сервер → Клиент

**countdown** (каждую секунду от сервера)
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

Трёхуровневое ограничение частоты:

| Уровень | Лимит | Окно |
|---------|-------|------|
| Short | 20 запросов | 1 секунда |
| Medium | 100 запросов | 10 секунд |
| Long | 300 запросов | 1 минута |

Заголовки включены в ответы:
```
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 19
X-RateLimit-Reset: 1705315200
```

Localhost обходит rate limiting для разработки.

---

## Ответы с ошибками

Формат:
```json
{
  "statusCode": 400,
  "message": "Сумма ставки должна быть больше текущей",
  "error": "Bad Request"
}
```

Коды статусов:
- `400` - Bad Request (ошибка валидации)
- `401` - Unauthorized
- `402` - Payment Required (недостаточно средств)
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict (сумма ставки занята)
- `429` - Too Many Requests (rate limit или кулдаун)
