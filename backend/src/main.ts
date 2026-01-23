import cluster from "node:cluster";
import os from "node:os";
import http from "node:http";
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
  const corsOriginEnv = process.env.CORS_ORIGIN ?? "*";

  // NOTE: Using WebSocket-only transport for Socket.IO.
  // This avoids the Fastify 5.x crash with HTTP polling (preParsing hooks issue).
  // WebSocket upgrades use the HTTP 'upgrade' event, not 'request' event,
  // so they bypass Fastify's routing entirely and go straight to Engine.IO.

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    isProduction ? { logger: new JsonLoggerService() } : {},
  );

  const httpServer = app.getHttpServer() as http.Server;

  // Create Socket.IO and attach to HTTP server
  // Engine.IO adds a listener to httpServer.on('request') that handles /socket.io/* requests
  //
  // IMPORTANT: Using WebSocket-only transport to avoid Fastify 5.x routing issues.
  // HTTP polling transport causes crashes because Fastify's defaultRoute has undefined
  // preParsing hooks. WebSocket-only also eliminates the need for sticky sessions in cluster mode.
  const io = new Server(httpServer, {
    cors: {
      origin: corsOriginEnv,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket"], // WebSocket-only: avoids Fastify routing issue + no sticky sessions needed
    path: "/socket.io/",
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6,
    perMessageDeflate: false,
    httpCompression: false,
    connectTimeout: 45000,
    allowEIO3: true,
  });

  const configService = app.get(ConfigService);

  // Security headers via Helmet
  await app.register(helmet, {
    contentSecurityPolicy: false, // Disabled for Swagger UI compatibility
  });

  // CORS configuration (uses corsOriginEnv from earlier - same as Socket.IO)
  app.enableCors({
    origin: corsOriginEnv,
    credentials: true,
  });

  app.setGlobalPrefix("api");

  // Serve Artillery load test reports at /api/reports/
  const reportsPath = path.join(
    __dirname,
    "..",
    "test",
    "artillery",
    "reports",
  );
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

  const serverUrl =
    nodeEnv === "production" && miniAppUrl !== undefined && miniAppUrl !== ""
      ? miniAppUrl
      : `http://localhost:${String(port)}`;

  const swaggerPath = path.join(__dirname, "..", "swagger.json");
  if (fs.existsSync(swaggerPath)) {
    const document: SwaggerDocument = JSON.parse(
      fs.readFileSync(swaggerPath, "utf-8"),
    ) as SwaggerDocument;
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

  const asyncApiHtmlPath = path.join(__dirname, "..", "asyncapi.html");
  const asyncApiYamlPath = path.join(__dirname, "..", "asyncapi.yaml");

  if (fs.existsSync(asyncApiHtmlPath) && fs.existsSync(asyncApiYamlPath)) {
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

  // Start listening
  // In cluster mode, workers share the port via Node.js cluster (SO_REUSEPORT)
  // With WebSocket-only transport, sticky sessions are NOT needed:
  // - WebSocket connections are persistent on one worker
  // - Redis adapter handles cross-worker message broadcasting
  await app.listen(port, "0.0.0.0");

  if (cluster.isWorker) {
    logger.log(`Worker ${String(cluster.worker?.id)} listening on port ${port}`);
  }

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
 *
 * Architecture:
 * - Primary process: Forks worker processes
 * - Worker processes: Each runs full NestJS instance with Socket.IO, sharing port via SO_REUSEPORT
 * - Redis adapter: Handles cross-worker message broadcasting (rooms, events)
 *
 * NOTE: Using WebSocket-only transport, so sticky sessions are NOT needed:
 * - WebSocket connections are persistent on one worker
 * - Redis adapter ensures events reach all workers' connected clients
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

    // Fork workers - each will listen on the same port (OS handles load balancing)
    for (let i = 0; i < actualWorkers; i++) {
      cluster.fork();
    }

    // Handle worker exit with automatic restart
    cluster.on("exit", (worker, code, signal) => {
      const reason = signal !== "" ? signal : String(code);
      logger.warn(
        `Worker ${String(worker.process.pid)} died (${reason}). Restarting...`,
      );
      cluster.fork();
    });

    // Handle worker online
    cluster.on("online", (worker) => {
      logger.log(
        `Worker ${String(worker.process.pid)} (id: ${String(worker.id)}) is online`,
      );
    });
  } else {
    // Workers run the application - they receive connections via IPC from master
    logger.log(
      `Worker ${String(process.pid)} (id: ${String(cluster.worker?.id)}) starting...`,
    );
    void bootstrap();
  }
}

startCluster();
