import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { JwtPayload } from "@/modules/auth";
import type { FastifyRequest } from "fastify";

interface AuthenticatedRequest extends FastifyRequest {
  user?: JwtPayload;
}

interface RequestWithHeaders {
  headers: {
    authorization?: string;
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & RequestWithHeaders>();

    const authHeader: string | undefined = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ") !== true) {
      throw new UnauthorizedException("Missing authorization header");
    }

    const token: string = authHeader.substring(7);
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }
}
