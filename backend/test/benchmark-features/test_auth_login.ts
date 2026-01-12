/**
 * Benchmark: POST /api/auth/login
 * Tests the login endpoint throughput
 */
import api from "../../src/api";

let counter = 0;

export const test_auth_login = async (connection: api.IConnection) => {
  const username = `bench_${Date.now()}_${counter++}`;
  await api.functional.api.auth.login(connection, { username });
};
