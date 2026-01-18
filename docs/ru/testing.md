# Тестирование

## Набор нагрузочных тестов

Система включает комплексный набор нагрузочных тестов, проверяющих поведение под стрессовыми условиями.

### Запуск нагрузочных тестов

```bash
cd backend
npx ts-node test/load-test.ts
```

### Тестовые сценарии

Набор включает 11 тестовых сценариев:

#### 1. Concurrent Bid Storm (Шторм параллельных ставок)
- **Что**: 100 разных пользователей делают ставки одновременно
- **Проверяет**: Система выдерживает параллельную нагрузку без повреждения данных
- **Ожидается**: Все 100 ставок успешны с уникальными суммами

#### 2. Rapid Sequential Bids (Быстрые последовательные ставки)
- **Что**: Один пользователь делает 20 ставок в быстрой последовательности
- **Проверяет**: Логика увеличения ставок и обработка кулдауна
- **Ожидается**: Ставки обработаны корректно с учётом кулдауна

#### 3. Tie-Breaking (Same Amount) (Одинаковые суммы)
- **Что**: 10 пользователей пытаются поставить одинаковую сумму одновременно
- **Проверяет**: Уникальный индекс и first-write-wins
- **Ожидается**: Ровно 1 ставка успешна, 9 отклонены с 409 Conflict

#### 4. High-Frequency Stress (Высокочастотный стресс)
- **Что**: Продолжительные высокочастотные ставки
- **Проверяет**: Стабильность системы под непрерывной нагрузкой
- **Ожидается**: >200 ставок обработано на >25 req/s

#### 5. Massive Concurrent Stress (Массивный параллельный стресс)
- **Что**: 300 параллельных запросов
- **Проверяет**: Поведение системы при экстремальной конкурентности
- **Ожидается**: >200 успешных ставок (некоторые отклонены из-за контенции)

**Понимание результатов** (`226/300 @ 17.2 req/s`):
- **226 успешных**: Эти ставки обработаны и сохранены корректно
- **74 отклонено**: Отклонены намеренными защитами (не ошибки)
- **17.2 req/s**: Пропускная способность под экстремальной нагрузкой

**Почему не 300/300?** Система намеренно отклоняет некоторые запросы для сохранения целостности данных:
- **Распределённая блокировка (Redlock)**: Предотвращает race conditions, отклоняя параллельные запросы одного пользователя
- **Отклонение дублирующих сумм**: Только одна ставка на сумму разрешена
- **Rate limiting**: Защита от спама/DoS атак

**Что указывает на проблемы:**

| Результат | Значение |
|-----------|----------|
| `300/300` с дубликатами в БД | Повреждение данных - КРИТИЧЕСКИЙ БАГ |
| Падение сервера или таймаут | Система не справляется - нужна оптимизация |
| `0/300` | Система полностью перегружена - нужно масштабирование |
| `<100/300` с ошибками | Защита слишком агрессивная или баги |

**Что указывает на здоровую систему:**

| Результат | Значение |
|-----------|----------|
| `>200/300` | Хорошая пропускная способность под стрессом |
| `>15 req/s` | Приемлемая скорость обработки |
| Нет дублей ставок | Целостность данных сохранена |
| Нет падений | Система стабильна под нагрузкой |

#### 6. Insufficient Funds Rejection (Отклонение при недостатке средств)
- **Что**: Пользователи пытаются поставить больше своего баланса
- **Проверяет**: Проверка баланса и отклонение
- **Ожидается**: Все ставки отклонены с 402 Payment Required

#### 7. Invalid Bid Rejection (Отклонение невалидных ставок)
- **Что**: Различные невалидные попытки (отрицательные, нулевые, ниже минимума)
- **Проверяет**: Валидация входных данных
- **Ожидается**: Все отклонены с 400 Bad Request

#### 8. Auth Validation (Валидация авторизации)
- **Что**: Запросы с невалидной/отсутствующей авторизацией
- **Проверяет**: Middleware авторизации
- **Ожидается**: Ответы 401 Unauthorized

