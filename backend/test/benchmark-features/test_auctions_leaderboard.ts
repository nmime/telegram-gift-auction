/**
 * Benchmark: GET /api/auctions/:id/leaderboard
 * Tests the leaderboard endpoint throughput
 * Requires BENCHMARK_AUCTION_ID environment variable
 */
import api from "../../src/api";

export const test_auctions_leaderboard = async (connection: api.IConnection) => {
  const auctionId = process.env.BENCHMARK_AUCTION_ID;
  if (!auctionId) {
    throw new Error("BENCHMARK_AUCTION_ID env required");
  }
  await api.functional.api.auctions.leaderboard.getLeaderboard(connection, auctionId, {});
};
