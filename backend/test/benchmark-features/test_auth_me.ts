/**
 * Benchmark: GET /api/auth/me
 * Tests the current user endpoint throughput (requires auth)
 */
import api from "../../src/api";

export const test_auth_me = async (connection: api.IConnection) => {
  await api.functional.api.auth.me(connection);
};
