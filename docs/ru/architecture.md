# Архитектура

## ⚡ Показатели производительности

| Функция | Пропускная способность | Латентность |
|---------|------------------------|-------------|
| **WebSocket ставки** | **~3,000 rps × количество CPU** | p99 < 5мс |
| HTTP Fast Bid (Redis) | ~500 rps × количество CPU | p99 < 20мс |
| Стандартная ставка (MongoDB) | ~20 ставок/сек | p99 < 4с |

**Кластерный режим**: Установите `CLUSTER_WORKERS=4` для масштабирования на несколько ядер (линейный рост пропускной способности).

## Обзор системы

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (React + Vite)                      │
│  - Список и детали аукционов    - Обновления ставок в реальном времени│
│  - Размещение/увеличение ставок - Серверный синхронизированный таймер│
│  - Управление балансом          - Уведомления о переносе ставок      │
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
│  │                      Сервисный слой                          │  │
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
│  │  BidCacheService (Ультра-быстрый путь)                       │  │
│  │  ├─ placeBidUltraFast()   [Единый Lua скрипт]                │  │
│  │  ├─ warmupAuctionCache()                                     │  │
│  │  └─ getAuctionMeta()                                         │  │
│  │                                                               │  │
│  │  EventsGateway (⚡3k rps/CPU)      NotificationsService       │  │
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
│                     │  │                     │  │    Клиенты      │
│  users              │  │  Распределённые     │  │                 │
│  ├─ balance         │  │  блокировки         │  │  Синхр. таймер  │
│  └─ frozenBalance   │  │  (Redlock)          │  │  Обновления     │
│                     │  │                     │  │  ставок         │
│  auctions           │  │  Кулдаун ставок     │  │  Уведомления    │
│  ├─ roundsConfig[]  │  │                     │  │  о переносе     │
│  └─ rounds[]        │  │  Лидерборды         │  │                 │
│                     │  │  (ZSET на аукцион)  │  └─────────────────┘
│  bids               │  │                     │
│  ├─ amount          │  │  Timer Leader       │
│  ├─ status          │  │  (ключ выборов)     │
│  ├─ carriedOver     │  │                     │
│  └─ originalRound   │  └─────────────────────┘
│                     │
│  transactions       │
│  └─ аудит           │
└─────────────────────┘
```

## Технологический стек

| Уровень | Технология | Почему |
|---------|------------|--------|
| **Runtime** | Node.js 22+ | Последний LTS с современными async фичами |
| **Framework** | NestJS 11 + Fastify | 2-3x пропускная способность vs Express |
| **Язык** | TypeScript (strict) | Типобезопасность для финансовых операций |
| **База данных** | MongoDB 8.2+ | Транзакции, гибкие схемы, replica sets |
| **Кэш/Блокировки** | Redis + Redlock | Распределённые блокировки, ZSET лидерборды, выборы лидера |
| **Real-time** | Socket.IO + Redis adapter | Масштабируемый WebSocket с серверной синхронизацией |
| **Авторизация** | JWT Bearer tokens | Stateless, distributed-friendly |
| **Telegram** | GrammyJS | Современный Telegram бот фреймворк |
| **Frontend** | React 19 + Vite | Быстрая разработка, современный тулинг |
| **Валидация** | class-validator + Joi | Комплексная валидация входных данных |

## Redis ключи

| Паттерн ключа | Тип | Назначение |
|---------------|-----|------------|
| `leaderboard:{auctionId}` | ZSET | O(log N) лидерборд с композитным score |
| `timer-service:leader` | STRING | Выборы лидера для трансляции таймеров (TTL 5с) |
| `bid:{auctionId}:{odId}` | STRING | Распределённая блокировка для операций со ставками |
| `cooldown:{auctionId}:{odId}` | STRING | 1-секундный кулдаун ставок (TTL 1с) |
| `auction:{auctionId}:balance:{userId}` | HASH | Кэш баланса пользователя (available, frozen) |
| `auction:{auctionId}:meta` | HASH | Кэш метаданных аукциона (статус, раунд, тайминг) |
| `auction:{auctionId}:dirty:users` | SET | Пользователи с изменёнными балансами (для синхронизации) |
| `auction:{auctionId}:dirty:bids` | SET | Изменённые ставки (для синхронизации) |

### Формула score лидерборда

```
score = amount × 10^13 + (MAX_TIMESTAMP - createdAt)
```

Это обеспечивает:
- Большие суммы ранжируются первыми
- При равных суммах побеждает более ранняя ставка
- Одна операция ZSET для обоих критериев

## Структура проекта

```
├── backend/
│   ├── src/
│   │   ├── common/          # Guards, errors, types
│   │   ├── config/          # Конфигурация и валидация env
│   │   ├── modules/
│   │   │   ├── auctions/    # Основная логика + TimerService
│   │   │   ├── auth/        # JWT + Telegram авторизация
│   │   │   ├── bids/        # Запросы ставок
│   │   │   ├── events/      # WebSocket gateway (countdown, carryover)
│   │   │   ├── redis/       # Redis клиент + Redlock + LeaderboardService
│   │   │   ├── notifications/# Telegram уведомления (carryover, outbid)
│   │   │   ├── telegram/    # Интеграция бота
│   │   │   ├── transactions/# Финансовый аудит
│   │   │   └── users/       # Управление пользователями
│   │   ├── schemas/         # MongoDB схемы
│   │   └── scripts/         # Нагрузочное тестирование
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/             # API клиент
│   │   ├── components/      # UI компоненты
│   │   ├── context/         # Auth & notifications
│   │   ├── hooks/           # useSocket, useCountdown (гибридная синхр.)
│   │   ├── i18n/            # Переводы (en/ru)
│   │   ├── pages/           # Страницы роутов
│   │   └── types/           # TypeScript интерфейсы
│   └── Dockerfile
├── docs/                    # Документация (en + ru)
├── docker-compose.yml       # Полный стек
└── docker-compose.infra.yml # Только инфраструктура
```

## Модели данных

### User (Пользователь)

```typescript
{
  telegramId: number;       // Telegram ID пользователя
  username?: string;        // @username
  firstName: string;
  lastName?: string;
  balance: number;          // Доступные средства (min: 0)
  frozenBalance: number;    // Заблокировано в активных ставках (min: 0)
  version: number;          // Оптимистичная блокировка
}
```

### Auction (Аукцион)

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

### Bid (Ставка)

```typescript
{
  auctionId: ObjectId;
  odId: ObjectId;
  telegramId: number;
  amount: number;
  round: number;
  status: 'active' | 'won' | 'lost' | 'refunded';
  carriedOver: boolean;     // true если перенесена из предыдущего раунда
  originalRound: number;    // раунд, где ставка была сделана впервые
  createdAt: Date;
  updatedAt: Date;
}
```

### Transaction (Транзакция)

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

## Ключевые сервисы

### LeaderboardService

Redis ZSET лидерборд с O(log N) операциями:

```typescript
// Добавить/обновить ставку в лидерборде
await leaderboardService.addBid(auctionId, odId, name, amount, createdAt);

