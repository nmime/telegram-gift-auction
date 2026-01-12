/**
 * Benchmark: GET /api/transactions
 * Tests the transactions endpoint throughput (requires auth)
 */
import api from "../../src/api";

export const test_transactions = async (connection: api.IConnection) => {
  await api.functional.api.transactions.getTransactions(connection, {});
};
