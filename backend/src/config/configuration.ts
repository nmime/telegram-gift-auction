export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),

  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/auction',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'auction-jwt-secret-change-in-production',
    expiresIn: '24h',
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },

  telegram: {
    botToken: process.env.BOT_TOKEN || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    miniAppUrl: process.env.MINI_APP_URL || '',
  },
});

export type Configuration = ReturnType<typeof configuration>;
