import cluster from "node:cluster";
import os from "node:os";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import {
  AsyncApiModule,
  AsyncApiDocumentBuilder,
} from "@nmime/nestjs-asyncapi";
import { getAllSchemas } from "./modules/events/asyncapi.schemas";
import { Server } from "socket.io";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { AppModule } from "./app.module";
import { EventsGateway } from "./modules/events";
import { JsonLoggerService } from "./common";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const logger = new Logger("Bootstrap");

interface SwaggerDocument extends OpenAPIObject {
  servers?: { url: string }[];
}

async function bootstrap(): Promise<void> {
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
  const corsOrigin = configService.get<string>("CORS_ORIGIN") ?? "*";
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.setGlobalPrefix("api");

  // Serve Artillery load test reports at /api/reports/ (only in dev/test environments)
  // Note: test/ directory is at project root, two levels up from dist/
  const reportsPath = path.join(__dirname, "..", "..", "test", "artillery", "reports");
  const reportsAvailable = fs.existsSync(reportsPath);
  if (reportsAvailable) {
    await app.register(fastifyStatic, {
      root: reportsPath,
      prefix: "/api/reports/",
      decorateReply: false, // Avoid conflict with other static handlers
    });
    logger.log("Artillery reports available at /api/reports/");
  }

  const port = configService.get<number>("PORT") ?? 4000;
  const nodeEnv = configService.get<string>("NODE_ENV");
  const miniAppUrl = configService.get<string>("MINI_APP_URL");

  // Server URL: use MINI_APP_URL in production, localhost in development
  const serverUrl =
    nodeEnv === "production" && miniAppUrl !== undefined && miniAppUrl !== ""
      ? miniAppUrl
      : `http://localhost:${String(port)}`;

  // Load pre-generated swagger.json (generated at build time via npx nestia swagger)
  const swaggerPath = path.join(__dirname, "..", "swagger.json");
  if (fs.existsSync(swaggerPath)) {
    const document: SwaggerDocument = JSON.parse(
      fs.readFileSync(swaggerPath, "utf-8"),
    ) as SwaggerDocument;
    // Update server URL dynamically
    document.servers = [{ url: serverUrl }];

    SwaggerModule.setup("api/docs", app, document, {
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
  const asyncApiHtmlPath = path.join(__dirname, "..", "asyncapi.html");
  const asyncApiYamlPath = path.join(__dirname, "..", "asyncapi.yaml");

  if (fs.existsSync(asyncApiHtmlPath) && fs.existsSync(asyncApiYamlPath)) {
    // Serve pre-generated static files (production or development with pre-built docs)
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
  } else if (isProduction) {
    // Production without pre-generated files: skip AsyncAPI (don't try dynamic generation)
    logger.warn(
      'asyncapi.html/yaml not found - AsyncAPI docs disabled. Run "pnpm asyncapi:generate" to generate.',
    );
  } else {
    // Development only: generate dynamically (requires write access to node_modules)
    const wsServerUrl = `ws://localhost:${String(port)}`;

    const asyncApiOptions = new AsyncApiDocumentBuilder()
      .setAsyncApiVersion("3.0.0")
      .setTitle("Gift Auction WebSocket API")
      .setDescription(
        "Real-time WebSocket events for the auction system. Supports bidding (~3,000 rps x number of CPUs), countdown sync, and live auction updates.",
      )
      .setVersion("1.0.0")
      .setDefaultContentType("application/json")
      .addServer("auction-ws", {
        url: wsServerUrl,
        protocol: "socket.io",
        description: "Auction WebSocket server (Socket.IO)",
      })
      .build();

    const asyncApiDocument = AsyncApiModule.createDocument(
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
    // Performance optimizations for high throughput (63K+ emit/sec target)
    pingInterval: 25000, // Reduce ping overhead (default: 25000)
    pingTimeout: 20000, // Allow more time before disconnect (default: 20000)
    maxHttpBufferSize: 1e6, // 1MB buffer (default: 1e6)
    perMessageDeflate: false, // Disable compression for raw speed
    httpCompression: false, // Disable HTTP compression
    connectTimeout: 45000, // Connection timeout
    allowEIO3: true, // Allow Engine.IO v3 clients
  });

  // Inject Socket.IO server into the EventsGateway
  const eventsGateway = app.get(EventsGateway);
  eventsGateway.setServer(io);

  const shutdown = async (): Promise<void> => {
    logger.log("Shutting down gracefully...");

    io.sockets.sockets.forEach((socket) => {
      socket.disconnect(true);
    });

    await new Promise<void>((resolve) => {
      void io.close(() => {
        logger.log("Socket.IO server closed");
        resolve();
      });
    });

    await app.close();
    logger.log("Application closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });

  logger.log("Socket.IO server attached to HTTP server");
  const workerId = cluster.isWorker ? cluster.worker?.id : "primary";
  const serverInfo: Record<string, string | number> = {
    port,
    docs: `http://localhost:${String(port)}/api/docs`,
    workerId: String(workerId ?? "primary"),
  };
  if (reportsAvailable) {
    serverInfo.reports = `http://localhost:${String(port)}/api/reports/`;
  }
  logger.log("Server running", serverInfo);
}

/**
 * Cluster mode for high-throughput scenarios
 * Each worker runs a full NestJS instance, sharing the same port
 * Socket.IO Redis adapter handles cross-worker message broadcasting
 */
function startCluster(): void {
  const clusterWorkersEnv = process.env.CLUSTER_WORKERS ?? "0";

  // Support "auto" to use all available CPU cores
  let numWorkers: number;
  if (clusterWorkersEnv.toLowerCase() === "auto") {
    numWorkers = os.cpus().length;
    logger.log(
      `CLUSTER_WORKERS=auto, detected ${String(numWorkers)} CPU cores`,
    );
  } else {
    numWorkers = parseInt(clusterWorkersEnv, 10);
  }

  // If CLUSTER_WORKERS=0 or not set, run in single-process mode
  if (numWorkers <= 0) {
    logger.log("Running in single-process mode");
    void bootstrap();
    return;
  }

  const actualWorkers = Math.min(numWorkers, os.cpus().length);

  if (cluster.isPrimary) {
    logger.log(
      `Primary ${String(process.pid)} starting ${String(actualWorkers)} workers...`,
    );

    // Fork workers
    for (let i = 0; i < actualWorkers; i++) {
      cluster.fork();
    }

    // Handle worker exit
    cluster.on("exit", (worker, code, signal) => {
      const reason = signal !== "" ? signal : String(code);
      logger.warn(
        `Worker ${String(worker.process.pid)} died (${reason}). Restarting...`,
      );
      cluster.fork();
    });

    // Handle worker online
    cluster.on("online", (worker) => {
      logger.log(`Worker ${String(worker.process.pid)} is online`);
    });
  } else {
    // Workers run the application
    logger.log(`Worker ${String(process.pid)} starting...`);
    void bootstrap();
  }
}

startCluster();
