import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  IBalance,
  IBalanceResponse,
} from "../../../../../src/modules/users/dto";

export const test_api_users_withdraw = async (connection: api.IConnection) => {
  const output: Primitive<IBalanceResponse> =
    await api.functional.users.withdraw(connection, typia.random<IBalance>());
  typia.assert(output);
};
