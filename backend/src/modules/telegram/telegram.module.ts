import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { TelegramBotService } from "./telegram-bot.service";
import { TelegramController } from "./telegram.controller";
import { User, UserSchema } from "@/schemas";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [TelegramController],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramModule {}
