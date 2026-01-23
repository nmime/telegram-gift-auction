import type { tags } from "typia";

export interface AuthPayload {
  token: string;
}

export interface PlaceBidPayload {
  auctionId: string;
  amount: number & tags.Minimum<1>;
}

export interface AuctionIdPayload {
  auctionId: string;
}

export interface AuthResponse {
  success: boolean;
  userId?: string;
  error?: string;
}

export interface BidResponse {
  success: boolean;
  amount?: number;
  previousAmount?: number;
  isNewBid?: boolean;
  error?: string;
  needsWarmup?: boolean;
}

export interface AuctionRoomResponse {
  success: boolean;
}

export interface NewBidEvent {
  auctionId: string;
  amount: number;
  timestamp: string;
  isIncrease: boolean;
}

interface RoundInfo {
  round: number;
  itemsCount: number;
  startTime?: string;
  endTime?: string;
  status: "pending" | "active" | "completed";
  antiSnipingExtensions: number;
}

export interface AuctionUpdateEvent {
  id: string;
  status: "pending" | "active" | "completed";
  currentRound: number;
  rounds: RoundInfo[];
}

export interface CountdownEvent {
  auctionId: string;
  roundNumber: number;
  timeLeftSeconds: number;
  roundEndTime: string;
  isUrgent: boolean;
  serverTime: string;
}

export interface AntiSnipingEvent {
  auctionId: string;
  roundNumber: number;
  newEndTime: string;
  extensionCount: number;
}

export interface RoundStartEvent {
  auctionId: string;
  roundNumber: number;
  itemsCount: number;
  startTime: string;
  endTime: string;
}

interface WinnerInfo {
  amount: number;
  itemNumber: number;
}

export interface RoundCompleteEvent {
  auctionId: string;
  roundNumber: number;
  winnersCount: number;
  winners: WinnerInfo[];
}

export interface AuctionCompleteEvent {
  auctionId: string;
  endTime: string;
  totalRounds: number;
}
