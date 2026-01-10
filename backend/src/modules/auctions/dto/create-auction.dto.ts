import { IsString, IsNumber, IsArray, IsOptional, IsBoolean, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoundConfigDto {
  @ApiProperty({
    description: 'Number of items to be distributed in this round',
    minimum: 1,
    example: 5,
  })
  @IsNumber()
  @Min(1)
  itemsCount: number;

  @ApiProperty({
    description: 'Duration of the round in minutes',
    minimum: 1,
    example: 5,
  })
  @IsNumber()
  @Min(1)
  durationMinutes: number;
}

export class CreateAuctionDto {
  @ApiProperty({
    description: 'Title of the auction',
    example: 'Exclusive Gift Auction',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    description: 'Optional description of the auction',
    example: 'Limited edition digital collectibles',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Total number of items available in the auction',
    minimum: 1,
    example: 10,
  })
  @IsNumber()
  @Min(1)
  totalItems: number;

  @ApiProperty({
    description: 'Configuration for each round',
    type: [RoundConfigDto],
    example: [
      { itemsCount: 5, durationMinutes: 5 },
      { itemsCount: 5, durationMinutes: 5 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoundConfigDto)
  rounds: RoundConfigDto[];

  @ApiPropertyOptional({
    description: 'Minimum bid amount in Stars',
    minimum: 1,
    default: 100,
    example: 100,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  minBidAmount?: number;

  @ApiPropertyOptional({
    description: 'Minimum increment for bid increases',
    minimum: 1,
    default: 10,
    example: 10,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  minBidIncrement?: number;

  @ApiPropertyOptional({
    description: 'Time window before round end that triggers anti-sniping (in minutes)',
    minimum: 1,
    default: 2,
    example: 2,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  antiSnipingWindowMinutes?: number;

  @ApiPropertyOptional({
    description: 'Duration to extend round when anti-sniping triggers (in minutes)',
    minimum: 1,
    default: 2,
    example: 2,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  antiSnipingExtensionMinutes?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of anti-sniping extensions per round',
    minimum: 0,
    default: 6,
    example: 6,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxExtensions?: number;

  @ApiPropertyOptional({
    description: 'Enable automated bots for live auction demonstration',
    default: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  botsEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Number of bots to simulate (only if botsEnabled is true)',
    minimum: 0,
    default: 5,
    example: 5,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  botCount?: number;
}
