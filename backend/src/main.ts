import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Server } from 'socket.io';
import { AppModule } from './app.module';
import { EventsGateway } from './modules/events/events.gateway';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const adapter = new FastifyAdapter();
  const app = (await NestFactory.create(
    AppModule,
    adapter as unknown as Parameters<typeof NestFactory.create>[1],
  )) as unknown as NestFastifyApplication;

  const configService = app.get(ConfigService);

  app.enableCors({
    origin: configService.get<string>('cors.origin'),
    credentials: configService.get<boolean>('cors.credentials'),
  });


  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Gift Auction API')
    .setDescription(`
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
    `)
    .setVersion('1.0.0')
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management and balance operations')
    .addTag('auctions', 'Auction management and bidding')
    .addTag('transactions', 'Transaction history')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Enter JWT token',
    })
    .build();

  const document = SwaggerModule.createDocument(app as unknown as INestApplication, config);
  SwaggerModule.setup('api/docs', app as unknown as INestApplication, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'Gift Auction API Docs',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { font-size: 2.5rem }
    `,
  });

  const shutdown = async () => {
    logger.log('Shutting down');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const port = configService.get<number>('port')!;
  await app.listen(port, '0.0.0.0');

  // Create Socket.IO server manually after HTTP server is listening
  const httpServer = app.getHttpServer();
  const io = new Server(httpServer, {
    cors: {
      origin: configService.get<string>('cors.origin'),
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
