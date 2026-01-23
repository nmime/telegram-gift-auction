# Система аукционов Telegram Gift

**Продакшен-ready многораундовая аукционная платформа для Telegram.**

[![Демо](https://img.shields.io/badge/Демо-funfiesta.games-blue?style=flat-square)](https://telegram-gift-auction.funfiesta.games)
[![Telegram Бот](https://img.shields.io/badge/Бот-@tggiftauctionbot-0088cc?style=flat-square&logo=telegram)](https://t.me/tggiftauctionbot)
[![API Docs](https://img.shields.io/badge/API-Swagger-orange?style=flat-square)](https://telegram-gift-auction.funfiesta.games/api/docs)

---
[English version](./README.md) 

---

· [Архитектура](./docs/ru/architecture.md) · [API](./docs/ru/api.md) · [Тестирование](./docs/ru/testing.md) · [Деплой](./docs/ru/deployment.md)

---

## Производительность (один процесс)

```
WebSocket:  200,000 emit/sec пик, 176,000/sec устойчивая, 0мс латентность
HTTP:       197 req/s устойчивая, 1.5мс mean, 5мс p99
Оценка:     A+ (готово к продакшену)
```

Полные бенчмарки: [BENCHMARK_REPORT.md](./backend/test/artillery/BENCHMARK_REPORT.md)

---

## Ключевые возможности

| Функция | Описание |
|---------|----------|
| **Многораундовые аукционы** | Предметы распределены по раундам (напр. 3+5+2), частичные победители каждый раунд |
| **5-уровневая конкурентность** | Redlock → Redis cooldown → MongoDB транзакции → оптимистичная блокировка → уникальные индексы |
| **Ультра-быстрые ставки** | Единый Redis Lua скрипт (~2мс), WebSocket ставки обходят HTTP |
| **Анти-снайпинг** | Настраиваемое окно с автоматическим продлением раундов |
| **Финансовая целостность** | Заморозка баланса, атомарные операции, полный audit trail |
| **Нативный Telegram** | Login Widget, Mini App auth, уведомления бота (GrammyJS) |
| **Горизонтальное масштабирование** | Кластерный режим + Redis adapter для multi-server |

---

## Стек технологий

**Backend:** NestJS 11 + Fastify · MongoDB 8 · Redis + Redlock · Socket.IO · JWT
**Frontend:** React 19 + Vite · TypeScript · i18n (en/ru)
**Инфра:** Docker Compose · Node.js 22+

---

## Быстрый старт

```bash
# Docker (рекомендуется)
cp backend/.env.example backend/.env
docker compose up --build

# Локальная разработка
docker compose -f docker-compose.infra.yml up -d
npm install && npm run dev
```

**Доступ:** Frontend `localhost:5173` · API `localhost:4000/api` · Docs `localhost:4000/api/docs`

---

## Как это работает

### Поток аукциона
```
PENDING → ACTIVE → COMPLETED
            ├── Раунд 1: Топ 3 выигрывают
            ├── Раунд 2: Топ 5 выигрывают
            └── Раунд 3: Топ 2 выигрывают → Остальным возврат
```

### Поток ставки (5-уровневая защита)
```
1. Redlock        → Захват распределённой блокировки (fail-fast)
2. Redis cooldown → 1с между ставками на пользователя
3. MongoDB tx     → Snapshot isolation + retry
4. Optimistic     → Проверка версии user/bid
5. Unique index   → Нет дублирующих сумм
```

### Финансовая модель
```
balance        = доступно для ставок
frozenBalance  = заблокировано в активных ставках

Ставка:   balance -= X, frozenBalance += X
Победа:   frozenBalance -= X (потрачено)
Возврат:  frozenBalance -= X, balance += X
```

---

## Обзор API

### REST эндпоинты

| Эндпоинт | Описание |
|----------|----------|
| `POST /api/auth/telegram/webapp` | Mini App аутентификация |
| `GET /api/auctions` | Список аукционов |
| `POST /api/auctions/:id/bid` | Разместить ставку (стандарт) |
| `POST /api/auctions/:id/fast-bid` | Разместить ставку (Redis, высокая производительность) |
| `GET /api/auctions/:id/leaderboard` | Текущий рейтинг |
| `GET /api/users/balance` | Получить баланс |

### WebSocket события

```javascript
// Аутентификация и подписка
socket.emit('auth', jwtToken);
socket.emit('join-auction', auctionId);

// Ставка (63K/sec возможно)
socket.emit('place-bid', { auctionId, amount: 1000 });

// Получение обновлений
socket.on('new-bid', data => { /* ... */ });
socket.on('bid-response', ({ success, amount }) => { /* ... */ });
```

---

## Конфигурация

| Переменная | Описание |
|------------|----------|
| `MONGODB_URI` | Подключение MongoDB (требуется replica set) |
| `REDIS_URL` | Подключение Redis |
| `JWT_SECRET` | Секрет для подписи JWT |
| `TELEGRAM_BOT_TOKEN` | Токен бота для уведомлений |
| `CLUSTER_WORKERS` | `0`=один процесс, `auto`=все ядра |

### Rate Limits
- **Short:** 20/сек · **Medium:** 100/10сек · **Long:** 300/мин

---

## Нагрузочное тестирование

```bash
# HTTP
pnpm run load-test           # Стандартный
pnpm run load-test:stress    # Экстремальный

# WebSocket
npx artillery run test/artillery/websocket-extreme.yml  # 63K emit/s
```

---

## Дизайн-решения

- **MongoDB транзакции** — Атомарные финансовые операции
- **Redis Lua скрипты** — Один вызов для всей валидации + размещения (~0.02мс)
- **Фоновая синхронизация** — 5с интервал балансирует скорость и durability
- **WebSocket ставки** — Устраняет HTTP overhead для макс. пропускной способности
- **Уникальные суммы ставок** — Детерминированные лидерборды, нет ничьих

Подробнее: [docs/ru/architecture.md](./docs/ru/architecture.md) · [docs/ru/concurrency.md](./docs/ru/concurrency.md)

---

## Лицензия

MIT
