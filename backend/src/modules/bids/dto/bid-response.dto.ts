import { BidStatus } from '@/schemas';

/**
 * Auction summary in bid response
 */
export interface IAuctionSummary {
  /** Auction ID */
  id: string;

  /** Auction title */
  title: string;

  /** Auction status */
  status: string;
}

/**
 * Bid response with auction info
 */
export interface IBidResponse {
  /** Bid ID */
  id: string;

  /** Auction ID */
  auctionId: string;

  /** Auction summary (if populated) */
  auction?: IAuctionSummary | null;

  /** Bid amount in Stars */
  amount: number;

  /** Bid status */
  status: BidStatus;

  /** Round number won (if applicable) */
  wonRound?: number | null;

  /** Item number won (if applicable) */
  itemNumber?: number | null;

  /** Bid creation time */
  createdAt: Date;
}

/**
 * User's bid response (without auction details)
 */
export interface IUserBidResponse {
  /** Bid ID */
  id: string;

  /** Bid amount in Stars */
  amount: number;

  /** Bid status */
  status: BidStatus;

  /** Round number won (if applicable) */
  wonRound?: number | null;

  /** Item number won (if applicable) */
  itemNumber?: number | null;

  /** Bid creation time */
  createdAt: Date;

  /** Bid last update time */
  updatedAt: Date;
}
