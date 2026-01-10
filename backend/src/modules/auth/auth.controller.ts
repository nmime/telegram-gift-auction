import { Controller, Post, Get, Body, Req, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard, AuthenticatedRequest } from '@/common';
import { LoginDto, LoginResponseDto, UserResponseDto, LogoutResponseDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Login or register user',
    description: 'Authenticates a user by username. Creates a new user if the username does not exist. Returns JWT access token.',
  })
  @ApiResponse({ status: 200, description: 'Successfully logged in', type: LoginResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid username format' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.username);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout user',
    description: 'Logs out the user. Client should discard the JWT token.',
  })
  @ApiResponse({ status: 200, description: 'Successfully logged out', type: LogoutResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout() {
    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user',
    description: 'Returns the currently authenticated user based on JWT token.',
  })
  @ApiResponse({ status: 200, description: 'Current user data', type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async me(@Req() req: AuthenticatedRequest) {
    const user = await this.authService.validateUser(req.user.sub);
    if (!user) {
      return null;
    }

    return {
      id: user._id,
      username: user.username,
      balance: user.balance,
      frozenBalance: user.frozenBalance,
    };
  }
}
