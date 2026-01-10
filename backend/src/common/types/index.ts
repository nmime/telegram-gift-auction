import { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { BidStatus } from '@/schemas';

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
 * Leaderboard entry returned from getLeaderboard
 */
export interface LeaderboardEntry {
  rank: number;
  amount: number;
  username: string;
  isBot: boolean;
  status: BidStatus;
  itemNumber?: number;
  isWinning: boolean;
  createdAt: Date;
}

/**
 * Type guard to check if a populated field is a PopulatedUser
 */
export function isPopulatedUser(
  field: Types.ObjectId | PopulatedUser | unknown
): field is PopulatedUser {
  return (
    typeof field === 'object' &&
    field !== null &&
    'username' in field &&
    typeof (field as PopulatedUser).username === 'string'
  );
}
