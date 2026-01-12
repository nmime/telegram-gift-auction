/**
 * Balance operation request (deposit/withdraw)
 */
export interface IBalance {
  /**
   * Amount in Stars to deposit or withdraw
   * @minimum 1
   */
  amount: number;
}
