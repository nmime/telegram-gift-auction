import { Module } from "@nestjs/common";
import { TelegramBotService } from "./telegram-bot.service";
import { TelegramController } from "./telegram.controller";

@Module({
  controllers: [TelegramController],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramModule {}
