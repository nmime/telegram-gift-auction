import { Injectable, ExecutionContext } from "@nestjs/common";
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from "@nestjs/throttler";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { FastifyRequest } from "fastify";

export const localhostIps = [
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
];

export function getClientIp(request: FastifyRequest): string {
  const realIp = request.headers["x-real-ip"] as string | undefined;
  if (realIp) {
    return realIp;
  }

  const cfConnectingIp = request.headers["cf-connecting-ip"] as
    | string
    | undefined;
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const trueClientIp = request.headers["true-client-ip"] as string | undefined;
  if (trueClientIp) {
    return trueClientIp;
  }

  const originalForwardedFor = request.headers["x-original-forwarded-for"] as
    | string
    | undefined;
  if (originalForwardedFor) {
    return originalForwardedFor;
  }

  const forwardedFor = request.headers["x-forwarded-for"] as string | undefined;
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const clientIp = request.headers["x-client-ip"] as string | undefined;
  if (clientIp) {
    return clientIp;
  }

  return request.ip || "0.0.0.0";
}

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  private readonly isDevelopment: boolean;

  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    configService: ConfigService,
  ) {
    super(options, storageService, reflector);
    this.isDevelopment =
      configService.get<string>("NODE_ENV") === "development";
  }

  protected async getTracker(request: FastifyRequest): Promise<string> {
    return getClientIp(request);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const clientIp = getClientIp(request);

    if (
      this.isDevelopment &&
      (localhostIps.includes(clientIp) || clientIp === "0.0.0.0")
    ) {
      return true;
    }

    return super.canActivate(context);
  }
}
