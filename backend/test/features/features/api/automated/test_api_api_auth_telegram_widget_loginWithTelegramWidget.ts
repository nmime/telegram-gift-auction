import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  ILoginResponse,
  ITelegramWidgetAuth,
} from "../../../../../src/modules/auth/dto";

export const test_api_api_auth_telegram_widget_loginWithTelegramWidget = async (
  connection: api.IConnection,
) => {
  const output: Primitive<ILoginResponse> =
    await api.functional.api.auth.telegram.widget.loginWithTelegramWidget(
      connection,
      typia.random<ITelegramWidgetAuth>(),
    );
  typia.assert(output);
};
