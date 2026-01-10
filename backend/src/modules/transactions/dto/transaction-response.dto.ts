import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransactionResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({
    enum: ['deposit', 'withdraw', 'bid_freeze', 'bid_unfreeze', 'bid_win', 'bid_refund'],
    example: 'deposit',
  })
  type: string;

  @ApiProperty({ example: 1000 })
  amount: number;

  @ApiProperty({ example: 0 })
  balanceBefore: number;

  @ApiProperty({ example: 1000 })
  balanceAfter: number;

  @ApiProperty({ example: 0 })
  frozenBefore: number;

  @ApiProperty({ example: 0 })
  frozenAfter: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  auctionId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Initial deposit' })
  description?: string | null;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  createdAt: Date;
}
