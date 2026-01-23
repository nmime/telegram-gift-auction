// Client → Server
export class AuthPayload {}
export class PlaceBidPayload {}
export class AuctionIdPayload {}

// Server → Client
export class AuthResponse {}
export class BidResponse {}
export class AuctionRoomResponse {}
export class NewBidEvent {}
export class AuctionUpdateEvent {}
export class CountdownEvent {}
export class AntiSnipingEvent {}
export class RoundStartEvent {}
export class RoundCompleteEvent {}
export class AuctionCompleteEvent {}
