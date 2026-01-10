import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AuctionsService } from './auctions.service';
import { BotService } from './bot.service';
import { AuthGuard, AuthenticatedRequest } from '@/common';
import {
  CreateAuctionDto,
  PlaceBidDto,
  AuctionResponseDto,
  LeaderboardEntryDto,
  MinWinningBidResponseDto,
  PlaceBidResponseDto,
  AuditResponseDto,
} from './dto';
import { UserBidResponseDto } from '@/modules/bids';
import { AuctionStatus, AuctionDocument } from '@/schemas';

@ApiTags('auctions')
@Controller('auctions')
export class AuctionsController {
  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly botService: BotService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List all auctions',
    description: 'Returns a list of all auctions, optionally filtered by status.',
  })
  @ApiQuery({ name: 'status', required: false, enum: AuctionStatus, description: 'Filter auctions by status' })
  @ApiResponse({ status: 200, description: 'List of auctions', type: [AuctionResponseDto] })
  async findAll(@Query('status') status?: AuctionStatus) {
    const auctions = await this.auctionsService.findAll(status);
    return auctions.map(a => this.formatAuction(a));
  }

  @Get('system/audit')
  @ApiOperation({
    summary: 'Financial audit',
    description: 'Verifies system-wide financial integrity. Checks that frozen balances match active bids and no money is lost or duplicated.',
  })
  @ApiResponse({ status: 200, description: 'Audit results', type: AuditResponseDto })
  async auditFinancialIntegrity() {
    return this.auctionsService.auditFinancialIntegrity();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get auction details',
    description: 'Returns detailed information about a specific auction including round states.',
  })
  @ApiParam({ name: 'id', description: 'Auction ID' })
  @ApiResponse({ status: 200, description: 'Auction details', type: AuctionResponseDto })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async findOne(@Param('id') id: string) {
    const auction = await this.auctionsService.findById(id);
    return this.formatAuction(auction);
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create new auction',
    description: 'Creates a new auction with the specified configuration. The sum of items across all rounds must equal totalItems.',
  })
  @ApiResponse({ status: 201, description: 'Auction created successfully', type: AuctionResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid configuration' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(@Body() dto: CreateAuctionDto, @Req() req: AuthenticatedRequest) {
    const auction = await this.auctionsService.create(dto, req.user.sub);
    return this.formatAuction(auction);
  }

  @Post(':id/start')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start auction',
    description: 'Starts a pending auction. The first round begins immediately.',
  })
  @ApiParam({ name: 'id', description: 'Auction ID' })
  @ApiResponse({ status: 200, description: 'Auction started', type: AuctionResponseDto })
  @ApiResponse({ status: 400, description: 'Auction cannot be started (wrong status)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async start(@Param('id') id: string) {
    const auction = await this.auctionsService.start(id);

    if (auction.botsEnabled) {
      await this.botService.startBots(auction._id.toString(), auction.botCount);
    }

    return this.formatAuction(auction);
  }

  @Post(':id/bid')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Place or increase bid',
    description: `Places a new bid or increases an existing bid on an active auction.

**Rules:**
- Minimum bid amount must be met
- If you have an existing bid, the new amount must be greater than your current bid by at least the minimum increment
- Only the difference between your current and new bid is deducted from your balance
- Bids within the anti-sniping window extend the round`,
  })
  @ApiParam({ name: 'id', description: 'Auction ID' })
  @ApiResponse({ status: 201, description: 'Bid placed successfully', type: PlaceBidResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid bid (too low, auction not active, insufficient balance)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async placeBid(
    @Param('id') id: string,
    @Body() dto: PlaceBidDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { bid, auction } = await this.auctionsService.placeBid(id, req.user.sub, dto);
    return {
      bid: {
        id: bid._id,
        amount: bid.amount,
        status: bid.status,
        createdAt: bid.createdAt,
        updatedAt: bid.updatedAt,
      },
      auction: this.formatAuction(auction),
    };
  }

  @Get(':id/leaderboard')
  @ApiOperation({
    summary: 'Get auction leaderboard',
    description: 'Returns the current ranking of all active bids, sorted by amount descending.',
  })
  @ApiParam({ name: 'id', description: 'Auction ID' })
  @ApiResponse({ status: 200, description: 'Leaderboard entries', type: [LeaderboardEntryDto] })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async getLeaderboard(@Param('id') id: string) {
    return this.auctionsService.getLeaderboard(id);
  }

  @Get(':id/my-bids')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get my bids',
    description: 'Returns all bids placed by the authenticated user in this auction.',
  })
  @ApiParam({ name: 'id', description: 'Auction ID' })
  @ApiResponse({ status: 200, description: 'List of user bids', type: [UserBidResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async getMyBids(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const bids = await this.auctionsService.getUserBids(id, req.user.sub);
    return bids.map(b => ({
      id: b._id,
      amount: b.amount,
      status: b.status,
      wonRound: b.wonRound,
      itemNumber: b.itemNumber,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));
  }

  @Get(':id/min-winning-bid')
  @ApiOperation({
    summary: 'Get minimum winning bid',
    description: 'Returns the minimum bid amount needed to be in a winning position for the current round.',
  })
  @ApiParam({ name: 'id', description: 'Auction ID' })
  @ApiResponse({ status: 200, description: 'Minimum winning bid amount', type: MinWinningBidResponseDto })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async getMinWinningBid(@Param('id') id: string) {
    const minBid = await this.auctionsService.getMinWinningBid(id);
    return { minWinningBid: minBid };
  }

  private formatAuction(auction: AuctionDocument) {
    return {
      id: auction._id,
      title: auction.title,
      description: auction.description,
      totalItems: auction.totalItems,
      roundsConfig: auction.roundsConfig,
      rounds: auction.rounds,
      status: auction.status,
      currentRound: auction.currentRound,
      minBidAmount: auction.minBidAmount,
      minBidIncrement: auction.minBidIncrement,
      antiSnipingWindowMinutes: auction.antiSnipingWindowMinutes,
      antiSnipingExtensionMinutes: auction.antiSnipingExtensionMinutes,
      maxExtensions: auction.maxExtensions,
      botsEnabled: auction.botsEnabled,
      botCount: auction.botCount,
      startTime: auction.startTime,
      endTime: auction.endTime,
      createdAt: auction.createdAt,
    };
  }
}
