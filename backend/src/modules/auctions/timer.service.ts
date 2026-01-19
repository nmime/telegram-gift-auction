import { Injectable, Logger, Inject, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { redisClient } from "@/modules/redis";
import { EventsGateway } from "@/modules/events";

interface TimerState {
  interval: NodeJS.Timeout;
  endTime: Date;
  roundNumber: number;
}

/**
 * Timer Service with Leader Election
 *
 * In a multi-instance deployment, only one instance should broadcast
 * countdown events to prevent duplicate messages. This service uses
 * Redis SET NX with TTL for leader election.
 *
 * Features:
 * - Leader election via Redis (SET NX with 5s TTL)
 * - Per-auction timer management
 * - Broadcasts every 1 second to auction room
 * - Handles timer updates for anti-sniping
 */
@Injectable()
export class TimerService implements OnModuleDestroy {
  private readonly logger = new Logger(TimerService.name);
  private readonly timers = new Map<string, TimerState>();
  private readonly LEADER_KEY = "timer-service:leader";
  private readonly LEADER_TTL_SECONDS = 5;
  private readonly BROADCAST_INTERVAL_MS = 1000;
  private leaderHeartbeatInterval: NodeJS.Timeout | null = null;
  private instanceId: string;
  private isLeader = false;

  constructor(
    @Inject(redisClient) private readonly redis: Redis,
    private readonly eventsGateway: EventsGateway,
  ) {
    // Generate unique instance ID
    this.instanceId = `timer-${process.pid}-${Date.now()}`;
    this.startLeaderElection();
  }

  onModuleDestroy() {
    this.stopAll();
    if (this.leaderHeartbeatInterval) {
      clearInterval(this.leaderHeartbeatInterval);
      this.leaderHeartbeatInterval = null;
    }
    // Release leadership if we have it
    if (this.isLeader) {
      this.redis.del(this.LEADER_KEY).catch(() => {});
    }
  }

  /**
   * Start the leader election process
   * Uses Redis SET NX to acquire leadership
   */
  private startLeaderElection() {
    // Try to become leader immediately
    this.tryBecomeLeader();

    // Periodically try to acquire/maintain leadership
    this.leaderHeartbeatInterval = setInterval(
      () => {
        this.tryBecomeLeader();
      },
      (this.LEADER_TTL_SECONDS - 1) * 1000,
    );
  }

  private async tryBecomeLeader(): Promise<boolean> {
    try {
      // Try to acquire leadership with SET NX EX
      const result = await this.redis.set(
        this.LEADER_KEY,
        this.instanceId,
        "EX",
        this.LEADER_TTL_SECONDS,
        "NX",
      );

      if (result === "OK") {
        if (!this.isLeader) {
          this.logger.log("Acquired timer service leadership", {
            instanceId: this.instanceId,
          });
          this.isLeader = true;
        }
        return true;
      }

      // Check if we already have leadership
      const currentLeader = await this.redis.get(this.LEADER_KEY);
      if (currentLeader === this.instanceId) {
        // Refresh our leadership
        await this.redis.expire(this.LEADER_KEY, this.LEADER_TTL_SECONDS);
        return true;
      }

      // Someone else is leader
      if (this.isLeader) {
        this.logger.warn("Lost timer service leadership", {
          instanceId: this.instanceId,
          newLeader: currentLeader,
        });
        this.isLeader = false;
        // Stop all our timers since we're no longer leader
        this.stopAll();
      }
      return false;
    } catch (err) {
      this.logger.error("Leader election error", err);
      return false;
    }
  }

  /**
   * Start broadcasting countdown for an auction round
   */
  async startTimer(
    auctionId: string,
    roundNumber: number,
    endTime: Date,
  ): Promise<void> {
    // Stop any existing timer for this auction
    this.stopTimer(auctionId);

    // Only start broadcasting if we're the leader
    if (!this.isLeader) {
      // Try to become leader
      const acquired = await this.tryBecomeLeader();
      if (!acquired) {
        this.logger.debug("Not leader, skipping timer start", { auctionId });
        return;
      }
    }

    this.logger.log("Starting countdown timer", {
      auctionId,
      roundNumber,
      endTime,
    });

    const state: TimerState = {
      interval: setInterval(() => {
        this.broadcastCountdown(auctionId, state);
      }, this.BROADCAST_INTERVAL_MS),
      endTime,
      roundNumber,
    };

    this.timers.set(auctionId, state);

    // Broadcast immediately
    this.broadcastCountdown(auctionId, state);
  }

  /**
   * Update timer end time (for anti-sniping extensions)
   */
  updateTimer(auctionId: string, newEndTime: Date): void {
    const state = this.timers.get(auctionId);
    if (state) {
      state.endTime = newEndTime;
      this.logger.debug("Updated timer end time", { auctionId, newEndTime });
      // Broadcast updated time immediately
      this.broadcastCountdown(auctionId, state);
    }
  }

  /**
   * Stop timer for an auction
   */
  stopTimer(auctionId: string): void {
    const state = this.timers.get(auctionId);
    if (state) {
      clearInterval(state.interval);
      this.timers.delete(auctionId);
      this.logger.debug("Stopped timer", { auctionId });
    }
  }

  /**
   * Stop all timers
   */
  private stopAll(): void {
    for (const [auctionId, state] of this.timers.entries()) {
      clearInterval(state.interval);
      this.logger.debug("Stopped timer", { auctionId });
    }
    this.timers.clear();
  }

  /**
   * Broadcast countdown event to all clients in the auction room
   */
  private broadcastCountdown(auctionId: string, state: TimerState): void {
    if (!this.isLeader) {
      // Lost leadership, stop this timer
      this.stopTimer(auctionId);
      return;
    }

    const now = new Date();
    const timeLeftMs = state.endTime.getTime() - now.getTime();
    const timeLeftSeconds = Math.max(0, Math.floor(timeLeftMs / 1000));

    // Stop broadcasting if round has ended
    if (timeLeftMs < -5000) {
      this.stopTimer(auctionId);
      return;
    }

    this.eventsGateway.emitCountdown(auctionId, {
      auctionId,
      roundNumber: state.roundNumber,
      timeLeftSeconds,
      roundEndTime: state.endTime.toISOString(),
      isUrgent: timeLeftSeconds > 0 && timeLeftSeconds <= 60,
      serverTime: now.toISOString(),
    });
  }

  /**
   * Check if timer is running for an auction
   */
  isTimerRunning(auctionId: string): boolean {
    return this.timers.has(auctionId);
  }

  /**
   * Get current leader status
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }
}
