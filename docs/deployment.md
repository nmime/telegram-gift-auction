# Deployment

[← Back to README](../README.md) · [Architecture](./architecture.md) · [API](./api.md) · [Concurrency](./concurrency.md) · [Testing](./testing.md)

---

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Clone and configure
git clone <repository>
cd telegram-gift-auction

# Configure environment
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit .env files with your values

# Start everything
docker compose up --build

# Access:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:4000/api
# - Swagger Docs: http://localhost:4000/api/docs
```

### Option 2: Local Development

```bash
# Start infrastructure only (MongoDB + Redis)
docker compose -f docker-compose.infra.yml up -d

# Install dependencies and run
npm install
npm run dev

# Or run separately:
npm run dev:backend   # http://localhost:4000
npm run dev:frontend  # http://localhost:5173
```

### Option 3: Manual Setup

**Prerequisites:**
- Node.js 22+
- MongoDB 8.2+ (must be replica set for transactions)
- Redis 7+

```bash
# Backend
cd backend
npm install
npm run start:dev

# Frontend (another terminal)
cd frontend
npm install
npm run dev
```

---

## Configuration

### Backend Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 4000 |
| `NODE_ENV` | Environment | No | development |
| `MONGODB_URI` | MongoDB connection string | Yes | — |
| `REDIS_URL` | Redis connection string | Yes | — |
| `JWT_SECRET` | Secret for signing JWTs | Yes | — |
| `JWT_EXPIRES_IN` | Token expiration | No | 7d |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Yes | — |
| `CORS_ORIGIN` | Allowed CORS origins | No | http://localhost:5173 |

**Example `backend/.env`:**
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

### Frontend Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VITE_API_URL` | Backend API URL | Yes | — |
| `VITE_SOCKET_URL` | WebSocket server URL | Yes | — |
| `VITE_TELEGRAM_BOT_USERNAME` | Bot username for login | No | — |

**Example `frontend/.env`:**
```env
VITE_API_URL=https://api.your-domain.com/api
VITE_SOCKET_URL=https://api.your-domain.com
VITE_TELEGRAM_BOT_USERNAME=your_bot
```

---

## Docker Compose Services

### Full Stack (`docker-compose.yml`)

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

### Infrastructure Only (`docker-compose.infra.yml`)

For local development with hot reload:

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

## MongoDB Replica Set Setup

Transactions require a replica set. For single-node development:

```bash
# Initialize replica set (run once after starting MongoDB)
docker exec -it mongodb mongosh --eval "rs.initiate()"
```

For production, use a proper 3-node replica set:

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

## Production Deployment

### Recommended Architecture

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

### Nginx Configuration

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

Backend exposes health endpoint:

```bash
curl http://localhost:4000/api/health
# { "status": "ok", "mongodb": "connected", "redis": "connected" }
```

### Scaling

For horizontal scaling:

1. **Backend**: Deploy multiple instances behind load balancer
2. **WebSocket**: Redis adapter handles cross-instance messaging
3. **Redlock**: Distributed locks work across instances
4. **Session**: JWT is stateless, no sticky sessions needed

```yaml
services:
  backend:
    deploy:
      replicas: 3
```

---

## Telegram Bot Setup

1. Create bot via [@BotFather](https://t.me/BotFather)
2. Get the bot token
3. Set up Mini App:
   - Go to BotFather → /mybots → Your Bot → Bot Settings → Menu Button
   - Set the Mini App URL
4. Configure webhook (optional, for notifications):
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
        -d "url=https://api.your-domain.com/api/telegram/webhook"
   ```

---

## Monitoring

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
```

### Metrics

Key metrics to monitor:
- Request latency (p50, p95, p99)
- Bid processing time
- WebSocket connections
- MongoDB operation latency
- Redis memory usage
- Rate limit hits

### Alerts

Set up alerts for:
- High error rate (>1%)
- Request latency >500ms
- MongoDB replication lag
- Redis memory >80%
- Financial integrity check failures
