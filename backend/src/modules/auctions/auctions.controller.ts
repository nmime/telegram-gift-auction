import { Controller, Req, UseGuards } from "@nestjs/common";
import { TypedRoute, TypedBody, TypedParam, TypedQuery } from "@nestia/core";
import { FastifyRequest } from "fastify";
import { AuctionsService } from "./auctions.service";
import { BotService } from "./bot.service";
import { AuthGuard, AuthenticatedRequest, getClientIp } from "@/common";
import {
  ICreateAuction,
  IPlaceBid,
  IAuctionResponse,
  ILeaderboardResponse,
  IMinWinningBidResponse,
  IPlaceBidResponse,
  IFastBidResponse,
  IAuditResponse,
} from "./dto";
import { IUserBidResponse } from "@/modules/bids";
import { AuctionStatus, AuctionDocument } from "@/schemas";

/**
 * Auction status query parameter
 */
export interface IAuctionStatusQuery {
  /** Filter auctions by status */
  status?: AuctionStatus;
}

/**
 * Leaderboard pagination query parameters
 */
export interface ILeaderboardQuery {
  /** Maximum number of entries to return (default: 50) */
  limit?: number;

  /** Number of entries to skip (default: 0) */
  offset?: number;
}

@Controller("auctions")
export class AuctionsController {
  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly botService: BotService,
  ) {}

  /**
   * List all auctions
   *
   * Returns a list of all auctions, optionally filtered by status.
   *
   * @tag auctions
   * @param query Query parameters for filtering
   * @returns List of auctions
   */
  @TypedRoute.Get()
  async findAll(
    @TypedQuery() query: IAuctionStatusQuery,
  ): Promise<IAuctionResponse[]> {
    const auctions = await this.auctionsService.findAll(query.status);
    return auctions.map((a) => this.formatAuction(a));
  }

  /**
   * Financial audit
   *
   * Verifies system-wide financial integrity. Checks that frozen balances
   * match active bids and no money is lost or duplicated.
   *
   * @tag auctions
   * @returns Audit results
   */
  @TypedRoute.Get("system/audit")
  async auditFinancialIntegrity(): Promise<IAuditResponse> {
    return this.auctionsService.auditFinancialIntegrity();
  }

  /**
   * Get auction details
   *
   * Returns detailed information about a specific auction including round states.
   *
   * @tag auctions
   * @param id Auction ID
   * @returns Auction details
   */
  @TypedRoute.Get(":id")
  async findOne(@TypedParam("id") id: string): Promise<IAuctionResponse> {
    const auction = await this.auctionsService.findById(id);
    return this.formatAuction(auction);
  }

  /**
   * Create new auction
   *
   * Creates a new auction with the specified configuration.
   * The sum of items across all rounds must equal totalItems.
   *
   * @tag auctions
   * @security bearer
   * @param body Auction configuration
   * @returns Created auction
   */
  @TypedRoute.Post()
  @UseGuards(AuthGuard)
  async create(
    @TypedBody() body: ICreateAuction,
    @Req() req: AuthenticatedRequest,
  ): Promise<IAuctionResponse> {
    const auction = await this.auctionsService.create(body, req.user.sub);
    return this.formatAuction(auction);
  }

  /**
   * Start auction
   *
   * Starts a pending auction. The first round begins immediately.
   *
   * @tag auctions
   * @security bearer
   * @param id Auction ID
   * @returns Started auction
   */
  @TypedRoute.Post(":id/start")
  @UseGuards(AuthGuard)
  async start(@TypedParam("id") id: string): Promise<IAuctionResponse> {
    const auction = await this.auctionsService.start(id);

    if (auction.botsEnabled) {
      await this.botService.startBots(auction._id.toString(), auction.botCount);
    }

    return this.formatAuction(auction);
  }

  /**
   * Place or increase bid
   *
   * Places a new bid or increases an existing bid on an active auction.
   *
   * **Rules:**
   * - Minimum bid amount must be met
   * - If you have an existing bid, the new amount must be greater than your current bid by at least the minimum increment
   * - Only the difference between your current and new bid is deducted from your balance
   * - Bids within the anti-sniping window extend the round
   *
   * @tag auctions
   * @security bearer
   * @param id Auction ID
   * @param body Bid amount
   * @returns Placed bid and updated auction
   */
  @TypedRoute.Post(":id/bid")
  @UseGuards(AuthGuard)
  async placeBid(
    @TypedParam("id") id: string,
    @TypedBody() body: IPlaceBid,
    @Req() req: AuthenticatedRequest,
  ): Promise<IPlaceBidResponse> {
    const clientIp = getClientIp(req as unknown as FastifyRequest);
    const { bid, auction } = await this.auctionsService.placeBid(
      id,
      req.user.sub,
      body,
      clientIp,
    );
    return {
      bid: {
        id: bid._id.toString(),
        amount: bid.amount,
        status: bid.status,
        createdAt: bid.createdAt,
        updatedAt: bid.updatedAt,
      },
      auction: this.formatAuction(auction),
    };
  }

  /**
   * Place fast bid (high-performance Redis path)
   *
   * Places a bid using the Redis-cached fast path for maximum throughput.
   * Returns a simplified response without full auction state.
   * Falls back to standard bid if cache is not warmed.
   *
   * @tag auctions
   * @security bearer
   * @param id Auction ID
   * @param body Bid amount
   * @returns Fast bid result with rank
   */
  @TypedRoute.Post(":id/fast-bid")
  @UseGuards(AuthGuard)
  async placeFastBid(
    @TypedParam("id") id: string,
    @TypedBody() body: IPlaceBid,
    @Req() req: AuthenticatedRequest,
  ): Promise<IFastBidResponse> {
    const result = await this.auctionsService.placeBidFast(
      id,
      req.user.sub,
      body,
    );
    return {
      success: result.success,
      amount: result.amount,
      previousAmount: result.previousAmount,
      rank: result.rank,
      isNewBid: result.isNewBid,
      error: result.error,
    };
  }

  /**
   * Get auction leaderboard
   *
   * Returns the current ranking of active bids in current round and past winners.
   *
   * @tag auctions
   * @param id Auction ID
   * @param query Pagination parameters
   * @returns Leaderboard with pagination and past winners
   */
  @TypedRoute.Get(":id/leaderboard")
  async getLeaderboard(
    @TypedParam("id") id: string,
    @TypedQuery() query: ILeaderboardQuery,
  ): Promise<ILeaderboardResponse> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const result = await this.auctionsService.getLeaderboard(id, limit, offset);
    return {
      leaderboard: result.leaderboard.map((entry) => ({
        rank: entry.rank,
        amount: entry.amount,
        username: entry.username,
        isBot: entry.isBot,
        isWinning: entry.isWinning,
        createdAt: entry.createdAt,
      })),
      totalCount: result.totalCount,
      pastWinners: result.pastWinners.map((winner) => ({
        round: winner.round,
        itemNumber: winner.itemNumber,
        amount: winner.amount,
        username: winner.username,
        isBot: winner.isBot,
        createdAt: winner.createdAt,
      })),
    };
  }

  /**
   * Get my bids
   *
   * Returns all bids placed by the authenticated user in this auction.
   *
   * @tag auctions
   * @security bearer
   * @param id Auction ID
   * @returns List of user bids
   */
  @TypedRoute.Get(":id/my-bids")
  @UseGuards(AuthGuard)
  async getMyBids(
    @TypedParam("id") id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<IUserBidResponse[]> {
    const bids = await this.auctionsService.getUserBids(id, req.user.sub);
    return bids.map((b) => ({
      id: b._id.toString(),
      amount: b.amount,
      status: b.status,
      wonRound: b.wonRound,
      itemNumber: b.itemNumber,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));
  }

  /**
   * Get minimum winning bid
   *
   * Returns the minimum bid amount needed to be in a winning position for the current round.
   *
   * @tag auctions
   * @param id Auction ID
   * @returns Minimum winning bid amount
   */
  @TypedRoute.Get(":id/min-winning-bid")
  async getMinWinningBid(
    @TypedParam("id") id: string,
  ): Promise<IMinWinningBidResponse> {
    const minBid = await this.auctionsService.getMinWinningBid(id);
    return { minWinningBid: minBid };
  }

  private formatAuction(auction: AuctionDocument): IAuctionResponse {
    return {
      id: auction._id.toString(),
      title: auction.title,
      description: auction.description,
      totalItems: auction.totalItems,
      roundsConfig: auction.roundsConfig,
      rounds: auction.rounds.map((r) => ({
        roundNumber: r.roundNumber,
        itemsCount: r.itemsCount,
        startTime: r.startTime,
        endTime: r.endTime,
        extensionsCount: r.extensionsCount,
        completed: r.completed,
        winnerBidIds: r.winnerBidIds?.map((id) => id.toString()) || [],
      })),
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
