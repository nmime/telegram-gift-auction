/**
 * Benchmark: GET /api/auctions/:id
 * Tests the get auction endpoint throughput
 * Requires BENCHMARK_AUCTION_ID environment variable
 */
import api from "../../src/api";

export const test_auctions_get = async (connection: api.IConnection) => {
  const auctionId = process.env.BENCHMARK_AUCTION_ID;
  if (!auctionId) {
    throw new Error("BENCHMARK_AUCTION_ID env required");
  }
  await api.functional.api.auctions.findOne(connection, auctionId);
};
