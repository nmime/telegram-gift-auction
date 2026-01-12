/**
 * Benchmark: GET /api/users/balance
 * Tests the balance endpoint throughput (requires auth)
 */
import api from "../../src/api";

export const test_users_balance = async (connection: api.IConnection) => {
  await api.functional.api.users.balance.getBalance(connection);
};
