/**
 * Benchmark: GET /api/auctions
 * Tests the list auctions endpoint throughput
 */
import api from "../../src/api";

export const test_auctions_list = async (connection: api.IConnection) => {
  await api.functional.api.auctions.findAll(connection, {});
};
