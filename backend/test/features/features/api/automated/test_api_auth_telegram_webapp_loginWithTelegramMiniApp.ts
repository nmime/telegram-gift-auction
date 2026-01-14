import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  ILoginResponse,
  ITelegramWebAppAuth,
} from "../../../../../src/modules/auth/dto";

export const test_api_auth_telegram_webapp_loginWithTelegramMiniApp = async (
  connection: api.IConnection,
) => {
  const output: Primitive<ILoginResponse> =
    await api.functional.auth.telegram.webapp.loginWithTelegramMiniApp(
      connection,
      typia.random<ITelegramWebAppAuth>(),
    );
  typia.assert(output);
};
