import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { User, UserDocument } from '@/schemas';
import { TelegramUser, WebAppInitData } from './telegram.service';

export interface JwtPayload {
  sub: string;
  username: string;
  telegramId?: number;
}

export interface AuthResponse {
  user: {
    id: string;
    username: string;
    balance: number;
    frozenBalance: number;
    telegramId?: number;
    firstName?: string;
    lastName?: string;
    photoUrl?: string;
  };
  accessToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  async login(username: string): Promise<AuthResponse> {
    let user = await this.userModel.findOne({ username });

    if (!user) {
      user = await this.userModel.create({ username });
    }

    const payload: JwtPayload = {
      sub: user._id.toString(),
      username: user.username,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      user: {
        id: user._id.toString(),
        username: user.username,
        balance: user.balance,
        frozenBalance: user.frozenBalance,
      },
      accessToken,
    };
  }

  async loginWithTelegramWidget(telegramUser: TelegramUser): Promise<AuthResponse> {
    // Find user by Telegram ID or create new
    let user = await this.userModel.findOne({ telegramId: telegramUser.id });

    if (!user) {
      // Generate username from Telegram data
      const username = telegramUser.username || `tg_${telegramUser.id}`;

      // Check if username already exists (for non-Telegram users)
      const existingByUsername = await this.userModel.findOne({ username });
      const finalUsername = existingByUsername
        ? `tg_${telegramUser.id}`
        : username;

      user = await this.userModel.create({
        username: finalUsername,
        telegramId: telegramUser.id,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        photoUrl: telegramUser.photo_url,
        languageCode: telegramUser.language_code,
        isPremium: telegramUser.is_premium || false,
      });
    } else {
      // Update user info if changed
      user.firstName = telegramUser.first_name;
      user.lastName = telegramUser.last_name;
      user.photoUrl = telegramUser.photo_url;
      user.languageCode = telegramUser.language_code;
      user.isPremium = telegramUser.is_premium || false;
      await user.save();
    }

    const payload: JwtPayload = {
      sub: user._id.toString(),
      username: user.username,
      telegramId: user.telegramId,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      user: {
        id: user._id.toString(),
        username: user.username,
        balance: user.balance,
        frozenBalance: user.frozenBalance,
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        photoUrl: user.photoUrl,
      },
      accessToken,
    };
  }

  async loginWithTelegramMiniApp(initData: WebAppInitData): Promise<AuthResponse> {
    if (!initData.user) {
      throw new UnauthorizedException('User data not found in init data');
    }

    const telegramUser: TelegramUser = {
      id: initData.user.id,
      first_name: initData.user.first_name,
      last_name: initData.user.last_name,
      username: initData.user.username,
      language_code: initData.user.language_code,
      is_premium: initData.user.is_premium,
      photo_url: initData.user.photo_url,
      auth_date: initData.auth_date,
      hash: initData.hash,
    };

    return this.loginWithTelegramWidget(telegramUser);
  }

  async validateToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async validateUser(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId);
  }

  async getUser(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }
}
