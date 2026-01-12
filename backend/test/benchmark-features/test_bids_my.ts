/**
 * Benchmark: GET /api/bids/my
 * Tests the all user bids endpoint throughput (requires auth)
 */
import api from "../../src/api";

export const test_bids_my = async (connection: api.IConnection) => {
  await api.functional.api.bids.my.getMyBids(connection);
};
