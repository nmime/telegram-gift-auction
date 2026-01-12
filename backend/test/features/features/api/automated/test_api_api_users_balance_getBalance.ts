import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { IBalanceResponse } from "../../../../../src/modules/users/dto";

export const test_api_api_users_balance_getBalance = async (
  connection: api.IConnection,
) => {
  const output: Primitive<IBalanceResponse> =
    await api.functional.api.users.balance.getBalance(connection);
  typia.assert(output);
};
