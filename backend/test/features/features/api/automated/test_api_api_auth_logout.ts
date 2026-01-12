import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { ILogoutResponse } from "../../../../../src/modules/auth/dto";

export const test_api_api_auth_logout = async (connection: api.IConnection) => {
  const output: Primitive<ILogoutResponse> =
    await api.functional.api.auth.logout(connection);
  typia.assert(output);
};
