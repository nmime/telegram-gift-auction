import { Controller, Req, UseGuards } from "@nestjs/common";
import { TypedRoute, TypedBody } from "@nestia/core";
import { AuthService } from "./auth.service";
import { TelegramService } from "./telegram.service";
import { AuthGuard, AuthenticatedRequest } from "@/common";
import {
  ILoginResponse,
  IUserResponse,
  ILogoutResponse,
  ITelegramWidgetAuth,
  ITelegramWebAppAuth,
} from "./dto";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly telegramService: TelegramService,
  ) {}

  @TypedRoute.Post("telegram/widget")
  async loginWithTelegramWidget(
    @TypedBody() body: ITelegramWidgetAuth,
  ): Promise<ILoginResponse> {
    const validatedUser = this.telegramService.validateWidgetAuth(body);
    return await this.authService.loginWithTelegramWidget(validatedUser);
  }

  @TypedRoute.Post("telegram/webapp")
  async loginWithTelegramMiniApp(
    @TypedBody() body: ITelegramWebAppAuth,
  ): Promise<ILoginResponse> {
    const validatedData = this.telegramService.validateWebAppInitData(
      body.initData,
    );
    return await this.authService.loginWithTelegramMiniApp(validatedData);
  }

  @TypedRoute.Post("logout")
  @UseGuards(AuthGuard)
  logout(): ILogoutResponse {
    return { success: true };
  }

  @TypedRoute.Get("me")
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthenticatedRequest): Promise<IUserResponse | null> {
    const user = await this.authService.validateUser(req.user.sub);
    if (!user) {
      return null;
    }

    return {
      id: user._id.toString(),
      username: user.username,
      balance: user.balance,
      frozenBalance: user.frozenBalance,
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      photoUrl: user.photoUrl,
      languageCode: user.languageCode,
    };
  }
}
