import { Injectable, NestMiddleware } from "@nestjs/common";
import { FastifyRequest, FastifyReply } from "fastify";
import { AuditLogService } from "@/modules/audit/services";

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  constructor(private readonly auditLogService: AuditLogService) {}

  use(req: FastifyRequest, res: FastifyReply, next: () => void) {
    const startTime = Date.now();

    // Capture request data
    const method = req.method;
    const url = req.url;
    const userId = (req as any).user?.userId;
    const ipAddress =
      (req.headers["x-forwarded-for"] as string) ||
      (req.headers["x-real-ip"] as string) ||
      req.ip;
    const userAgent = req.headers["user-agent"] as string;

    // Clone request body for logging
    const requestBody = req.body ? JSON.parse(JSON.stringify(req.body)) : {};

    // Hook into response finish event
    res.raw.on("finish", async () => {
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
      const result = statusCode >= 200 && statusCode < 300 ? "success" : "failure";

      // Extract error message from response if failure
      let errorMessage: string | undefined;
      if (result === "failure") {
        errorMessage = `HTTP ${statusCode} - ${method} ${url}`;
      }

      try {
        await this.auditLogService.createLog({
          userId,
          action,
          resource,
          resourceId: this.extractResourceId(url),
          oldValues: method === "PUT" || method === "PATCH" ? requestBody : undefined,
          newValues: method === "POST" || method === "PUT" || method === "PATCH" ? requestBody : undefined,
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
        });
      } catch (error) {
        console.error("Failed to create audit log:", error);
      }
    });

    next();
  }

  private extractAction(method: string, url: string): string {
    const pathSegments = url.split("/").filter(Boolean);
    const basePath = pathSegments[1] || "unknown";

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
    const relevantSegments = pathSegments[0] === "api" ? pathSegments.slice(1) : pathSegments;
    return relevantSegments[0] || "unknown";
  }

  private extractResourceId(url: string): string | undefined {
    // Match MongoDB ObjectId pattern in URL
    const objectIdPattern = /[a-f\d]{24}/i;
    const match = url.match(objectIdPattern);
    return match ? match[0] : undefined;
  }
}
