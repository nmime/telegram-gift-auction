import { Inject, Injectable, Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { AuctionDocument, BidDocument } from "@/schemas";
import { REDIS_CLIENT } from "@/modules/redis";

@Injectable()
export class EventsGateway {
  private readonly logger = new Logger(EventsGateway.name);
  private server: Server | null = null;
  private connectedClients: Map<string, Set<string>> = new Map();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
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

  private handleConnection(client: Socket) {
    this.logger.log("Client connected", client.id);

    client.on("disconnect", () => this.handleDisconnect(client));
    client.on("join-auction", (auctionId: string) =>
      this.handleJoinAuction(client, auctionId),
    );
    client.on("leave-auction", (auctionId: string) =>
      this.handleLeaveAuction(client, auctionId),
    );
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
