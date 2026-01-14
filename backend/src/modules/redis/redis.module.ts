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

export const REDIS_CLIENT = "REDIS_CLIENT";
export const REDLOCK = "REDLOCK";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const url =
          configService.get<string>("redis.url") || "redis://localhost:6379";
        const redis = new Redis(url, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 50, 2000),
        });
        return redis;
      },
      inject: [ConfigService],
    },
    {
      provide: REDLOCK,
      useFactory: (redis: Redis) => {
        return new Redlock([redis], { retryCount: 0 });
      },
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [REDIS_CLIENT, REDLOCK],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

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
