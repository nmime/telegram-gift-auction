import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  ILanguageResponse,
  ILanguageUpdate,
} from "../../../../../src/modules/users/dto";

export const test_api_users_language_updateLanguage = async (
  connection: api.IConnection,
) => {
  const output: Primitive<ILanguageResponse> =
    await api.functional.users.language.updateLanguage(
      connection,
      typia.random<ILanguageUpdate>(),
    );
  typia.assert(output);
};
