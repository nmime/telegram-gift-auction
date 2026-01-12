import { Controller, Req, UseGuards } from '@nestjs/common';
import { TypedRoute } from '@nestia/core';
import { Types } from 'mongoose';
import { BidsService } from './bids.service';
import { AuthGuard, AuthenticatedRequest } from '@/common';
import { IBidResponse, IAuctionSummary } from './dto';
import { AuctionStatus } from '@/schemas';

interface PopulatedAuction {
  _id: Types.ObjectId;
  title: string;
  status: AuctionStatus;
}

function isPopulatedAuction(value: unknown): value is PopulatedAuction {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('title' in value)) {
    return false;
  }
  const maybeAuction: { title: unknown } = value;
  return typeof maybeAuction.title === 'string';
}

function isObjectId(value: unknown): value is Types.ObjectId {
  return value instanceof Types.ObjectId || (typeof value === 'object' && value !== null && '_bsontype' in value);
}

@Controller('bids')
@UseGuards(AuthGuard)
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  /**
   * Get all my bids
   *
   * Returns all bids placed by the authenticated user across all auctions.
   *
   * @tag bids
   * @security bearer
   * @returns List of user bids
   */
  @TypedRoute.Get('my')
  async getMyBids(@Req() req: AuthenticatedRequest): Promise<IBidResponse[]> {
    const bids = await this.bidsService.getByUser(req.user.sub);
    return bids.map(b => {
      let auction: IAuctionSummary | null = null;
      let auctionId: string;

      if (isPopulatedAuction(b.auctionId)) {
        auction = {
          id: b.auctionId._id.toString(),
          title: b.auctionId.title,
          status: b.auctionId.status,
        };
        auctionId = b.auctionId._id.toString();
      } else if (isObjectId(b.auctionId)) {
        auctionId = b.auctionId.toString();
      } else {
        auctionId = String(b.auctionId);
      }

      return {
        id: b._id.toString(),
        auctionId,
        auction,
        amount: b.amount,
        status: b.status,
        wonRound: b.wonRound,
        itemNumber: b.itemNumber,
        createdAt: b.createdAt,
      };
    });
  }
}
