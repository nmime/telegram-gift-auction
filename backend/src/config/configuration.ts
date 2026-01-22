/**
 * Application configuration
 * Access via ConfigService.get('KEY') where KEY matches the env var name
 */

interface ConfigurationValues {
  NODE_ENV: string;
  PORT: number;
  CORS_ORIGIN: string;
  MONGODB_URI: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  THROTTLE_TTL: number;
  THROTTLE_LIMIT: number;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  MINI_APP_URL: string;
}

export const configuration = (): ConfigurationValues => ({
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: parseInt(process.env.PORT ?? "4000", 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://localhost:27017/auction",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  JWT_SECRET: process.env.JWT_SECRET ?? "", // Required - validated by Joi at runtime
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "24h",
  THROTTLE_TTL: parseInt(process.env.THROTTLE_TTL ?? "60000", 10),
  THROTTLE_LIMIT: parseInt(process.env.THROTTLE_LIMIT ?? "100", 10),
  BOT_TOKEN: process.env.BOT_TOKEN ?? "",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET ?? "",
  MINI_APP_URL: process.env.MINI_APP_URL ?? "",
});

export type Configuration = ReturnType<typeof configuration>;