#### 9. Same-User Race Condition (Race condition одного пользователя)
- **Что**: Один пользователь отправляет 10 параллельных запросов ставок
- **Проверяет**: Redlock предотвращает параллельную обработку
- **Ожидается**: Максимум 1 успешна (благодаря распределённой блокировке)

#### 10. Bid Ordering Verification (Проверка порядка ставок)
- **Что**: Проверка сортировки таблицы лидеров после множества ставок
- **Проверяет**: Корректная сортировка по сумме и времени
- **Ожидается**: Таблица лидеров соответствует ожидаемому порядку

#### 11. Financial Integrity (Финансовая целостность)
- **Что**: Проверка отсутствия создания или потери денег
- **Проверяет**: Бухгалтерские инварианты
- **Ожидается**: Депозиты - выводы = балансы + заморозка + потрачено

### Пример вывода

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

## Юнит-тесты

### Backend

```bash
cd backend

# Запустить все тесты
npm test

# Запустить с покрытием
npm run test:cov

# Запустить конкретный файл
npm test -- auctions.service.spec.ts

# Режим watch
npm run test:watch
```

### Frontend

```bash
cd frontend

# Запустить все тесты
npm test

# Запустить с покрытием
npm run test:coverage
```

---

## E2E-тесты

Система включает комплексные E2E-тесты, покрывающие всю критическую функциональность.

### Запуск E2E-тестов

```bash
cd backend

# Запустить все E2E-тесты
for test in test/*.e2e.ts; do npx ts-node "$test"; done

# Запустить конкретный набор тестов
npx ts-node test/concurrency.e2e.ts
npx ts-node test/financial-integrity.e2e.ts
npx ts-node test/websocket-events.e2e.ts
```

### Наборы тестов

#### 1. Тесты параллельности (`concurrency.e2e.ts`)

| Тест | Описание |
|------|----------|
| Concurrent Bids Different Users | 10 пользователей ставят одновременно с разными суммами |
| Duplicate Bid Amount Rejection | Второй пользователь отклонён при ставке такой же суммы |
| Rapid Bid Increases | Один пользователь увеличивает ставку 10 раз быстро |
| Concurrent Same-Amount Race | 5 пользователей ставят одну сумму - ровно 1 выигрывает |
| Bidding on Inactive Auction | Ставки отклонены на неактивном аукционе |
| Leaderboard Consistency | Проверка порядка при 20 параллельных ставках |

#### 2. Тесты финансовой целостности (`financial-integrity.e2e.ts`)

| Тест | Описание |
|------|----------|
| Balance Freezing | Ставка 300 замораживает 300, доступный баланс уменьшается |
| Incremental Freeze | Увеличение ставки замораживает только разницу |
| Outbid Refund | Проверка сохранения сумм при перебитии |
| Insufficient Funds Rejection | Нельзя ставить больше доступного баланса |
| Multi-User Financial Integrity | Сумма денег в системе = сумме депозитов |
| Bid Amount Validation | Отклонение ставок ниже минимума и с недостаточным шагом |

#### 3. Тесты WebSocket событий (`websocket-events.e2e.ts`)

| Тест | Описание |
|------|----------|
| New Bid Event | Клиенты получают `new-bid` при размещении ставки |
| Auction Update Event | Клиенты получают `auction-update` при смене состояния |
| Room Isolation | Клиенты получают события только от своего аукциона |
| Multiple Connections Same User | Все соединения пользователя получают события |
| Leave Auction Room | Нет событий после выхода из комнаты |

#### 4. Тесты серверного таймера (`server-timer.e2e.ts`)

| Тест | Описание |
|------|----------|
| Countdown Broadcast | Сервер рассылает обратный отсчёт каждую секунду |
| Anti-Sniping Extension | Таймер продлевается при поздних ставках |
| Multiple Clients Sync | Все клиенты получают синхронизированный отсчёт |

#### 5. Тесты Redis-лидерборда (`redis-leaderboard.e2e.ts`)

| Тест | Описание |
|------|----------|
| Leaderboard Ordering | Ставки отсортированы по сумме по убыванию |
| Leaderboard Pagination | Offset/limit работают корректно |
| Bid Update | Обновление ставки обновляет лидерборд (без дублей) |
| Tie Breaking | Более ранняя ставка выигрывает при одинаковой сумме |

