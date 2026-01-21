/**
 * Generate JSON schemas for WebSocket events using typia
 * This file is compiled with typia transformer to generate schemas at build time
 */
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

/**
 * All WebSocket event schemas generated via typia
 */
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

/**
 * Get all schemas as a map (keyed by type name)
 * Typia generates schemas under components.schemas with type names as keys
 */
export function getAllSchemas(): Record<string, object> {
  // Typia v7+ uses components.schemas format
  const components = asyncApiSchemas as unknown as {
    components?: { schemas?: Record<string, object> };
  };
  return components.components?.schemas ?? {};
}
