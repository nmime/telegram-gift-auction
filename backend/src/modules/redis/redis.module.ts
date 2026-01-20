import {
  Module,
  Global,
  OnModuleDestroy,
  Inject,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import Redlock from "redlock";
import { LeaderboardService } from "./leaderboard.service";
import { BidCacheService } from "./bid-cache.service";
import { redisClient, redlock } from "./constants";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: redisClient,
      useFactory: (configService: ConfigService) => {
        const url =
          configService.get<string>("REDIS_URL") || "redis://localhost:6379";
        const redis = new Redis(url, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 50, 2000),
        });
        return redis;
      },
      inject: [ConfigService],
    },
    {
      provide: redlock,
      useFactory: (redis: Redis) => {
        return new Redlock([redis], { retryCount: 0 });
      },
      inject: [redisClient],
    },
    LeaderboardService,
    BidCacheService,
  ],
  exports: [redisClient, redlock, LeaderboardService, BidCacheService],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(redisClient) private readonly redis: Redis) {}

  async onModuleInit() {
    try {
      const pong = await this.redis.ping();
      this.logger.log("Redis connected", pong);
    } catch (error) {
      this.logger.error("Redis connection failed", error);
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }
}
