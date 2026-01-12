import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { Server } from 'socket.io';
import { AppModule } from './app.module';
import { EventsGateway } from './modules/events/events.gateway';
import * as fs from 'fs';
import * as path from 'path';

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

  // Load pre-generated swagger.json (generated at build time via npx nestia swagger)
  const swaggerPath = path.join(__dirname, '..', '..', 'swagger.json');
  if (fs.existsSync(swaggerPath)) {
    const document = JSON.parse(fs.readFileSync(swaggerPath, 'utf-8'));
    // Update server URL dynamically
    document.servers = [{ url: serverUrl }];

    SwaggerModule.setup('api/docs', app, document as OpenAPIObject, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
      customSiteTitle: 'Gift Auction API Docs'
    });
    logger.log('Swagger docs loaded from pre-generated swagger.json');
  } else {
    logger.warn('swagger.json not found - API docs disabled. Run "npx nestia swagger" to generate.');
  }

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
