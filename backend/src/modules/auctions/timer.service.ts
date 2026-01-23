import { Injectable, Logger, Inject, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { redisClient } from "@/modules/redis";
import { EventsGateway } from "@/modules/events";

interface TimerState {
  interval: NodeJS.Timeout;
  endTime: Date;
  roundNumber: number;
}

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
    this.instanceId = `timer-${String(process.pid)}-${String(Date.now())}`;
    this.startLeaderElection();
  }

  onModuleDestroy(): void {
    this.stopAll();
    if (this.leaderHeartbeatInterval !== null) {
      clearInterval(this.leaderHeartbeatInterval);
      this.leaderHeartbeatInterval = null;
    }
    if (this.isLeader) {
      this.redis.del(this.LEADER_KEY).catch(() => {
        // Intentionally ignore errors during cleanup
      });
    }
  }

  async startTimer(
    auctionId: string,
    roundNumber: number,
    endTime: Date,
  ): Promise<void> {
    this.stopTimer(auctionId);

    if (!this.isLeader) {
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

    this.broadcastCountdown(auctionId, state);
  }

  updateTimer(auctionId: string, newEndTime: Date): void {
    const state = this.timers.get(auctionId);
    if (state !== undefined) {
      state.endTime = newEndTime;
      this.logger.debug("Updated timer end time", { auctionId, newEndTime });
      this.broadcastCountdown(auctionId, state);
    }
  }

  stopTimer(auctionId: string): void {
    const state = this.timers.get(auctionId);
    if (state !== undefined) {
      clearInterval(state.interval);
      this.timers.delete(auctionId);
      this.logger.debug("Stopped timer", { auctionId });
    }
  }

  isTimerRunning(auctionId: string): boolean {
    return this.timers.has(auctionId);
  }

  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  private startLeaderElection(): void {
    void this.tryBecomeLeader();

    this.leaderHeartbeatInterval = setInterval(
      () => {
        void this.tryBecomeLeader();
      },
      (this.LEADER_TTL_SECONDS - 1) * 1000,
    );
  }

  private async tryBecomeLeader(): Promise<boolean> {
    try {
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

      const currentLeader = await this.redis.get(this.LEADER_KEY);
      if (currentLeader === this.instanceId) {
        await this.redis.expire(this.LEADER_KEY, this.LEADER_TTL_SECONDS);
        return true;
      }

      if (this.isLeader) {
        this.logger.warn("Lost timer service leadership", {
          instanceId: this.instanceId,
          newLeader: currentLeader,
        });
        this.isLeader = false;
        this.stopAll();
      }
      return false;
    } catch (err: unknown) {
      this.logger.error("Leader election error", err);
      return false;
    }
  }

  private stopAll(): void {
    for (const [auctionId, state] of this.timers.entries()) {
      clearInterval(state.interval);
      this.logger.debug("Stopped timer", { auctionId });
    }
    this.timers.clear();
  }

  private broadcastCountdown(auctionId: string, state: TimerState): void {
    if (!this.isLeader) {
      this.stopTimer(auctionId);
      return;
    }

    const now = new Date();
    const timeLeftMs = state.endTime.getTime() - now.getTime();
    const timeLeftSeconds = Math.max(0, Math.floor(timeLeftMs / 1000));

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
}
