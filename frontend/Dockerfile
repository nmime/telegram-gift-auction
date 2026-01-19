# Build stage
FROM node:22-alpine AS builder

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config files first for better layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY frontend/package.json ./frontend/

# Fetch dependencies (better caching than install)
RUN pnpm fetch

# Install dependencies from cache
RUN pnpm install --offline --frozen-lockfile

# Copy source files
COPY frontend/ ./frontend/

WORKDIR /app/frontend

# Build the application (uses .env file from context)
RUN pnpm build

# Production stage - nginx for static files
FROM nginx:alpine AS production

# Create non-root user for security (nginx already has nginx user)
RUN chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    chown -R nginx:nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

# Copy built static files
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Switch to non-root user
USER nginx

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
