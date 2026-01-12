/**
 * Benchmark: GET /api/auctions/:id/my-bids
 * Tests the user bids endpoint throughput (requires auth)
 * Requires BENCHMARK_AUCTION_ID environment variable
 */
import api from "../../src/api";

export const test_auctions_my_bids = async (connection: api.IConnection) => {
  const auctionId = process.env.BENCHMARK_AUCTION_ID;
  if (!auctionId) {
    throw new Error("BENCHMARK_AUCTION_ID env required");
  }
  await api.functional.api.auctions.my_bids.getMyBids(connection, auctionId);
};
