/**
 * Benchmark: GET /api/auctions/system/audit
 * Tests the financial audit endpoint throughput
 */
import api from "../../src/api";

export const test_auctions_audit = async (connection: api.IConnection) => {
  await api.functional.api.auctions.system.audit.auditFinancialIntegrity(connection);
};
