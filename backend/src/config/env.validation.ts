import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number()
    .port()
    .default(4000),

  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .default('mongodb://localhost:27017/auction'),

  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),

  JWT_SECRET: Joi.string()
    .min(16)
    .default('auction-jwt-secret-change-in-production')
    .description('JWT signing secret - must be at least 16 characters'),

  CORS_ORIGIN: Joi.string()
    .uri()
    .default('http://localhost:5173'),

  THROTTLE_TTL: Joi.number()
    .integer()
    .min(1000)
    .default(60000)
    .description('Rate limit window in milliseconds'),

  THROTTLE_LIMIT: Joi.number()
    .integer()
    .min(1)
    .default(100)
    .description('Max requests per window'),
});
