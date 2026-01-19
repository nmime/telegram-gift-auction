# Build stage
FROM node:22-alpine AS builder

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config files first for better layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/

# Fetch dependencies (better caching than install)
RUN pnpm fetch

# Install dependencies from cache
RUN pnpm install --offline --frozen-lockfile

# Copy source files
COPY backend/ ./backend/

WORKDIR /app/backend

# Setup typia to patch TypeScript compiler for Nestia transforms
RUN pnpm exec typia setup --manager pnpm

# Build the application
RUN pnpm build
RUN pnpm exec nestia swagger

# Production stage
FROM node:22-alpine AS production

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

WORKDIR /app

# Copy workspace config files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/

# Install production dependencies only
RUN pnpm fetch --prod && \
    pnpm install --offline --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/swagger.json ./backend/swagger.json

# Copy i18n translations if they exist
COPY --from=builder /app/backend/i18n ./backend/i18n

WORKDIR /app/backend

# Set environment
ENV NODE_ENV=production

# Switch to non-root user
USER nestjs

EXPOSE 4000

CMD ["node", "dist/src/main"]
