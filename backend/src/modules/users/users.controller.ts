import { Controller, Req, UseGuards } from "@nestjs/common";
import { TypedRoute, TypedBody } from "@nestia/core";
import { UsersService } from "./users.service";
import { AuthGuard, AuthenticatedRequest } from "@/common";
import { IBalance, IBalanceResponse } from "./dto";

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Get user balance
   *
   * Returns the current available and frozen balance for the authenticated user.
   *
   * @tag users
   * @security bearer
   * @returns User balance information
   */
  @TypedRoute.Get("balance")
  async getBalance(
    @Req() req: AuthenticatedRequest,
  ): Promise<IBalanceResponse> {
    return this.usersService.getBalance(req.user.sub);
  }

  /**
   * Deposit funds
   *
   * Adds the specified amount to the user's available balance.
   *
   * @tag users
   * @security bearer
   * @param body Deposit amount
   * @returns Updated balance
   */
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

  /**
   * Withdraw funds
   *
   * Removes the specified amount from the user's available balance.
   *
   * @tag users
   * @security bearer
   * @param body Withdrawal amount
   * @returns Updated balance
   */
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
}
