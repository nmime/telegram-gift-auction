FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

# Setup typia to patch TypeScript compiler for Nestia transforms
RUN npx typia setup --manager npm

COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["npm", "run", "start:prod"]
