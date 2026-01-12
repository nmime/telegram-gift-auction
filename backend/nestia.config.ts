import { INestiaConfig } from "@nestia/sdk";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { AppModule } from "@/app.module";

const NESTIA_CONFIG: INestiaConfig = {
  input: async () => {
    const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix("api");
    return app;
  },
  output: "src/api",
  e2e: "test/features",
  swagger: {
    output: "swagger.json",
    beautify: true,
  },
  simulate: true,
};

export default NESTIA_CONFIG;
