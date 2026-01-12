/**
 * Round configuration for auction creation
 */
export interface IRoundConfig {
  /**
   * Number of items to be distributed in this round
   * @minimum 1
   */
  itemsCount: number;

  /**
   * Duration of the round in minutes
   * @minimum 1
   */
  durationMinutes: number;
}

/**
 * Create auction request DTO
 */
export interface ICreateAuction {
  /** Title of the auction */
  title: string;

  /** Optional description of the auction */
  description?: string;

  /**
   * Total number of items available in the auction
   * @minimum 1
   */
  totalItems: number;

  /**
   * Configuration for each round (minimum 1 round required)
   */
  rounds: IRoundConfig[];

  /**
   * Minimum bid amount in Stars
   * @minimum 1
   * @default 100
   */
  minBidAmount?: number;

  /**
   * Minimum increment for bid increases
   * @minimum 1
   * @default 10
   */
  minBidIncrement?: number;

  /**
   * Time window before round end that triggers anti-sniping (in minutes)
   * @minimum 1
   * @default 2
   */
  antiSnipingWindowMinutes?: number;

  /**
   * Duration to extend round when anti-sniping triggers (in minutes)
   * @minimum 1
   * @default 2
   */
  antiSnipingExtensionMinutes?: number;

  /**
   * Maximum number of anti-sniping extensions per round
   * @minimum 0
   * @default 6
   */
  maxExtensions?: number;

  /**
   * Enable automated bots for live auction demonstration
   * @default false
   */
  botsEnabled?: boolean;

  /**
   * Number of bots to simulate (only if botsEnabled is true)
   * @minimum 0
   * @default 5
   */
  botCount?: number;
}
