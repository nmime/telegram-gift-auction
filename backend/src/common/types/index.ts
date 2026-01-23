import type { FastifyRequest } from "fastify";
import type { Types } from "mongoose";

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    sub: string;
    username: string;
  };
}

export interface PopulatedUser {
  _id: Types.ObjectId;
  username: string;
  isBot: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  amount: number;
  username: string;
  isBot: boolean;
  isWinning: boolean;
  createdAt: Date;
}

export interface PastWinnerEntry {
  round: number;
  itemNumber: number;
  amount: number;
  username: string;
  isBot: boolean;
  createdAt: Date;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  totalCount: number;
  pastWinners: PastWinnerEntry[];
}

export function isPopulatedUser(
  field: Types.ObjectId | PopulatedUser | null | undefined,
): field is PopulatedUser {
  return (
    typeof field === "object" &&
    field !== null &&
    "username" in field &&
    typeof field.username === "string"
  );
}
