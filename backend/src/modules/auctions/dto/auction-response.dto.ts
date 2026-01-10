import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserBidResponseDto } from '@/modules/bids';

export class RoundConfigResponseDto {
  @ApiProperty({ example: 1 })
  roundNumber: number;

  @ApiProperty({ example: 5 })
  itemCount: number;

  @ApiProperty({ example: 60 })
  durationMinutes: number;
}

export class RoundStateResponseDto {
  @ApiProperty({ example: 1 })
  roundNumber: number;

  @ApiProperty({ example: 5 })
  itemCount: number;

  @ApiProperty({ enum: ['pending', 'active', 'completed'], example: 'active' })
  status: string;

  @ApiPropertyOptional({ type: Date, nullable: true })
  startTime?: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  endTime?: Date | null;

  @ApiProperty({ example: 0 })
  extensionCount: number;
}

export class AuctionResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({ example: 'Premium Gift Auction' })
  title: string;

  @ApiPropertyOptional({ example: 'Win exclusive Telegram gifts!' })
  description?: string;

  @ApiProperty({ example: 10 })
  totalItems: number;

  @ApiProperty({ type: [RoundConfigResponseDto] })
  roundsConfig: RoundConfigResponseDto[];

  @ApiProperty({ type: [RoundStateResponseDto] })
  rounds: RoundStateResponseDto[];

  @ApiProperty({ enum: ['pending', 'active', 'completed'], example: 'active' })
  status: string;

  @ApiProperty({ example: 1 })
  currentRound: number;

  @ApiProperty({ example: 100 })
  minBidAmount: number;

  @ApiProperty({ example: 10 })
  minBidIncrement: number;

  @ApiProperty({ example: 5 })
  antiSnipingWindowMinutes: number;

  @ApiProperty({ example: 2 })
  antiSnipingExtensionMinutes: number;

  @ApiProperty({ example: 3 })
  maxExtensions: number;

  @ApiProperty({ example: true })
  botsEnabled: boolean;

  @ApiProperty({ example: 5 })
  botCount: number;

  @ApiPropertyOptional({ type: Date, nullable: true })
  startTime?: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  endTime?: Date | null;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  createdAt: Date;
}

export class LeaderboardEntryDto {
  @ApiProperty({ example: 1 })
  rank: number;

  @ApiProperty({ example: 5000 })
  amount: number;

  @ApiProperty({ example: 'john_doe' })
  username: string;

  @ApiProperty({ example: false })
  isBot: boolean;

  @ApiProperty({ enum: ['active', 'won', 'lost', 'refunded'], example: 'active' })
  status: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 1 })
  itemNumber?: number | null;

  @ApiProperty({ example: true })
  isWinning: boolean;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  createdAt: Date;
}

export class MinWinningBidResponseDto {
  @ApiPropertyOptional({ type: Number, nullable: true, example: 550 })
  minWinningBid: number | null;
}

export class PlaceBidResponseDto {
  @ApiProperty({ type: UserBidResponseDto })
  bid: UserBidResponseDto;

  @ApiProperty({ type: AuctionResponseDto })
  auction: AuctionResponseDto;
}

export class AuditResponseDto {
  @ApiProperty({ example: true })
  isValid: boolean;

  @ApiProperty({ example: 50000 })
  totalBalance: number;

  @ApiProperty({ example: 5000 })
  totalFrozen: number;

  @ApiProperty({ example: 2000 })
  totalWinnings: number;

  @ApiProperty({ example: 0 })
  discrepancy: number;

  @ApiProperty({ example: 'All balances verified' })
  details: string;
}
