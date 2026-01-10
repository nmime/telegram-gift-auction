import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { AuthGuard, AuthenticatedRequest } from '@/common';
import { BalanceDto, BalanceResponseDto } from './dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('balance')
  @ApiOperation({
    summary: 'Get user balance',
    description: 'Returns the current available and frozen balance for the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'User balance information', type: BalanceResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getBalance(@Req() req: AuthenticatedRequest) {
    return this.usersService.getBalance(req.user.sub);
  }

  @Post('deposit')
  @ApiOperation({
    summary: 'Deposit funds',
    description: "Adds the specified amount to the user's available balance.",
  })
  @ApiResponse({ status: 201, description: 'Deposit successful', type: BalanceResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid amount' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deposit(@Req() req: AuthenticatedRequest, @Body() dto: BalanceDto) {
    const user = await this.usersService.deposit(req.user.sub, dto.amount);
    return {
      balance: user.balance,
      frozenBalance: user.frozenBalance,
    };
  }

  @Post('withdraw')
  @ApiOperation({
    summary: 'Withdraw funds',
    description: "Removes the specified amount from the user's available balance.",
  })
  @ApiResponse({ status: 201, description: 'Withdrawal successful', type: BalanceResponseDto })
  @ApiResponse({ status: 400, description: 'Insufficient balance or invalid amount' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async withdraw(@Req() req: AuthenticatedRequest, @Body() dto: BalanceDto) {
    const user = await this.usersService.withdraw(req.user.sub, dto.amount);
    return {
      balance: user.balance,
      frozenBalance: user.frozenBalance,
    };
  }
}
