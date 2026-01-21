import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AuditLog, AuditLogSchema } from "@/schemas";
import { AuditLogService } from "./services";
import { AuditController } from "./audit.controller";
import { AuthModule } from "@/modules/auth";
import { AuditMiddleware } from "@/common/middleware";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    AuthModule,
  ],
  controllers: [AuditController],
  providers: [AuditLogService, AuditMiddleware],
  exports: [AuditLogService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditMiddleware).forRoutes("*"); // Apply to all routes - it internally filters for POST/PUT/DELETE/PATCH
  }
}
