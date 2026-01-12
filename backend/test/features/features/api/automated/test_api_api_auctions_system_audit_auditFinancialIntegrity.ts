import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { IAuditResponse } from "../../../../../src/modules/auctions/dto";

export const test_api_api_auctions_system_audit_auditFinancialIntegrity =
  async (connection: api.IConnection) => {
    const output: Primitive<IAuditResponse> =
      await api.functional.api.auctions.system.audit.auditFinancialIntegrity(
        connection,
      );
    typia.assert(output);
  };
