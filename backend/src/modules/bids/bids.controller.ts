import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BidsService } from './bids.service';
import { AuthGuard, AuthenticatedRequest } from '@/common';
import { BidResponseDto } from './dto';

@ApiTags('bids')
@ApiBearerAuth()
@Controller('bids')
@UseGuards(AuthGuard)
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Get('my')
  @ApiOperation({
    summary: 'Get all my bids',
    description: 'Returns all bids placed by the authenticated user across all auctions.',
  })
  @ApiResponse({ status: 200, description: 'List of user bids', type: [BidResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyBids(@Req() req: AuthenticatedRequest) {
    const bids = await this.bidsService.getByUser(req.user.sub);
    return bids.map(b => ({
      id: b._id,
      auctionId: b.auctionId,
      auction: (b.auctionId as any)?.title ? {
        id: (b.auctionId as any)._id,
        title: (b.auctionId as any).title,
        status: (b.auctionId as any).status,
      } : null,
      amount: b.amount,
      status: b.status,
      wonRound: b.wonRound,
      itemNumber: b.itemNumber,
      createdAt: b.createdAt,
    }));
  }
}
