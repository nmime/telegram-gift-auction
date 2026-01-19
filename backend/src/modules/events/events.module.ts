import { Module } from "@nestjs/common";
import { EventsGateway } from "./events.gateway";
import { RedisModule } from "@/modules/redis";
import { AuthModule } from "@/modules/auth";

@Module({
  imports: [RedisModule, AuthModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
