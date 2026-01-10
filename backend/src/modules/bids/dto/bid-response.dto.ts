import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuctionSummaryDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439012' })
  id: string;

  @ApiProperty({ example: 'Premium Gift Auction' })
  title: string;

  @ApiProperty({ example: 'active' })
  status: string;
}

export class BidResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439012' })
  auctionId: string;

  @ApiPropertyOptional({ type: AuctionSummaryDto, nullable: true })
  auction?: AuctionSummaryDto | null;

  @ApiProperty({ example: 500 })
  amount: number;

  @ApiProperty({ enum: ['active', 'won', 'lost', 'refunded'], example: 'active' })
  status: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  wonRound?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  itemNumber?: number | null;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  createdAt: Date;
}

export class UserBidResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({ example: 500 })
  amount: number;

  @ApiProperty({ enum: ['active', 'won', 'lost', 'refunded'], example: 'active' })
  status: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  wonRound?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  itemNumber?: number | null;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  updatedAt: Date;
}
