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
import {
  AsyncApiModule,
  AsyncApiDocumentBuilder,
} from "@nmime/nestjs-asyncapi";
import { getAllSchemas } from "./modules/events/asyncapi.schemas";
import { Server } from "socket.io";
import helmet from "@fastify/helmet";
import { AppModule } from "./app.module";
import { EventsGateway } from "./modules/events";
import { JsonLoggerService } from "./common";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

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
  const corsOrigin = configService.get<string>("CORS_ORIGIN")!;
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.setGlobalPrefix("api");

  const port = configService.get<number>("PORT")!;
  const nodeEnv = configService.get<string>("NODE_ENV");
  const miniAppUrl = configService.get<string>("MINI_APP_URL");

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

  // AsyncAPI documentation for WebSocket events
  const asyncApiHtmlPath = path.join(__dirname, "..", "..", "asyncapi.html");
  const asyncApiYamlPath = path.join(__dirname, "..", "..", "asyncapi.yaml");

  if (isProduction && fs.existsSync(asyncApiHtmlPath)) {
    // Production: serve pre-generated static files
    const httpAdapter = app.getHttpAdapter();
    const html = fs.readFileSync(asyncApiHtmlPath, "utf-8");
    const yamlContent = fs.readFileSync(asyncApiYamlPath, "utf-8");
    const json = JSON.stringify(yaml.load(yamlContent));

    httpAdapter.get(
      "/api/async-docs",
      (
        _req: unknown,
        res: { type: (t: string) => void; send: (b: string) => void },
      ) => {
        res.type("text/html");
        res.send(html);
      },
    );
    httpAdapter.get(
      "/api/async-docs-yaml",
      (
        _req: unknown,
        res: { type: (t: string) => void; send: (b: string) => void },
      ) => {
        res.type("text/yaml");
        res.send(yamlContent);
      },
    );
    httpAdapter.get(
      "/api/async-docs-json",
      (
        _req: unknown,
        res: { type: (t: string) => void; send: (b: string) => void },
      ) => {
        res.type("application/json");
        res.send(json);
      },
    );
    logger.log("AsyncAPI docs loaded from pre-generated asyncapi.html");
  } else {
    // Development: generate dynamically
    const wsServerUrl = `ws://localhost:${port}`;

    const asyncApiOptions = new AsyncApiDocumentBuilder()
      .setAsyncApiVersion("3.0.0")
      .setTitle("Gift Auction WebSocket API")
      .setDescription(
        "Real-time WebSocket events for the auction system. Supports bidding (~3,000 rps × number of CPUs), countdown sync, and live auction updates.",
      )
      .setVersion("1.0.0")
      .setDefaultContentType("application/json")
      .addServer("auction-ws", {
        url: wsServerUrl,
        protocol: "socket.io",
        description: "Auction WebSocket server (Socket.IO)",
      })
      .build();

    const asyncApiDocument = await AsyncApiModule.createDocument(
      app,
      asyncApiOptions,
    );

    // Inject typia-generated schemas (replaces empty decorator-based schemas)
    asyncApiDocument.components = {
      ...(asyncApiDocument.components as object),
      schemas: getAllSchemas(),
    };

    await AsyncApiModule.setup("api/async-docs", app, asyncApiDocument);
    logger.log("AsyncAPI docs available at /api/async-docs");
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
      logger.warn(
        `Worker ${worker.process.pid} died (${signal || code}). Restarting...`,
      );
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
