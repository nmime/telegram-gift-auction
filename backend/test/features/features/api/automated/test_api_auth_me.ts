import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { IUserResponse } from "../../../../../src/modules/auth/dto";

export const test_api_auth_me = async (connection: api.IConnection) => {
  const output: Primitive<IUserResponse | null> =
    await api.functional.auth.me(connection);
  typia.assert(output);
};
