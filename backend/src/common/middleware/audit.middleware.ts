import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { AuditLogService } from "@/modules/audit/services";

interface RequestWithUser extends FastifyRequest {
  user?: {
    userId?: string;
  };
}

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  constructor(private readonly auditLogService: AuditLogService) {}

  use(req: RequestWithUser, res: FastifyReply, next: () => void): void {
    const startTime = Date.now();

    // Capture request data
    const method = req.method;
    const url = req.url;
    const userId: string | undefined = req.user?.userId;
    const forwardedFor = req.headers["x-forwarded-for"] as string | undefined;
    const realIp = req.headers["x-real-ip"] as string | undefined;
    const ipAddress: string =
      forwardedFor !== undefined && forwardedFor !== ""
        ? forwardedFor
        : realIp !== undefined && realIp !== ""
          ? realIp
          : req.ip;
    const rawUserAgent = req.headers["user-agent"];
    const userAgent: string =
      typeof rawUserAgent === "string" ? rawUserAgent : "";

    // Clone request body for logging
    const requestBody: Record<string, unknown> =
      req.body !== undefined && req.body !== null
        ? (JSON.parse(JSON.stringify(req.body)) as Record<string, unknown>)
        : {};

    // Hook into response finish event
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- res.raw may be undefined in some Fastify test scenarios
    if (res.raw?.on !== undefined) {
      res.raw.on("finish", () => {
        // Only log mutations (POST, PUT, DELETE, PATCH)
        if (!["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
          return;
        }

        const statusCode = res.statusCode;
        const duration = Date.now() - startTime;

        // Determine action from method and path
        const action = this.extractAction(method, url);
        const resource = this.extractResource(url);

        // Determine result based on status code
        const result =
          statusCode >= 200 && statusCode < 300 ? "success" : "failure";

        // Extract error message from response if failure
        let errorMessage: string | undefined;
        if (result === "failure") {
          errorMessage = `HTTP ${String(statusCode)} - ${method} ${url}`;
        }

        this.auditLogService
          .createLog({
            userId,
            action,
            resource,
            resourceId: this.extractResourceId(url),
            oldValues:
              method === "PUT" || method === "PATCH" ? requestBody : undefined,
            newValues:
              method === "POST" || method === "PUT" || method === "PATCH"
                ? requestBody
                : undefined,
            result,
            errorMessage,
            ipAddress,
            userAgent,
            metadata: {
              method,
              url,
              statusCode,
              duration,
            },
          })
          .catch((error: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Failed to create audit log:", error);
          });
      });
    }

    next();
  }

  private extractAction(method: string, url: string): string {
    const pathSegments = url.split("/").filter(Boolean);
    const basePath =
      pathSegments[1] !== undefined && pathSegments[1] !== ""
        ? pathSegments[1]
        : "unknown";

    switch (method) {
      case "POST":
        return `create_${basePath}`;
      case "PUT":
        return `update_${basePath}`;
      case "PATCH":
        return `partial_update_${basePath}`;
      case "DELETE":
        return `delete_${basePath}`;
      default:
        return `${method.toLowerCase()}_${basePath}`;
    }
  }

  private extractResource(url: string): string {
    const pathSegments = url.split("/").filter(Boolean);
    // Remove 'api' prefix if exists
    const relevantSegments =
      pathSegments[0] === "api" ? pathSegments.slice(1) : pathSegments;
    return relevantSegments[0] !== undefined && relevantSegments[0] !== ""
      ? relevantSegments[0]
      : "unknown";
  }

  private extractResourceId(url: string): string | undefined {
    // Match MongoDB ObjectId pattern in URL
    const objectIdPattern = /[a-f\d]{24}/i;
    const match = objectIdPattern.exec(url);
    return match !== null ? match[0] : undefined;
  }
}