// Удалить ставку (при победе)
await leaderboardService.removeBid(auctionId, odId visibleName);

// Получить топ N ставок
const top = await leaderboardService.getTop(auctionId, limit, offset);

// Fallback на MongoDB если Redis недоступен
```

### TimerService

Серверная трансляция обратного отсчёта с выборами лидера через Redis:

```typescript
// Только один инстанс сервера транслирует таймеры (лидер)
// Выборы лидера через Redis ключ с 5с TTL
// Трансляция каждую секунду всем подключённым клиентам
// Все клиенты видят синхронизированный отсчёт
```

### NotificationsService

Уведомления Telegram бота:

```typescript
// Уведомление при перебитии ставки
await notificationsService.notifyOutbid(odId, auctionTitle, newAmount);

// Уведомление о переносе ставки в следующий раунд
await notificationsService.notifyBidCarryover(odId, auctionTitle, round, amount);

// Уведомление о победе
await notificationsService.notifyWin(odId, auctionTitle, amount);
```

### EventsGateway (⚡ WebSocket ставки)

**Максимальная пропускная способность: ~3,000 rps × количество CPU с p99 < 5мс**

```typescript
// Использование на клиенте
const socket = io('ws://localhost:4000', { transports: ['websocket'] });

// 1. Аутентификация сокета с JWT
socket.emit('auth', jwtToken);
socket.on('auth-response', ({ success, userId }) => { /* ... */ });

