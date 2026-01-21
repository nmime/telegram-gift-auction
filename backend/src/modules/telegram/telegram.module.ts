import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { I18nModule } from "nestjs-i18n";
import { TelegramBotService } from "./telegram-bot.service";
import { TelegramController } from "./telegram.controller";
import { User, UserSchema } from "@/schemas";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    I18nModule,
  ],
  controllers: [TelegramController],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramModule {}
