import { TransactionType } from "@/schemas";

/**
 * Transaction response
 */
export interface ITransactionResponse {
  /** Transaction ID */
  id: string;

  /** Transaction type */
  type: TransactionType;

  /** Transaction amount in Stars */
  amount: number;

  /** Balance before transaction */
  balanceBefore: number;

  /** Balance after transaction */
  balanceAfter: number;

  /** Frozen balance before transaction */
  frozenBefore?: number;

  /** Frozen balance after transaction */
  frozenAfter?: number;

  /** Related auction ID (if applicable) */
  auctionId?: string | null;

  /** Transaction description */
  description?: string | null;

  /** Transaction creation time */
  createdAt: Date;
}

/**
 * Transaction query parameters
 */
export interface ITransactionQuery {
  /**
   * Maximum number of transactions to return
   * @minimum 1
   * @maximum 100
   * @default 50
   */
  limit?: number;

  /**
   * Number of transactions to skip
   * @minimum 0
   * @default 0
   */
  offset?: number;
}
