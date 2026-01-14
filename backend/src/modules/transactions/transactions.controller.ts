import { Controller, Req, UseGuards } from "@nestjs/common";
import { TypedRoute, TypedQuery } from "@nestia/core";
import { TransactionsService } from "./transactions.service";
import { AuthGuard, AuthenticatedRequest } from "@/common";
import { ITransactionResponse, ITransactionQuery } from "./dto";

@Controller("transactions")
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  /**
   * Get transaction history
   *
   * Returns a paginated list of transactions for the authenticated user,
   * ordered by most recent first.
   *
   * @tag transactions
   * @security bearer
   * @param query Pagination parameters
   * @returns List of transactions
   */
  @TypedRoute.Get()
  async getTransactions(
    @Req() req: AuthenticatedRequest,
    @TypedQuery() query: ITransactionQuery,
  ): Promise<ITransactionResponse[]> {
    const transactions = await this.transactionsService.getByUser(
      req.user.sub,
      query.limit ?? 50,
      query.offset ?? 0,
    );

    return transactions.map((t) => ({
      id: t._id.toString(),
      type: t.type,
      amount: t.amount,
      balanceBefore: t.balanceBefore,
      balanceAfter: t.balanceAfter,
      frozenBefore: t.frozenBefore,
      frozenAfter: t.frozenAfter,
      auctionId: t.auctionId?.toString() ?? null,
      description: t.description,
      createdAt: t.createdAt,
    }));
  }
}
