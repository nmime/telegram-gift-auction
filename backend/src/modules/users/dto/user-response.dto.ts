import { ApiProperty } from '@nestjs/swagger';

export class BalanceResponseDto {
  @ApiProperty({ description: 'Available balance', example: 5000 })
  balance: number;

  @ApiProperty({ description: 'Balance frozen in active bids', example: 500 })
  frozenBalance: number;
}
