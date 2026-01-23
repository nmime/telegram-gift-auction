import { Controller, Req, UseGuards } from "@nestjs/common";
import { TypedRoute, TypedBody } from "@nestia/core";
import { UsersService } from "./users.service";
import { AuthGuard, AuthenticatedRequest } from "@/common";
import {
  IBalance,
  IBalanceResponse,
  ILanguageUpdate,
  ILanguageResponse,
} from "./dto";

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @TypedRoute.Get("balance")
  async getBalance(
    @Req() req: AuthenticatedRequest,
  ): Promise<IBalanceResponse> {
    return await this.usersService.getBalance(req.user.sub);
  }

  @TypedRoute.Post("deposit")
  async deposit(
    @Req() req: AuthenticatedRequest,
    @TypedBody() body: IBalance,
  ): Promise<IBalanceResponse> {
    const user = await this.usersService.deposit(req.user.sub, body.amount);
    return {
      balance: user.balance,
      frozenBalance: user.frozenBalance,
    };
  }

  @TypedRoute.Post("withdraw")
  async withdraw(
    @Req() req: AuthenticatedRequest,
    @TypedBody() body: IBalance,
  ): Promise<IBalanceResponse> {
    const user = await this.usersService.withdraw(req.user.sub, body.amount);
    return {
      balance: user.balance,
      frozenBalance: user.frozenBalance,
    };
  }

  @TypedRoute.Put("language")
  async updateLanguage(
    @Req() req: AuthenticatedRequest,
    @TypedBody() body: ILanguageUpdate,
  ): Promise<ILanguageResponse> {
    const languageCode = await this.usersService.updateLanguage(
      req.user.sub,
      body.language,
    );
    return { languageCode };
  }
}
