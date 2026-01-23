import type { BidStatus } from "@/schemas";

export interface IAuctionSummary {
  id: string;
  title: string;
  status: string;
}

export interface IBidResponse {
  id: string;
  auctionId: string;
  auction?: IAuctionSummary | null;
  amount: number;
  status: BidStatus;
  wonRound?: number | null;
  itemNumber?: number | null;
  createdAt: Date;
}

export interface IUserBidResponse {
  id: string;
  amount: number;
  status: BidStatus;
  wonRound?: number | null;
  itemNumber?: number | null;
  createdAt: Date;
  updatedAt: Date;
}