// 2. Ставки через WebSocket (полностью обходит HTTP!)
socket.emit('place-bid', { auctionId: '...', amount: 1000 });
socket.on('bid-response', ({ success, amount, previousAmount, error }) => {
  // Мгновенный ответ с подтверждением ставки
});

// Сервер обрабатывает:
// - Верификацию JWT через JwtService
// - Прямой вызов BidCacheService.placeBidUltraFast()
// - Рассылку new-bid события в комнату аукциона
// - Асинхронную проверку анти-снайпинга (неблокирующая)
```

## Дизайн-решения

### Почему Redis ZSET для лидерборда?

MongoDB `find().sort()` это O(N log N). Redis ZSET даёт O(log N) для вставки и O(log N + M) для range-запросов. При высокой частоте ставок это значительно снижает латентность.

### Почему серверная трансляция таймеров?

Клиентские таймеры дрейфуют и могут быть подделаны. Серверная трансляция обеспечивает:
- Все клиенты видят идентичный отсчёт
- Анти-снайпинг продления распространяются мгновенно
- Нет проблем с рассинхронизацией часов клиента

### Почему Redis выборы лидера для таймеров?

При multi-server деплое только один сервер должен транслировать таймеры, чтобы избежать дублирования событий. Redis ключ с TTL обеспечивает простые выборы лидера.

### Почему отслеживание переноса ставок?

Когда проигравшие переносятся в следующий раунд, отслеживание `carriedOver` и `originalRound` позволяет:
- Уведомлять пользователя об автоматическом переносе
- Аналитика поведения ставок
- Чёткий аудит

### Почему MongoDB транзакции?

Финансовые операции требуют атомарности. Если списание баланса успешно, а создание ставки — нет, система потеряет деньги.

### Почему Fastify вместо Express?

2-3x лучшая пропускная способность — критично для высоконагруженных аукционных сценариев.

### Почему единый Lua скрипт для ультра-быстрых ставок?

MongoDB транзакции добавляют ~50-100мс латентности при конкурентной нагрузке. Единый Lua скрипт в Redis:
- Выполняется атомарно за ~0.02мс
- Исключает сетевые round-trip'ы (HGETALL + валидация + обновление в одном вызове)
- Делает ВСЮ валидацию + размещение ставки за один вызов
- Возвращает все метаданные аукциона (не нужен дополнительный вызов Redis для анти-снайпинга)
- Обеспечивает ~3,000 rps × количество CPU vs ~20 ставок/сек с MongoDB

### Почему фоновая синхронизация вместо Write-Through?

Real-time запись в MongoDB нивелирует преимущества скорости. 5-секундный интервал синхронизации:
- Обеспечивает отличную durability (макс. 5с потери данных при катастрофическом сбое)
- Поддерживает латентность ставки менее 1мс
- Использует bulk операции для эффективности

### Почему eager warmup пользователей?

Ленивая загрузка кэша добавляет 5-10мс латентности для первого участника. Eager warmup при старте аукциона:
- Предзагружает всех пользователей с положительным балансом
- Обеспечивает стабильную латентность менее 1мс для всех
- Компромисс: больше памяти, но приемлемо для активных аукционов

### Почему ставки через WebSocket?

HTTP запросы добавляют ~5-10мс накладных расходов на заголовки, обработку соединения и форматирование ответа. WebSocket ставки исключают это полностью:
- Payload ставки идёт напрямую на сервер по установленному соединению
- В сочетании с Lua скриптом: **~3,000 rps × количество CPU** с p99 < 5мс
- Нет накладных расходов на rate limiting (соединение уже аутентифицировано)
- Мгновенные подтверждения ставок через событие `bid-response`

### Почему кластерный режим?

Node.js однопоточный. Кластерный режим позволяет:
- Несколько воркер-процессов используют все ядра CPU
- Линейное масштабирование: 4 воркера ≈ 4x пропускной способности
- Авто-перезапуск упавших воркеров
- Redis адаптер синхронизирует Socket.IO события между воркерами

```bash
# Автоопределение ядер CPU
CLUSTER_WORKERS=auto pnpm start

# Или указать точное количество воркеров
CLUSTER_WORKERS=4 pnpm start

# Воркеры разделяют один порт через cluster module
# Каждый воркер — полноценный NestJS инстанс
# Redis адаптер гарантирует доставку WebSocket событий всем клиентам
```
