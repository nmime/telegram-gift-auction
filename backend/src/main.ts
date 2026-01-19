import * as cluster from "cluster";
import * as os from "os";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule, OpenAPIObject } from "@nestjs/swagger";
import { Server } from "socket.io";
import helmet from "@fastify/helmet";
import { AppModule } from "./app.module";
import { EventsGateway } from "./modules/events/events.gateway";
import { JsonLoggerService } from "./common/logger";
import * as fs from "fs";
import * as path from "path";

const logger = new Logger("Bootstrap");

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === "production";
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    isProduction ? { logger: new JsonLoggerService() } : {},
  );

  const configService = app.get(ConfigService);

  // Security headers via Helmet
  await app.register(helmet, {
    contentSecurityPolicy: false, // Disabled for Swagger UI compatibility
  });

  // CORS configuration
  const corsOrigin = configService.get<string>("cors.origin")!;
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.setGlobalPrefix("api");

  const port = configService.get<number>("port")!;
  const nodeEnv = configService.get<string>("nodeEnv");
  const miniAppUrl = configService.get<string>("telegram.miniAppUrl");

  // Server URL: use MINI_APP_URL in production, localhost in development
  const serverUrl =
    nodeEnv === "production" && miniAppUrl
      ? miniAppUrl
      : `http://localhost:${port}`;

  // Load pre-generated swagger.json (generated at build time via npx nestia swagger)
  const swaggerPath = path.join(__dirname, "..", "..", "swagger.json");
  if (fs.existsSync(swaggerPath)) {
    const document = JSON.parse(fs.readFileSync(swaggerPath, "utf-8"));
    // Update server URL dynamically
    document.servers = [{ url: serverUrl }];

    SwaggerModule.setup("api/docs", app, document as OpenAPIObject, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
      customSiteTitle: "Gift Auction API Docs",
    });
    logger.log("Swagger docs loaded from pre-generated swagger.json");
  } else {
    logger.warn(
      'swagger.json not found - API docs disabled. Run "npx nestia swagger" to generate.',
    );
  }

  await app.listen(port, "0.0.0.0");

  // Create Socket.IO server manually after HTTP server is listening
  const httpServer = app.getHttpServer();
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    path: "/socket.io/",
  });

  // Inject Socket.IO server into the EventsGateway
  const eventsGateway = app.get(EventsGateway);
  eventsGateway.setServer(io);

  const shutdown = async () => {
    logger.log("Shutting down gracefully...");

    io.sockets.sockets.forEach((socket) => {
      socket.disconnect(true);
    });

    await new Promise<void>((resolve) => {
      io.close(() => {
        logger.log("Socket.IO server closed");
        resolve();
      });
    });

    await app.close();
    logger.log("Application closed");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  logger.log("Socket.IO server attached to HTTP server");
  const workerId = cluster.isWorker ? cluster.worker?.id : "primary";
  logger.log("Server running", {
    port,
    docs: `http://localhost:${port}/api/docs`,
    workerId,
  });
}

/**
 * Cluster mode for high-throughput scenarios
 * Each worker runs a full NestJS instance, sharing the same port
 * Socket.IO Redis adapter handles cross-worker message broadcasting
 */
function startCluster() {
  const clusterWorkersEnv = process.env.CLUSTER_WORKERS || "0";

  // Support "auto" to use all available CPU cores
  let numWorkers: number;
  if (clusterWorkersEnv.toLowerCase() === "auto") {
    numWorkers = os.cpus().length;
    logger.log(`CLUSTER_WORKERS=auto, detected ${numWorkers} CPU cores`);
  } else {
    numWorkers = parseInt(clusterWorkersEnv, 10);
  }

  // If CLUSTER_WORKERS=0 or not set, run in single-process mode
  if (numWorkers <= 0) {
    logger.log("Running in single-process mode");
    bootstrap();
    return;
  }

  const actualWorkers = Math.min(numWorkers, os.cpus().length);

  if (cluster.isPrimary) {
    logger.log(`Primary ${process.pid} starting ${actualWorkers} workers...`);

    // Fork workers
    for (let i = 0; i < actualWorkers; i++) {
      cluster.fork();
    }

    // Handle worker exit
    cluster.on("exit", (worker, code, signal) => {
      logger.warn(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
      cluster.fork();
    });

    // Handle worker online
    cluster.on("online", (worker) => {
      logger.log(`Worker ${worker.process.pid} is online`);
    });
  } else {
    // Workers run the application
    logger.log(`Worker ${process.pid} starting...`);
    bootstrap();
  }
}

startCluster();
