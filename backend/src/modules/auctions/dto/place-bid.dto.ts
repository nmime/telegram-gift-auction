import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlaceBidDto {
  @ApiProperty({
    description: 'Bid amount in Stars. Must be greater than or equal to the minimum bid amount, and greater than your current bid by at least the minimum increment.',
    minimum: 1,
    example: 500,
  })
  @IsNumber()
  @Min(1)
  amount: number;
}
