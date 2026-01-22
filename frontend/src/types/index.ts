export interface User {
  id: string;
  username: string;
  balance: number;
  frozenBalance: number;
  isBot?: boolean;
  telegramId?: number;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  languageCode?: string;
}

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
  auth_date: number;
  hash: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
}

export interface BalanceInfo {
  balance: number;
  frozenBalance: number;
}

export interface RoundConfig {
  itemsCount: number;
  durationMinutes: number;
}

export interface RoundState {
  roundNumber: number;
  itemsCount: number;
  startTime?: string;
  endTime?: string;
  actualEndTime?: string;
  extensionsCount: number;
  completed: boolean;
  winnerBidIds: string[];
}

export enum AuctionStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export interface Auction {
  id: string;
  title: string;
  description?: string;
  totalItems: number;
  roundsConfig: RoundConfig[];
  rounds: RoundState[];
  status: AuctionStatus;
  currentRound: number;
  minBidAmount: number;
  minBidIncrement: number;
  antiSnipingWindowMinutes: number;
  antiSnipingExtensionMinutes: number;
  maxExtensions: number;
  botsEnabled: boolean;
  botCount: number;
  startTime?: string;
  endTime?: string;
  createdAt: string;
}

export interface CreateAuctionData {
  title: string;
  description?: string;
  totalItems: number;
  rounds: RoundConfig[];
  minBidAmount?: number;
  minBidIncrement?: number;
  antiSnipingWindowMinutes?: number;
  antiSnipingExtensionMinutes?: number;
  maxExtensions?: number;
  botsEnabled?: boolean;
  botCount?: number;
}

export enum BidStatus {
  ACTIVE = 'active',
  WON = 'won',
  LOST = 'lost',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
}

export interface Bid {
  id: string;
  auctionId: string;
  amount: number;
  status: BidStatus;
  wonRound?: number;
  itemNumber?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface PlaceBidResponse {
  bid: Bid;
  auction: Auction;
}

export interface LeaderboardEntry {
  rank: number;
  amount: number;
  username: string;
  isBot: boolean;
  isWinning: boolean;
  createdAt: string;
}

export interface PastWinnerEntry {
  round: number;
  itemNumber: number;
  amount: number;
  username: string;
  isBot: boolean;
  createdAt: string;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  totalCount: number;
  pastWinners: PastWinnerEntry[];
}

export interface MinWinningBidResponse {
  minWinningBid: number | null;
}

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  BID_FREEZE = 'bid_freeze',
  BID_UNFREEZE = 'bid_unfreeze',
  BID_WIN = 'bid_win',
  BID_REFUND = 'bid_refund',
}

export interface Transaction {
  id: string;
  type: TransactionType | string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  frozenBefore?: number;
  frozenAfter?: number;
  auctionId?: string;
  bidId?: string;
  description?: string;
  createdAt: string;
}

export interface AuctionUpdateEvent {
  id: string;
  status: AuctionStatus;
  currentRound: number;
  rounds: RoundState[];
}

export interface NewBidEvent {
  auctionId: string;
  amount: number;
  timestamp: string;
  isIncrease: boolean;
}

export interface AntiSnipingEvent {
  auctionId: string;
  roundNumber: number;
  newEndTime: string;
  extensionCount: number;
}

export interface RoundCompleteEvent {
  auctionId: string;
  roundNumber: number;
  winnersCount: number;
  winners: {
    amount: number;
    itemNumber: number;
  }[];
}

export interface AuctionCompleteEvent {
  auctionId: string;
  endTime: string;
  totalRounds: number;
}

export interface RoundStartEvent {
  auctionId: string;
  roundNumber: number;
  itemsCount: number;
  startTime: string;
  endTime: string;
}

export interface SocketEventMap {
  'auction-update': AuctionUpdateEvent;
  'new-bid': NewBidEvent;
  'anti-sniping': AntiSnipingEvent;
  'round-complete': RoundCompleteEvent;
  'auction-complete': AuctionCompleteEvent;
  'round-start': RoundStartEvent;
}

export type SocketEventName = keyof SocketEventMap;

export interface ApiError {
  message: string;
  statusCode?: number;
  error?: string;
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
