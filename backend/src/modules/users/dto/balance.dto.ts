import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BalanceDto {
  @ApiProperty({
    description: 'Amount in Stars to deposit or withdraw',
    minimum: 1,
    example: 1000,
  })
  @IsNumber()
  @Min(1)
  amount: number;
}
