import { Controller, Req, Res, Headers, Logger } from "@nestjs/common";
import { TypedRoute } from "@nestia/core";
import { ConfigService } from "@nestjs/config";
import type { FastifyRequest, FastifyReply } from "fastify";
import { TelegramBotService } from "./telegram-bot.service";

@Controller("telegram")
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly telegramBotService: TelegramBotService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret =
      this.configService.get<string>("telegram.webhookSecret") || "";
  }

  /**
   * Handle Telegram webhook
   *
   * @internal
   * @ignore
   */
  @TypedRoute.Post("webhook")
  async handleWebhook(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Headers("x-telegram-bot-api-secret-token") secretToken?: string,
  ) {
    // Validate secret token in production
    if (this.webhookSecret && secretToken !== this.webhookSecret) {
      this.logger.warn("Invalid webhook secret token");
      return reply.status(401).send({ error: "Unauthorized" });
    }

    try {
      await this.telegramBotService.handleWebhook(request, reply);
    } catch (error) {
      this.logger.error("Webhook error:", error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  }
}
