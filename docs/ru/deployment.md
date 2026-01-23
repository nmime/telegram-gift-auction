# Развертывание

[← К README](../../README.ru.md) · [Архитектура](./architecture.md) · [API](./api.md) · [Механика аукционов](./auction-mechanics.md) · [Конкурентность](./concurrency.md) · [Тестирование](./testing.md)

---

## Быстрый старт

### Вариант 1: Docker Compose (Рекомендуется)

```bash
# Клонировать и настроить
git clone <repository>
cd telegram-gift-auction

# Настроить окружение
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Отредактировать .env файлы с вашими значениями

# Запустить всё
docker compose up --build

# Доступ:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:4000/api
# - Swagger Docs: http://localhost:4000/api/docs
```

### Вариант 2: Локальная разработка

```bash
# Запустить только инфраструктуру (MongoDB + Redis)
docker compose -f docker-compose.infra.yml up -d

# Установить зависимости и запустить
npm install
npm run dev

# Или запустить отдельно:
npm run dev:backend   # http://localhost:4000
npm run dev:frontend  # http://localhost:5173
```

### Вариант 3: Ручная настройка

**Требования:**
- Node.js 22+
- MongoDB 8.2+ (должен быть replica set для транзакций)
- Redis 7+

```bash
# Backend
cd backend
npm install
npm run start:dev

# Frontend (другой терминал)
cd frontend
npm install
npm run dev
```

---

## Конфигурация

### Переменные окружения Backend

| Переменная | Описание | Обязательно | По умолчанию |
|------------|----------|-------------|--------------|
| `PORT` | Порт сервера | Нет | 4000 |
| `NODE_ENV` | Окружение | Нет | development |
| `MONGODB_URI` | Строка подключения MongoDB | Да | — |
| `REDIS_URL` | Строка подключения Redis | Да | — |
| `JWT_SECRET` | Секрет для подписи JWT | Да | — |
| `JWT_EXPIRES_IN` | Время жизни токена | Нет | 7d |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram бота | Да | — |
| `CORS_ORIGIN` | Разрешённые CORS origins | Нет | http://localhost:5173 |

**Пример `backend/.env`:**
```env
PORT=4000
NODE_ENV=production
MONGODB_URI=mongodb://mongo1:27017,mongo2:27017,mongo3:27017/auction?replicaSet=rs0
REDIS_URL=redis://redis:6379
JWT_SECRET=your-super-secret-key-change-this
JWT_EXPIRES_IN=7d
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
CORS_ORIGIN=https://your-domain.com
```

### Переменные окружения Frontend

| Переменная | Описание | Обязательно | По умолчанию |
|------------|----------|-------------|--------------|
| `VITE_API_URL` | URL Backend API | Да | — |
| `VITE_SOCKET_URL` | URL WebSocket сервера | Да | — |
| `VITE_TELEGRAM_BOT_USERNAME` | Имя бота для логина | Нет | — |

**Пример `frontend/.env`:**
```env
VITE_API_URL=https://api.your-domain.com/api
VITE_SOCKET_URL=https://api.your-domain.com
VITE_TELEGRAM_BOT_USERNAME=your_bot
```

---

## Сервисы Docker Compose

### Полный стек (`docker-compose.yml`)

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "4000:4000"
    depends_on:
      - mongodb
      - redis
    environment:
      - MONGODB_URI=mongodb://mongodb:27017/auction?replicaSet=rs0
      - REDIS_URL=redis://redis:6379

  frontend:
    build: ./frontend
    ports:
      - "5173:80"

  mongodb:
    image: mongo:8.2
    command: --replSet rs0
    volumes:
      - mongodb_data:/data/db

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
```

### Только инфраструктура (`docker-compose.infra.yml`)

Для локальной разработки с hot reload:

```yaml
services:
  mongodb:
    image: mongo:8.2
    ports:
      - "27017:27017"
    command: --replSet rs0

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

---

## Настройка MongoDB Replica Set

Транзакции требуют replica set. Для одноузловой разработки:

```bash
# Инициализировать replica set (выполнить один раз после запуска MongoDB)
docker exec -it mongodb mongosh --eval "rs.initiate()"
```

Для продакшена используйте полноценный 3-узловой replica set:

```yaml
services:
  mongo1:
    image: mongo:8.2
    command: --replSet rs0

  mongo2:
    image: mongo:8.2
    command: --replSet rs0

  mongo3:
    image: mongo:8.2
    command: --replSet rs0
```

---

## Продакшен развертывание

### Рекомендуемая архитектура

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Nginx     │────▶│   Backend   │────▶│  MongoDB    │
│  (Reverse   │     │  (Node.js)  │     │ (Replica)   │
│   Proxy)    │     │             │────▶│             │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │                   ▼
       │            ┌─────────────┐
       │            │    Redis    │
       │            └─────────────┘
       ▼
┌─────────────┐
│  Frontend   │
│  (Static)   │
└─────────────┘
```

### Конфигурация Nginx

```nginx
upstream backend {
    server backend:4000;
}

server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name your-domain.com;

    root /var/www/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Health Checks

Backend предоставляет эндпоинт health:

```bash
curl http://localhost:4000/api/health
# { "status": "ok", "mongodb": "connected", "redis": "connected" }
```

### Масштабирование

Для горизонтального масштабирования:

1. **Backend**: Деплой нескольких инстансов за балансировщиком нагрузки
2. **WebSocket**: Redis adapter обрабатывает сообщения между инстансами
3. **Redlock**: Распределённые блокировки работают между инстансами
4. **Сессии**: JWT stateless, sticky sessions не нужны

```yaml
services:
  backend:
    deploy:
      replicas: 3
```

---

## Настройка Telegram бота

1. Создать бота через [@BotFather](https://t.me/BotFather)
2. Получить токен бота
3. Настроить Mini App:
   - Перейти в BotFather → /mybots → Ваш бот → Bot Settings → Menu Button
   - Установить URL Mini App
4. Настроить webhook (опционально, для уведомлений):
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
        -d "url=https://api.your-domain.com/api/telegram/webhook"
   ```

---

## Мониторинг

### Логи

```bash
# Все сервисы
docker compose logs -f

# Конкретный сервис
docker compose logs -f backend
```

### Метрики

Ключевые метрики для мониторинга:
- Латентность запросов (p50, p95, p99)
- Время обработки ставки
- WebSocket подключения
- Латентность операций MongoDB
- Использование памяти Redis
- Срабатывания rate limit

### Алерты

Настроить алерты для:
- Высокий процент ошибок (>1%)
- Латентность запросов >500мс
- Лаг репликации MongoDB
- Память Redis >80%
- Сбои проверки финансовой целостности
