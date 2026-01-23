import { Controller, Req, UseGuards } from "@nestjs/common";
import { TypedRoute, TypedBody, TypedParam, TypedQuery } from "@nestia/core";
import { AuctionsService } from "./auctions.service";
import { BotService } from "./bot.service";
import { AuthGuard, AuthenticatedRequest } from "@/common";
import {
  ICreateAuction,
  IPlaceBid,
  IAuctionResponse,
  ILeaderboardResponse,
  IMinWinningBidResponse,
  IFastBidResponse,
  IAuditResponse,
} from "./dto";
import { IUserBidResponse } from "@/modules/bids";
import { AuctionStatus, AuctionDocument } from "@/schemas";

export interface IAuctionStatusQuery {
  status?: AuctionStatus;
}

export interface ILeaderboardQuery {
  limit?: number;
  offset?: number;
}

@Controller("auctions")
export class AuctionsController {
  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly botService: BotService,
  ) {}

  @TypedRoute.Get()
  async findAll(
    @TypedQuery() query: IAuctionStatusQuery,
  ): Promise<IAuctionResponse[]> {
    const auctions = await this.auctionsService.findAll(query.status);
    return auctions.map((a) => this.formatAuction(a));
  }

  @TypedRoute.Get("system/audit")
  async auditFinancialIntegrity(): Promise<IAuditResponse> {
    return await this.auctionsService.auditFinancialIntegrity();
  }

  @TypedRoute.Get(":id")
  async findOne(@TypedParam("id") id: string): Promise<IAuctionResponse> {
    const auction = await this.auctionsService.findById(id);
    return this.formatAuction(auction);
  }

  @TypedRoute.Post()
  @UseGuards(AuthGuard)
  async create(
    @TypedBody() body: ICreateAuction,
    @Req() req: AuthenticatedRequest,
  ): Promise<IAuctionResponse> {
    const auction = await this.auctionsService.create(body, req.user.sub);
    return this.formatAuction(auction);
  }

  @TypedRoute.Post(":id/start")
  @UseGuards(AuthGuard)
  async start(@TypedParam("id") id: string): Promise<IAuctionResponse> {
    const auction = await this.auctionsService.start(id);

    if (auction.botsEnabled) {
      await this.botService.startBots(auction._id.toString(), auction.botCount);
    }

    return this.formatAuction(auction);
  }

  @TypedRoute.Post(":id/bid")
  @UseGuards(AuthGuard)
  async placeBid(
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
        winnerBidIds: r.winnerBidIds.map((id): string => id.toString()),
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
