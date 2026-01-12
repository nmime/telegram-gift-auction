import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { NestiaSwaggerComposer } from '@nestia/sdk';
import { Server } from 'socket.io';
import { AppModule } from './app.module';
import { EventsGateway } from './modules/events/events.gateway';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  const port = configService.get<number>('port')!;
  const nodeEnv = configService.get<string>('nodeEnv');
  const miniAppUrl = configService.get<string>('telegram.miniAppUrl');

  // Server URL: use MINI_APP_URL in production, localhost in development
  const serverUrl = nodeEnv === 'production' && miniAppUrl
    ? miniAppUrl
    : `http://localhost:${port}`;

  // Generate Swagger document using Nestia's runtime composer
  const document = await NestiaSwaggerComposer.document(app, {
    openapi: '3.1',
    info: {
      title: 'Gift Auction API',
      description: `
## Overview
Multi-round auction system API inspired by Telegram Gift Auctions.

## Features
- **Multi-round auctions** with configurable items per round
- **Anti-sniping mechanism** that extends rounds when late bids are placed
- **Real-time updates** via WebSocket
- **Financial integrity** with atomic transactions
- **JWT authentication** with rate limiting

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
      version: '1.0.0',
    },
    servers: [{ url: serverUrl }],
    security: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  });

  SwaggerModule.setup('api/docs', app, document as OpenAPIObject, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'Gift Auction API Docs'
  });

  const shutdown = async () => {
    logger.log('Shutting down');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen(port, '0.0.0.0');

  // Create Socket.IO server manually after HTTP server is listening
  const httpServer = app.getHttpServer();
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
  });

  // Inject Socket.IO server into the EventsGateway
  const eventsGateway = app.get(EventsGateway);
  eventsGateway.setServer(io);

  logger.log('Socket.IO server attached to HTTP server');
  logger.log('Server running', { port, docs: `http://localhost:${port}/api/docs` });
}

bootstrap();
