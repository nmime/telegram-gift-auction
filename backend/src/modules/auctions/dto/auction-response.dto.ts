import type { IUserBidResponse } from '@/modules/bids';
import { AuctionStatus, BidStatus } from '@/schemas';

/**
 * Round configuration in auction response
 */
export interface IRoundConfigResponse {
  /** Number of items in this round */
  itemsCount: number;

  /** Duration of the round in minutes */
  durationMinutes: number;
}

/**
 * Round state in auction response
 */
export interface IRoundStateResponse {
  /** Round number (1-based) */
  roundNumber: number;

  /** Number of items in this round */
  itemsCount: number;

  /** Round start time (null if not started) */
  startTime?: Date | null;

  /** Round end time (null if not completed) */
  endTime?: Date | null;

  /** Number of anti-sniping extensions applied */
  extensionsCount: number;

  /** Whether round is completed */
  completed: boolean;

  /** IDs of winning bids for this round */
  winnerBidIds: string[];
}

/**
 * Auction response DTO
 */
export interface IAuctionResponse {
  /** Auction ID */
  id: string;

  /** Auction title */
  title: string;

  /** Auction description */
  description?: string;

  /** Total number of items in the auction */
  totalItems: number;

  /** Configuration for each round */
  roundsConfig: IRoundConfigResponse[];

  /** State of each round */
  rounds: IRoundStateResponse[];

  /** Auction status */
  status: AuctionStatus;

  /** Current round number (1-based) */
  currentRound: number;

  /** Minimum bid amount in Stars */
  minBidAmount: number;

  /** Minimum increment for bid increases */
  minBidIncrement: number;

  /** Anti-sniping window in minutes */
  antiSnipingWindowMinutes: number;

  /** Anti-sniping extension duration in minutes */
  antiSnipingExtensionMinutes: number;

  /** Maximum anti-sniping extensions per round */
  maxExtensions: number;

  /** Whether bots are enabled */
  botsEnabled: boolean;

  /** Number of bots */
  botCount: number;

  /** Auction start time */
  startTime?: Date | null;

  /** Auction end time */
  endTime?: Date | null;

  /** Auction creation time */
  createdAt: Date;
}

/**
 * Leaderboard entry
 */
export interface ILeaderboardEntry {
  /** Rank in the leaderboard (1-based) */
  rank: number;

  /** Bid amount in Stars */
  amount: number;

  /** Username of the bidder */
  username: string;

  /** Whether the bidder is a bot */
  isBot: boolean;

  /** Bid status */
  status: BidStatus;

  /** Item number won (if applicable) */
  itemNumber?: number | null;

  /** Whether this bid is currently in a winning position */
  isWinning: boolean;

  /** Bid creation time */
  createdAt: Date;
}

/**
 * Minimum winning bid response
 */
export interface IMinWinningBidResponse {
  /** Minimum bid amount needed to be in a winning position (null if no winning bid threshold) */
  minWinningBid: number | null;
}

/**
 * Place bid response
 */
export interface IPlaceBidResponse {
  /** The placed bid */
  bid: IUserBidResponse;

  /** Updated auction state */
  auction: IAuctionResponse;
}

/**
 * Financial audit response
 */
export interface IAuditResponse {
  /** Whether the audit passed */
  isValid: boolean;

  /** Total balance across all users */
  totalBalance: number;

  /** Total frozen balance across all users */
  totalFrozen: number;

  /** Total winnings distributed */
  totalWinnings: number;

  /** Discrepancy amount (should be 0 if valid) */
  discrepancy: number;

  /** Audit details message */
  details: string;
}
