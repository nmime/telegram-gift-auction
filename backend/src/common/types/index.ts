import type { FastifyRequest } from "fastify";
import type { Types } from "mongoose";

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    sub: string;
    username: string;
  };
}

/**
 * User fields returned when populating userId on Bid documents
 */
export interface PopulatedUser {
  _id: Types.ObjectId;
  username: string;
  isBot: boolean;
}

/**
 * Leaderboard entry returned from getLeaderboard (active bid in current round)
 */
export interface LeaderboardEntry {
  rank: number;
  amount: number;
  username: string;
  isBot: boolean;
  isWinning: boolean;
  createdAt: Date;
}

/**
 * Past round winner entry
 */
export interface PastWinnerEntry {
  round: number;
  itemNumber: number;
  amount: number;
  username: string;
  isBot: boolean;
  createdAt: Date;
}

/**
 * Leaderboard response with pagination
 */
export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  totalCount: number;
  pastWinners: PastWinnerEntry[];
}

/**
 * Type guard to check if a populated field is a PopulatedUser
 */
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
