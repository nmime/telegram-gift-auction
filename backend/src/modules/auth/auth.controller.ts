import { Controller, Req, UseGuards } from "@nestjs/common";
import { TypedRoute, TypedBody } from "@nestia/core";
import { AuthService } from "./auth.service";
import { TelegramService } from "./telegram.service";
import { AuthGuard, AuthenticatedRequest } from "@/common";
import {
  ILogin,
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

  /**
   * Login or register user
   *
   * Authenticates a user by username. Creates a new user if the username does not exist.
   * Returns JWT access token.
   *
   * @tag auth
   * @param body Login credentials
   * @returns Login response with user data and access token
   */
  @TypedRoute.Post("login")
  async login(@TypedBody() body: ILogin): Promise<ILoginResponse> {
    return this.authService.login(body.username);
  }

  /**
   * Login via Telegram Login Widget
   *
   * Authenticates a user using data from Telegram Login Widget.
   * Creates a new user if not exists.
   *
   * @tag auth
   * @param body Telegram widget auth data
   * @returns Login response with user data and access token
   */
  @TypedRoute.Post("telegram/widget")
  async loginWithTelegramWidget(
    @TypedBody() body: ITelegramWidgetAuth,
  ): Promise<ILoginResponse> {
    const validatedUser = this.telegramService.validateWidgetAuth(body);
    return this.authService.loginWithTelegramWidget(validatedUser);
  }

  /**
   * Login via Telegram Mini App
   *
   * Authenticates a user using initData from Telegram Mini App (TWA).
   * Creates a new user if not exists.
   *
   * @tag auth
   * @param body Telegram Mini App auth data
   * @returns Login response with user data and access token
   */
  @TypedRoute.Post("telegram/webapp")
  async loginWithTelegramMiniApp(
    @TypedBody() body: ITelegramWebAppAuth,
  ): Promise<ILoginResponse> {
    const validatedData = this.telegramService.validateWebAppInitData(
      body.initData,
    );
    return this.authService.loginWithTelegramMiniApp(validatedData);
  }

  /**
   * Logout user
   *
   * Logs out the user. Client should discard the JWT token.
   *
   * @tag auth
   * @security bearer
   * @returns Logout success status
   */
  @TypedRoute.Post("logout")
  @UseGuards(AuthGuard)
  async logout(): Promise<ILogoutResponse> {
    return { success: true };
  }

  /**
   * Get current user
   *
   * Returns the currently authenticated user based on JWT token.
   *
   * @tag auth
   * @security bearer
   * @returns Current user data
   */
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
    };
  }
}