#### 6. Тесты переноса ставок (`bid-carryover.e2e.ts`)

| Тест | Описание |
|------|----------|
| Multi-Round Auction Setup | 3-раундовый аукцион создаётся корректно |
| Bids in Multi-Round | Топ-N ставок помечены как выигрышные |
| Min Winning Bid Calculation | Возвращает правильную сумму для входа в выигрышные |
| Carryover Schema | Схема ставки поддерживает поля переноса |

#### 7. Тесты потока аукциона (`auction-flow.e2e.ts`)

| Тест | Описание |
|------|----------|
| Full Auction Flow | Цикл: Создание → Старт → Ставка → Лидерборд |

### Тестовые утилиты

Все тесты используют общие хелперы из `test/utils/test-helpers.ts`:

```typescript
// Ожидание на основе событий (без произвольных sleep)
await waitFor(() => bids.length === 5, { timeout: 5000 });

// Ожидание WebSocket событий
const events = await collectEvents(socket, 'new-bid', 3);

// Минимальная задержка для очистки Redlock
await waitForLockRelease(); // 100ms

// Подключение и вход в комнату аукциона
const socket = await connectAndJoin(WS_URL, token, auctionId);
```

### Пример вывода

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

## Цели покрытия тестами

| Область | Цель |
|---------|------|
| Сервисный слой | >80% |
| Контроллеры | >70% |
| Guards/Middleware | >90% |
| Критические пути (ставки) | >95% |

---

## Ручное тестирование

### Тестирование потока ставок

1. Создать тестового пользователя с балансом:
```bash
curl -X POST http://localhost:4000/api/users/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
```

2. Сделать ставку:
```bash
curl -X POST http://localhost:4000/api/auctions/$AUCTION_ID/bid \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'
```

3. Проверить таблицу лидеров:
```bash
curl http://localhost:4000/api/auctions/$AUCTION_ID/leaderboard \
  -H "Authorization: Bearer $TOKEN"
```

### Тестирование WebSocket

```javascript
// Консоль браузера или Node.js
const io = require('socket.io-client');

const socket = io('http://localhost:4000', {
  auth: { token: 'your-jwt-token' }
});

socket.on('connect', () => {
  console.log('Подключено');
  socket.emit('join-auction', { auctionId: '...' });
});

socket.on('new-bid', (data) => {
  console.log('Новая ставка:', data);
});

socket.on('anti-sniping', (data) => {
  console.log('Раунд продлён:', data);
});
```

### Тестирование анти-снайпинга

1. Создать аукцион с коротким раундом (5 минут)
2. Дождаться окна анти-снайпинга (последние 5 минут)
3. Сделать ставку
4. Проверить, что время конца раунда продлено
5. Проверить получение WebSocket события `anti-sniping`

### Тестирование параллельных ставок

```bash
# Используя GNU parallel
seq 1 100 | parallel -j100 'curl -s -X POST \
  http://localhost:4000/api/auctions/$AUCTION_ID/bid \
  -H "Authorization: Bearer $TOKEN_{}" \
  -H "Content-Type: application/json" \
  -d "{\"amount\": {}00}"'
```

---

## Проверка финансовой целостности

Запустить проверку целостности, чтобы убедиться в отсутствии утечки денег:

```bash
curl http://localhost:4000/api/transactions/verify-integrity \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Ожидаемый ответ:
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

Если `difference` не равен 0, исследуйте:
1. Проверьте логи транзакций
2. Убедитесь, что все переходы состояний ставок записаны
3. Поищите прерванные транзакции в oplog MongoDB

---

## Интеграция CI/CD

### Пример GitHub Actions

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mongodb:
        image: mongo:8.2
        ports:
          - 27017:27017
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm ci

      - name: Initialize MongoDB replica set
        run: |
          docker exec ${{ job.services.mongodb.id }} \
            mongosh --eval "rs.initiate()"

      - name: Run tests
        run: npm test

      - name: Run e2e tests
        run: npm run test:e2e

      - name: Run load tests
        run: cd backend && npx ts-node test/load-test.ts
```
