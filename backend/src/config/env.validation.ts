import * as Joi from "joi";

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),

  PORT: Joi.number().port().default(4000),

  MONGODB_URI: Joi.string()
    .uri({ scheme: ["mongodb", "mongodb+srv"] })
    .default("mongodb://localhost:27017/auction"),

  REDIS_URL: Joi.string()
    .uri({ scheme: ["redis", "rediss"] })
    .default("redis://localhost:6379"),

  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .description(
      "JWT signing secret - must be at least 32 characters. Required in all environments.",
    ),

  THROTTLE_TTL: Joi.number()
    .integer()
    .min(1000)
    .default(60000)
    .description("Rate limit window in milliseconds"),

  THROTTLE_LIMIT: Joi.number()
    .integer()
    .min(1)
    .default(100)
    .description("Max requests per window"),

  BOT_TOKEN: Joi.string()
    .pattern(/^\d+:[A-Za-z0-9_-]+$/)
    .required()
    .description("Telegram Bot API token from @BotFather"),

  WEBHOOK_SECRET: Joi.string()
    .min(16)
    .optional()
    .description("Secret token for webhook validation in production"),

  MINI_APP_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .optional()
    .description("URL of the Telegram Mini App (for bot buttons)"),
});
