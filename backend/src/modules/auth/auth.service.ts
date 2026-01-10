import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { User, UserDocument } from '@/schemas';

export interface JwtPayload {
  sub: string;
  username: string;
}

export interface AuthResponse {
  user: {
    id: string;
    username: string;
    balance: number;
    frozenBalance: number;
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
