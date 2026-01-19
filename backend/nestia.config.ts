import { INestiaConfig } from "@nestia/sdk";

const NESTIA_CONFIG: INestiaConfig = {
  input: "src/modules/*/*.controller.ts",
  output: "src/api",
  e2e: "test/features",
  swagger: {
    output: "swagger.json",
    beautify: true,
    info: {
      title: "Gift Auction API",
      description: `
## Overview
Multi-round auction system API inspired by Telegram Gift Auctions.

## Features
- **Multi-round auctions** with configurable items per round
- **Anti-sniping mechanism** that extends rounds when late bids are placed
- **Real-time updates** via WebSocket
- **Financial integrity** with atomic transactions
- **JWT authentication** with rate limiting
- **Ultra-fast bidding** via Redis Lua scripts (5,000-10,000+ bids/sec)

## Authentication
This API uses JWT Bearer token authentication. Call \`POST /api/auth/login\` to obtain a token.

Include the token in requests: \`Authorization: Bearer <token>\`

## Rate Limiting
- 10 requests per second (burst)
- 50 requests per 10 seconds
- 200 requests per minute

## WebSocket Events
Connect to the WebSocket server at \`/\` and emit:
- \`join-auction\` - Subscribe to auction updates (pass auctionId)
- \`leave-auction\` - Unsubscribe from auction

Server emits:
- \`auction-update\` - Auction state changed
- \`new-bid\` - New bid placed
- \`anti-sniping\` - Round extended
- \`round-complete\` - Round ended with winners
- \`auction-complete\` - Auction finished
      `,
      version: "1.0.0",
    },
    security: {
      bearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  simulate: true,
};

export default NESTIA_CONFIG;
