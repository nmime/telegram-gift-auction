/**
 * Benchmark: GET /api/auctions/:id/min-winning-bid
 * Tests the min winning bid endpoint throughput
 * Requires BENCHMARK_AUCTION_ID environment variable
 */
import api from "../../src/api";

export const test_auctions_min_winning_bid = async (connection: api.IConnection) => {
  const auctionId = process.env.BENCHMARK_AUCTION_ID;
  if (!auctionId) {
    throw new Error("BENCHMARK_AUCTION_ID env required");
  }
  await api.functional.api.auctions.min_winning_bid.getMinWinningBid(connection, auctionId);
};
