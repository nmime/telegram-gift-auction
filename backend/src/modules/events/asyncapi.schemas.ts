import typia from "typia";
import type {
  AuthPayload,
  AuthResponse,
  PlaceBidPayload,
  BidResponse,
  AuctionIdPayload,
  AuctionRoomResponse,
  NewBidEvent,
  AuctionUpdateEvent,
  CountdownEvent,
  AntiSnipingEvent,
  RoundStartEvent,
  RoundCompleteEvent,
  AuctionCompleteEvent,
} from "./events.dto";

export const asyncApiSchemas =
  typia.json.schemas<
    [
      AuthPayload,
      AuthResponse,
      PlaceBidPayload,
      BidResponse,
      AuctionIdPayload,
      AuctionRoomResponse,
      NewBidEvent,
      AuctionUpdateEvent,
      CountdownEvent,
      AntiSnipingEvent,
      RoundStartEvent,
      RoundCompleteEvent,
      AuctionCompleteEvent,
    ]
  >();

export function getAllSchemas(): Record<string, object> {
  // Typia v7+ uses components.schemas format
  const components = asyncApiSchemas as unknown as {
    components?: { schemas?: Record<string, object> };
  };
  return components.components?.schemas ?? {};
}
