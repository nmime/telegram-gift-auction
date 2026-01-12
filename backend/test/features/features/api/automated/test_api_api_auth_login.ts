import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  ILogin,
  ILoginResponse,
} from "../../../../../src/modules/auth/dto";

export const test_api_api_auth_login = async (connection: api.IConnection) => {
  const output: Primitive<ILoginResponse> = await api.functional.api.auth.login(
    connection,
    typia.random<ILogin>(),
  );
  typia.assert(output);
};
