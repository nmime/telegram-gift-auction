import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { AuthGuard, AuthenticatedRequest } from '@/common';
import { TransactionResponseDto } from './dto';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get transaction history',
    description: 'Returns a paginated list of transactions for the authenticated user, ordered by most recent first.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum number of transactions to return', example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number of transactions to skip', example: 0 })
  @ApiResponse({ status: 200, description: 'List of transactions', type: [TransactionResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTransactions(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const transactions = await this.transactionsService.getByUser(
      req.user.sub,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );

    return transactions.map(t => ({
      id: t._id,
      type: t.type,
      amount: t.amount,
      balanceBefore: t.balanceBefore,
      balanceAfter: t.balanceAfter,
      frozenBefore: t.frozenBefore,
      frozenAfter: t.frozenAfter,
      auctionId: t.auctionId,
      description: t.description,
      createdAt: t.createdAt,
    }));
  }
}
