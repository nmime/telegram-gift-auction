import type { TransactionType } from "@/schemas";

export interface ITransactionResponse {
  id: string;
  type: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  frozenBefore?: number;
  frozenAfter?: number;
  auctionId?: string | null;
  description?: string | null;
  createdAt: Date;
}

export interface ITransactionQuery {
  limit?: number;
  offset?: number;
}
