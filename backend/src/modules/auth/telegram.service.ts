import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { validateWebAppData, checkSignature } from "@grammyjs/validator";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
  auth_date: number;
  hash: string;
}

export interface WebAppInitData {
  query_id?: string;
  user?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    photo_url?: string;
  };
  auth_date: number;
  hash: string;
}

@Injectable()
export class TelegramService {
  private readonly botToken: string;
  private readonly maxAuthAge = 86400; // 24 hours

  constructor(private readonly configService: ConfigService) {
    this.botToken = this.configService.get<string>("telegram.botToken")!;
  }

  validateWidgetAuth(payload: TelegramUser): TelegramUser {
    if (!this.botToken) {
      throw new UnauthorizedException("Bot token not configured");
    }

    // Check auth_date is not too old
    const authAge = Math.floor(Date.now() / 1000) - payload.auth_date;
    if (authAge > this.maxAuthAge) {
      throw new UnauthorizedException("Auth data expired");
    }

    // Convert payload to Record<string, string> for checkSignature
    const dataCheck: Record<string, string> = {
      id: String(payload.id),
      first_name: payload.first_name,
      auth_date: String(payload.auth_date),
      hash: payload.hash,
    };

    if (payload.last_name) dataCheck.last_name = payload.last_name;
    if (payload.username) dataCheck.username = payload.username;
    if (payload.photo_url) dataCheck.photo_url = payload.photo_url;
    if (payload.language_code) dataCheck.language_code = payload.language_code;
    if (payload.is_premium !== undefined)
      dataCheck.is_premium = String(payload.is_premium);

    // Validate signature using @grammyjs/validator
    const isValid = checkSignature(this.botToken, dataCheck);

    if (!isValid) {
      throw new UnauthorizedException("Invalid Telegram auth data");
    }

    return payload;
  }

  validateWebAppInitData(initDataString: string): WebAppInitData {
    if (!this.botToken) {
      throw new UnauthorizedException("Bot token not configured");
    }

    if (initDataString.length > 4096) {
      throw new UnauthorizedException("Init data too large");
    }

    // Parse the init data string
    const searchParams = new URLSearchParams(initDataString);

    // Validate using @grammyjs/validator
    const isValid = validateWebAppData(this.botToken, searchParams);

    if (!isValid) {
      throw new UnauthorizedException("Invalid Web App init data");
    }

    // Parse user data
    const userStr = searchParams.get("user");
    const authDateStr = searchParams.get("auth_date");
    const hash = searchParams.get("hash");

    if (!authDateStr || !hash) {
      throw new UnauthorizedException("Missing required fields in init data");
    }

    const authDate = parseInt(authDateStr, 10);

    // Check auth_date is not too old
    const authAge = Math.floor(Date.now() / 1000) - authDate;
    if (authAge > this.maxAuthAge) {
      throw new UnauthorizedException("Auth data expired");
    }

    let user: WebAppInitData["user"];
    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch {
        throw new UnauthorizedException("Invalid user data format");
      }
    }

    return {
      query_id: searchParams.get("query_id") || undefined,
      user,
      auth_date: authDate,
      hash,
    };
  }
}
