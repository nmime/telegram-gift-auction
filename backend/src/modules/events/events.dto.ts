/**
 * WebSocket Event DTOs for AsyncAPI documentation
 * Schemas are generated automatically via typia (same as Nestia)
 */
import { tags } from "typia";

// ============================================
// Client → Server Events (Subscribe)
// ============================================

/**
 * JWT token for socket authentication
 */
export interface AuthPayload {
  /**
   * JWT Bearer token obtained from /api/auth/telegram endpoint
   * @example "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   */
  token: string;
}

/**
 * Payload for placing or increasing a bid via WebSocket
 */
export interface PlaceBidPayload {
  /**
   * MongoDB ObjectId of the auction
   * @example "507f1f77bcf86cd799439011"
   */
  auctionId: string;

  /**
   * Bid amount in coins (must be positive integer)
   * @example 1000
   */
  amount: number & tags.Minimum<1>;
}

/**
 * Auction ID for joining/leaving auction room
 */
export interface AuctionIdPayload {
  /**
   * MongoDB ObjectId of the auction to join/leave
   * @example "507f1f77bcf86cd799439011"
   */
  auctionId: string;
}

// ============================================
// Server → Client Events (Publish)
// ============================================

/**
 * Response to 'auth' event
 */
export interface AuthResponse {
  /** Whether authentication was successful */
  success: boolean;
  /**
   * User ID (MongoDB ObjectId) if successful
   * @example "507f1f77bcf86cd799439011"
   */
  userId?: string;
  /**
   * Error message if authentication failed
   * @example "Invalid or expired token"
   */
  error?: string;
}

/**
 * Response to 'place-bid' event
 */
export interface BidResponse {
  /** Whether the bid was placed successfully */
  success: boolean;
  /**
   * The new bid amount (if successful)
   * @example 1500
   */
  amount?: number;
  /**
   * Previous bid amount (0 if new bid)
   * @example 1000
   */
  previousAmount?: number;
  /** True if this is a new bid, false if increase */
  isNewBid?: boolean;
  /**
   * Error message if bid failed
   * @example "Insufficient balance"
   */
  error?: string;
  /** True if auction cache needs warmup (fallback to HTTP required) */
  needsWarmup?: boolean;
}

/**
 * Response to 'join-auction' and 'leave-auction' events
 */
export interface AuctionRoomResponse {
  /** Whether the operation was successful */
  success: boolean;
}

/**
 * Broadcast when a new bid is placed in an auction
 */
export interface NewBidEvent {
  /**
   * Auction ID where the bid was placed
   * @example "507f1f77bcf86cd799439011"
   */
  auctionId: string;
  /**
   * The bid amount
   * @example 1500
   */
  amount: number;
  /**
   * When the bid was placed (ISO 8601)
   * @example "2024-01-15T10:30:00.000Z"
   */
  timestamp: string;
  /** True if this was a bid increase, false if new bid */
  isIncrease: boolean;
}

/**
 * Round information within auction
 */
export interface RoundInfo {
  /** Round number (1-indexed) */
  round: number;
  /** Number of items/winners in this round */
  itemsCount: number;
  /**
   * Round start time (ISO 8601)
   * @example "2024-01-15T10:30:00.000Z"
   */
  startTime?: string;
  /**
   * Round end time (ISO 8601)
   * @example "2024-01-15T10:35:00.000Z"
   */
  endTime?: string;
  /** Round status */
  status: "pending" | "active" | "completed";
  /** Number of anti-sniping extensions applied */
  antiSnipingExtensions: number;
}

/**
 * Auction state change notification
 */
export interface AuctionUpdateEvent {
  /**
   * Auction ID
   * @example "507f1f77bcf86cd799439011"
   */
  id: string;
  /** Current auction status */
  status: "pending" | "active" | "completed";
  /** Current round number (1-indexed) */
  currentRound: number;
  /** Array of all rounds with their status and timing */
  rounds: RoundInfo[];
}

/**
 * Server-side countdown tick (broadcast every second)
 */
export interface CountdownEvent {
  /**
   * Auction ID
   * @example "507f1f77bcf86cd799439011"
   */
  auctionId: string;
  /** Current round number */
  roundNumber: number;
  /** Seconds remaining until round ends */
  timeLeftSeconds: number;
  /**
   * ISO timestamp when round ends
   * @example "2024-01-15T10:35:00.000Z"
   */
  roundEndTime: string;
  /** True if less than 30 seconds remaining */
  isUrgent: boolean;
  /**
   * Current server time (for clock sync)
   * @example "2024-01-15T10:34:15.000Z"
   */
  serverTime: string;
}

/**
 * Anti-sniping extension notification
 */
export interface AntiSnipingEvent {
  /**
   * Auction ID
   * @example "507f1f77bcf86cd799439011"
   */
  auctionId: string;
  /** Round number that was extended */
  roundNumber: number;
  /**
   * New end time after extension (ISO 8601)
   * @example "2024-01-15T10:36:00.000Z"
   */
  newEndTime: string;
  /** Total number of extensions applied to this round */
  extensionCount: number;
}

/**
 * Round start notification
 */
export interface RoundStartEvent {
  /**
   * Auction ID
   * @example "507f1f77bcf86cd799439011"
   */
  auctionId: string;
  /** Round number that started */
  roundNumber: number;
  /** Number of items/winners in this round */
  itemsCount: number;
  /**
   * Round start time (ISO 8601)
   * @example "2024-01-15T10:30:00.000Z"
   */
  startTime: string;
  /**
   * Round end time (ISO 8601)
   * @example "2024-01-15T10:35:00.000Z"
   */
  endTime: string;
}

/**
 * Winner information in round complete event
 */
export interface WinnerInfo {
  /** Winning bid amount */
  amount: number;
  /** Item number won (1-indexed) */
  itemNumber: number;
}

/**
 * Round completion notification with winners
 */
export interface RoundCompleteEvent {
  /**
   * Auction ID
   * @example "507f1f77bcf86cd799439011"
   */
  auctionId: string;
  /** Round number that completed */
  roundNumber: number;
  /** Number of winners in this round */
  winnersCount: number;
  /** List of winning bids */
  winners: WinnerInfo[];
}

/**
 * Auction completion notification
 */
export interface AuctionCompleteEvent {
  /**
   * Auction ID
   * @example "507f1f77bcf86cd799439011"
   */
  auctionId: string;
  /**
   * When the auction ended (ISO 8601)
   * @example "2024-01-15T11:00:00.000Z"
   */
  endTime: string;
  /** Total number of rounds in the auction */
  totalRounds: number;
}
