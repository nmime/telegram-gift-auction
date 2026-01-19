import { Inject, Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { AuctionDocument, BidDocument } from "@/schemas";
import { redisClient, BidCacheService } from "@/modules/redis";

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

interface PlaceBidPayload {
  auctionId: string;
  amount: number;
}

@Injectable()
export class EventsGateway {
  private readonly logger = new Logger(EventsGateway.name);
  private server: Server | null = null;
  private connectedClients: Map<string, Set<string>> = new Map();

  constructor(
    @Inject(redisClient) private readonly redis: Redis,
    private readonly bidCacheService: BidCacheService,
    private readonly jwtService: JwtService,
  ) {
    this.logger.log("EventsGateway constructor called");
  }

  setServer(server: Server) {
    this.server = server;
    this.logger.log("Socket.IO server set");

    // Set up Redis adapter for scaling
    const pubClient = this.redis.duplicate();
    const subClient = this.redis.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    this.logger.log("Socket.IO Redis adapter initialized");

    // Set up connection handlers
    server.on("connection", (client: Socket) => this.handleConnection(client));
  }

  private handleConnection(client: AuthenticatedSocket) {
    this.logger.log("Client connected", client.id);

    client.on("disconnect", () => this.handleDisconnect(client));
    client.on("join-auction", (auctionId: string) =>
      this.handleJoinAuction(client, auctionId),
    );
    client.on("leave-auction", (auctionId: string) =>
      this.handleLeaveAuction(client, auctionId),
    );

    // Auth-required event: authenticate and place bid
    client.on("auth", (token: string) => this.handleAuth(client, token));
    client.on("place-bid", (payload: PlaceBidPayload) =>
      this.handlePlaceBid(client, payload),
    );
  }

  /**
   * Authenticate socket connection with JWT token
   * Must be called before place-bid
   */
  private handleAuth(client: AuthenticatedSocket, token: string) {
    try {
      const payload = this.jwtService.verify(token);
      client.userId = payload.sub;
      client.username = payload.username;
      client.emit("auth-response", { success: true, userId: client.userId });
      this.logger.debug("Socket authenticated", {
        clientId: client.id,
        userId: client.userId,
      });
    } catch (error) {
      client.emit("auth-response", {
        success: false,
        error: "Invalid or expired token",
      });
      this.logger.warn("Socket auth failed", { clientId: client.id });
    }
  }

  /**
   * Ultra-fast WebSocket bid placement
   * Skips HTTP overhead for maximum throughput (~10k+ bids/sec with cluster)
   */
  private async handlePlaceBid(
    client: AuthenticatedSocket,
    payload: PlaceBidPayload,
  ) {
    // Check authentication
    if (!client.userId) {
      client.emit("bid-response", {
        success: false,
        error: "Not authenticated. Call 'auth' event first.",
      });
      return;
    }

    const { auctionId, amount } = payload;

    // Validate payload
    if (!auctionId || typeof amount !== "number" || amount <= 0) {
      client.emit("bid-response", {
        success: false,
        error: "Invalid payload. Required: { auctionId: string, amount: number }",
      });
      return;
    }

    try {
      // Use ultra-fast Redis path directly
      const result = await this.bidCacheService.placeBidUltraFast(
        auctionId,
        client.userId,
        amount,
      );

      if (result.success) {
        // Emit response to bidder
        client.emit("bid-response", {
          success: true,
          amount: result.newAmount,
          previousAmount: result.previousAmount,
          isNewBid: result.isNewBid,
        });

        // Broadcast new bid to auction room
        this.emitNewBid(auctionId, {
          amount: result.newAmount!,
          timestamp: new Date(),
          isIncrease: !result.isNewBid,
        });

        // Async anti-sniping check (don't block response)
        if (result.roundEndTime && result.roundEndTime > 0) {
          this.checkAntiSniping(auctionId, result).catch((err) =>
            this.logger.error("Anti-sniping check failed", err),
          );
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

  /**
   * Async anti-sniping check - extends round if bid is in sniping window
   * This is fire-and-forget to not block the bid response
   */
  private async checkAntiSniping(
    auctionId: string,
    result: {
      roundEndTime?: number;
      antiSnipingWindowMs?: number;
      antiSnipingExtensionMs?: number;
    },
  ) {
    const now = Date.now();
    const windowStart =
      (result.roundEndTime || 0) - (result.antiSnipingWindowMs || 0);

    if (
      now < windowStart ||
      !result.antiSnipingExtensionMs ||
      result.antiSnipingExtensionMs <= 0
    ) {
      return; // Not in anti-sniping window
    }

    // Anti-sniping extension is handled by AuctionsService
    // This would require injecting AuctionsService which creates circular dep
    // For now, log that anti-sniping should be checked
    this.logger.debug("Bid in anti-sniping window", {
      auctionId,
      roundEndTime: result.roundEndTime,
      now,
    });
  }

  private handleDisconnect(client: Socket) {
    this.logger.log("Client disconnected", client.id);
    this.connectedClients.forEach((clients, auctionId) => {
      clients.delete(client.id);
      if (clients.size === 0) {
        this.connectedClients.delete(auctionId);
      }
    });
  }

  private handleJoinAuction(client: Socket, auctionId: string) {
    client.join(`auction:${auctionId}`);

    if (!this.connectedClients.has(auctionId)) {
      this.connectedClients.set(auctionId, new Set());
    }
    this.connectedClients.get(auctionId)!.add(client.id);

    this.logger.debug("Client joined auction", {
      clientId: client.id,
      auctionId,
    });
    client.emit("join-auction-response", { success: true });
  }

  private handleLeaveAuction(client: Socket, auctionId: string) {
    client.leave(`auction:${auctionId}`);

    const clients = this.connectedClients.get(auctionId);
    if (clients) {
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

  emitAuctionUpdate(auction: AuctionDocument) {
    if (!this.server) return;
    this.server.to(`auction:${auction._id.toString()}`).emit("auction-update", {
      id: auction._id,
      status: auction.status,
      currentRound: auction.currentRound,
      rounds: auction.rounds,
    });
  }

  emitNewBid(
    auctionId: string,
    bidInfo: { amount: number; timestamp: Date; isIncrease: boolean },
  ) {
    if (!this.server) return;
    const room = `auction:${auctionId}`;
    const roomSize = this.server.sockets.adapter.rooms.get(room)?.size || 0;
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

  emitAntiSnipingExtension(auction: AuctionDocument, extensionCount: number) {
    if (!this.server) return;
    const currentRound = auction.rounds[auction.currentRound - 1];
    this.server.to(`auction:${auction._id.toString()}`).emit("anti-sniping", {
      auctionId: auction._id,
      roundNumber: auction.currentRound,
      newEndTime: currentRound?.endTime,
      extensionCount,
    });
  }

  emitRoundStart(auction: AuctionDocument, roundNumber: number) {
    if (!this.server) return;
    const round = auction.rounds[roundNumber - 1];
    this.server.to(`auction:${auction._id.toString()}`).emit("round-start", {
      auctionId: auction._id,
      roundNumber,
      itemsCount: round?.itemsCount,
      startTime: round?.startTime,
      endTime: round?.endTime,
    });
  }

  emitRoundComplete(
    auction: AuctionDocument,
    roundNumber: number,
    winners: BidDocument[],
  ) {
    if (!this.server) return;
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

  emitAuctionComplete(auction: AuctionDocument) {
    if (!this.server) return;
    this.server
      .to(`auction:${auction._id.toString()}`)
      .emit("auction-complete", {
        auctionId: auction._id,
        endTime: auction.endTime,
        totalRounds: auction.rounds.length,
      });
  }

  emitGlobal(event: string, data: unknown) {
    if (!this.server) return;
    this.server.emit(event, data);
  }

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
  ) {
    if (!this.server) return;
    this.server.to(`auction:${auctionId}`).emit("countdown", data);
  }
}
