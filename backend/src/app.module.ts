import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from '@/common';
import { configuration, validationSchema } from './config';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { AuctionsModule } from './modules/auctions';
import { BidsModule } from './modules/bids';
import { TransactionsModule } from './modules/transactions';
import { EventsModule } from './modules/events';
import { RedisModule } from './modules/redis';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          name: 'short',
          ttl: 1000,
          limit: 20,
        },
        {
          name: 'medium',
          ttl: 10000,
          limit: 100,
        },
        {
          name: 'long',
          ttl: configService.get<number>('throttle.ttl') || 60000,
          limit: configService.get<number>('throttle.limit') || 300,
        },
      ],
      inject: [ConfigService],
    }),
    RedisModule,
    AuthModule,
    UsersModule,
    AuctionsModule,
    BidsModule,
    TransactionsModule,
    EventsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
