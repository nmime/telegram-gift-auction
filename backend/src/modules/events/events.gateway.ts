import { Inject, Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type Redis from "ioredis";
import { AsyncApi, AsyncApiPub, AsyncApiSub } from "@nmime/nestjs-asyncapi";
import type { AuctionDocument, BidDocument } from "@/schemas";
import { redisClient, BidCacheService } from "@/modules/redis";
import type { PlaceBidPayload } from "./events.dto";
import {
  AuthPayload,
  AuthResponse,
  PlaceBidPayload as PlaceBidPayloadStub,
  BidResponse,
  AuctionIdPayload,
  AuctionRoomResponse,
  NewBidEvent,
  AuctionUpdateEvent,
  CountdownEvent,
  AntiSnipingEvent,
  RoundStartEvent,
  RoundCompleteEvent,
  AuctionCompleteEvent,
} from "./events.stubs";

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

@AsyncApi()
@Injectable()
export class EventsGateway {
  private readonly logger = new Logger(EventsGateway.name);
  private server: Server | null = null;
  private connectedClients = new Map<string, Set<string>>();

  constructor(
    @Inject(redisClient) private readonly redis: Redis,
    private readonly bidCacheService: BidCacheService,
    private readonly jwtService: JwtService,
  ) {
    this.logger.log("EventsGateway constructor called");
  }

  setServer(server: Server): void {
    this.server = server;
    this.logger.log("Socket.IO server set");

    const pubClient = this.redis.duplicate();
    const subClient = this.redis.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    this.logger.log("Socket.IO Redis adapter initialized");

    server.on("connection", (client: Socket) => this.handleConnection(client));
  }

  @AsyncApiPub({
    channel: "auction-update",
    summary: "Auction state changed",
    description:
      "Broadcast when auction status, current round, or rounds configuration changes",
    message: { payload: AuctionUpdateEvent },
  })
  emitAuctionUpdate(auction: AuctionDocument): void {
    if (this.server === null) return;
    this.server.to(`auction:${auction._id.toString()}`).emit("auction-update", {
      id: auction._id,
      status: auction.status,
      currentRound: auction.currentRound,
      rounds: auction.rounds,
    });
  }

  @AsyncApiPub({
    channel: "new-bid",
    summary: "New bid placed",
    description: "Broadcast to auction room when a bid is placed or increased",
    message: { payload: NewBidEvent },
  })
  emitNewBid(
    auctionId: string,
    bidInfo: { amount: number; timestamp: Date; isIncrease: boolean },
  ): void {
    if (this.server === null) return;
    const room = `auction:${auctionId}`;
    const roomSize = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
    this.logger.debug("Emitting new-bid", {
      auctionId,
      amount: bidInfo.amount,
      roomSize,
    });
    this.server.to(room).emit("new-bid", {
      auctionId,
      amount: bidInfo.amount,
      timestamp: bidInfo.timestamp,
      isIncrease: bidInfo.isIncrease,
    });
  }

  @AsyncApiPub({
    channel: "anti-sniping",
    summary: "Anti-sniping extension",
    description:
      "Broadcast when round end time is extended due to late bid (anti-sniping protection)",
    message: { payload: AntiSnipingEvent },
  })
  emitAntiSnipingExtension(
    auction: AuctionDocument,
    extensionCount: number,
  ): void {
    if (this.server === null) return;
    const currentRound = auction.rounds[auction.currentRound - 1];
    this.server.to(`auction:${auction._id.toString()}`).emit("anti-sniping", {
      auctionId: auction._id,
      roundNumber: auction.currentRound,
      newEndTime: currentRound?.endTime,
      extensionCount,
    });
  }

  @AsyncApiPub({
    channel: "round-start",
    summary: "Round started",
    description: "Broadcast when a new round begins in the auction",
    message: { payload: RoundStartEvent },
  })
  emitRoundStart(auction: AuctionDocument, roundNumber: number): void {
    if (this.server === null) return;
    const round = auction.rounds[roundNumber - 1];
    this.server.to(`auction:${auction._id.toString()}`).emit("round-start", {
      auctionId: auction._id,
      roundNumber,
      itemsCount: round?.itemsCount,
      startTime: round?.startTime,
      endTime: round?.endTime,
    });
  }

  @AsyncApiPub({
    channel: "round-complete",
    summary: "Round completed",
    description: "Broadcast when a round ends with winner information",
    message: { payload: RoundCompleteEvent },
  })
  emitRoundComplete(
    auction: AuctionDocument,
    roundNumber: number,
    winners: BidDocument[],
  ): void {
    if (this.server === null) return;
    this.server.to(`auction:${auction._id.toString()}`).emit("round-complete", {
      auctionId: auction._id,
      roundNumber,
      winnersCount: winners.length,
      winners: winners.map((w) => ({
        amount: w.amount,
        itemNumber: w.itemNumber,
      })),
    });
  }

  @AsyncApiPub({
    channel: "auction-complete",
    summary: "Auction completed",
    description: "Broadcast when the entire auction ends (all rounds finished)",
    message: { payload: AuctionCompleteEvent },
  })
  emitAuctionComplete(auction: AuctionDocument): void {
    if (this.server === null) return;
    this.server
      .to(`auction:${auction._id.toString()}`)
      .emit("auction-complete", {
        auctionId: auction._id,
        endTime: auction.endTime,
        totalRounds: auction.rounds.length,
      });
  }

  emitGlobal(event: string, data: unknown): void {
    if (this.server === null) return;
    this.server.emit(event, data);
  }

  @AsyncApiPub({
    channel: "countdown",
    summary: "Countdown tick",
    description:
      "Broadcast every second with remaining time and server clock for synchronization",
    message: { payload: CountdownEvent },
  })
  emitCountdown(
    auctionId: string,
    data: {
      auctionId: string;
      roundNumber: number;
      timeLeftSeconds: number;
      roundEndTime: string;
      isUrgent: boolean;
      serverTime: string;
    },
  ): void {
    if (this.server === null) return;
    this.server.to(`auction:${auctionId}`).emit("countdown", data);
  }

  private handleConnection(client: AuthenticatedSocket): void {
    this.logger.log("Client connected", client.id);

    client.on("disconnect", () => this.handleDisconnect(client));
    client.on("join-auction", (auctionId: string) =>
      this.handleJoinAuction(client, auctionId),
    );
    client.on("leave-auction", (auctionId: string) =>
      this.handleLeaveAuction(client, auctionId),
    );

    client.on("auth", (token: string) => this.handleAuth(client, token));
    client.on(
      "place-bid",
      async (payload: PlaceBidPayload) =>
        await this.handlePlaceBid(client, payload),
    );
  }

  @AsyncApiSub({
    channel: "auth",
    summary: "Authenticate WebSocket connection",
    description:
      "Send JWT token to authenticate the socket connection. Must be called before place-bid.",
    message: { payload: AuthPayload },
  })
  @AsyncApiPub({
    channel: "auth-response",
    summary: "Authentication result",
    description: "Response to auth event with success status and user info",
    message: { payload: AuthResponse },
  })
  private handleAuth(client: AuthenticatedSocket, token: string): void {
    try {
      const payload = this.jwtService.verify<{ sub: string; username: string }>(
        token,
      );
      client.userId = payload.sub;
      client.username = payload.username;
      client.emit("auth-response", { success: true, userId: client.userId });
      this.logger.debug("Socket authenticated", {
        clientId: client.id,
        userId: client.userId,
      });
    } catch (_error) {
      client.emit("auth-response", {
        success: false,
        error: "Invalid or expired token",
      });
      this.logger.warn("Socket auth failed", { clientId: client.id });
    }
  }

  @AsyncApiSub({
    channel: "place-bid",
    summary: "Place a bid via WebSocket",
    description:
      "Ultra-fast bid placement. Requires prior authentication via 'auth' event.",
    message: { payload: PlaceBidPayloadStub },
  })
  @AsyncApiPub({
    channel: "bid-response",
    summary: "Bid placement result",
    description:
      "Response to place-bid event with success status and bid details",
    message: { payload: BidResponse },
  })
  private async handlePlaceBid(
    client: AuthenticatedSocket,
    payload: PlaceBidPayload,
  ): Promise<void> {
    if (client.userId === undefined) {
      client.emit("bid-response", {
        success: false,
        error: "Not authenticated. Call 'auth' event first.",
      });
      return;
    }

    const { auctionId, amount } = payload;

    if (
      typeof auctionId !== "string" ||
      auctionId === "" ||
      typeof amount !== "number" ||
      amount <= 0
    ) {
      client.emit("bid-response", {
        success: false,
        error:
          "Invalid payload. Required: { auctionId: string, amount: number }",
      });
      return;
    }

    try {
      const result = await this.bidCacheService.placeBidUltraFast(
        auctionId,
        client.userId,
        amount,
      );

      if (result.success) {
        client.emit("bid-response", {
          success: true,
          amount: result.newAmount,
          previousAmount: result.previousAmount,
          isNewBid: result.isNewBid,
        });

        const newAmount = result.newAmount ?? 0;
        this.emitNewBid(auctionId, {
          amount: newAmount,
          timestamp: new Date(),
          isIncrease: result.isNewBid !== true,
        });

        if (result.roundEndTime !== undefined && result.roundEndTime > 0) {
          this.checkAntiSniping(auctionId, result);
        }
      } else {
        client.emit("bid-response", {
          success: false,
          error: result.error,
          needsWarmup: result.needsWarmup,
        });
      }
    } catch (error) {
      this.logger.error("WebSocket bid failed", error);
      client.emit("bid-response", {
        success: false,
        error: "Internal server error",
      });
    }
  }

  private checkAntiSniping(
    auctionId: string,
    result: {
      roundEndTime?: number;
      antiSnipingWindowMs?: number;
      antiSnipingExtensionMs?: number;
    },
  ): void {
    const now = Date.now();
    const roundEndTime = result.roundEndTime ?? 0;
    const antiSnipingWindowMs = result.antiSnipingWindowMs ?? 0;
    const windowStart = roundEndTime - antiSnipingWindowMs;

    if (
      now < windowStart ||
      result.antiSnipingExtensionMs === undefined ||
      result.antiSnipingExtensionMs <= 0
    ) {
      return;
    }

    this.logger.debug("Bid in anti-sniping window", {
      auctionId,
      roundEndTime: result.roundEndTime,
      now,
    });
  }

  private handleDisconnect(client: Socket): void {
    this.logger.log("Client disconnected", client.id);
    this.connectedClients.forEach((clients, auctionId) => {
      clients.delete(client.id);
      if (clients.size === 0) {
        this.connectedClients.delete(auctionId);
      }
    });
  }

  @AsyncApiSub({
    channel: "join-auction",
    summary: "Join an auction room",
    description: "Subscribe to real-time updates for a specific auction",
    message: { payload: AuctionIdPayload },
  })
  @AsyncApiPub({
    channel: "join-auction-response",
    summary: "Join auction result",
    description: "Confirmation of joining the auction room",
    message: { payload: AuctionRoomResponse },
  })
  private handleJoinAuction(client: Socket, auctionId: string): void {
    void client.join(`auction:${auctionId}`);

    if (!this.connectedClients.has(auctionId)) {
      this.connectedClients.set(auctionId, new Set());
    }
    const clientsSet = this.connectedClients.get(auctionId);
    if (clientsSet !== undefined) {
      clientsSet.add(client.id);
    }

    this.logger.debug("Client joined auction", {
      clientId: client.id,
      auctionId,
    });
    client.emit("join-auction-response", { success: true });
  }

  @AsyncApiSub({
    channel: "leave-auction",
    summary: "Leave an auction room",
    description: "Unsubscribe from real-time updates for a specific auction",
    message: { payload: AuctionIdPayload },
  })
  @AsyncApiPub({
    channel: "leave-auction-response",
    summary: "Leave auction result",
    description: "Confirmation of leaving the auction room",
    message: { payload: AuctionRoomResponse },
  })
  private handleLeaveAuction(client: Socket, auctionId: string): void {
    void client.leave(`auction:${auctionId}`);

    const clients = this.connectedClients.get(auctionId);
    if (clients !== undefined) {
      clients.delete(client.id);
      if (clients.size === 0) {
        this.connectedClients.delete(auctionId);
      }
    }

    this.logger.debug("Client left auction", {
      clientId: client.id,
      auctionId,
    });
    client.emit("leave-auction-response", { success: true });
  }
}
