/**
 * Place bid request DTO
 */
export interface IPlaceBid {
  /**
   * Bid amount in Stars. Must be greater than or equal to the minimum bid amount,
   * and greater than your current bid by at least the minimum increment.
   * @minimum 1
   */
  amount: number;
}
