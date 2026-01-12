/**
 * Balance response
 */
export interface IBalanceResponse {
  /** Available balance in Stars */
  balance: number;

  /** Balance frozen in active bids */
  frozenBalance: number;
}
