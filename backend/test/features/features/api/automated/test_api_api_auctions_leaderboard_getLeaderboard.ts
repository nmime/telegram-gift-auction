import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { ILeaderboardResponse } from "../../../../../src/modules/auctions/dto";

export const test_api_api_auctions_leaderboard_getLeaderboard = async (
  connection: api.IConnection,
) => {
  const output: Primitive<ILeaderboardResponse> =
    await api.functional.api.auctions.leaderboard.getLeaderboard(
      connection,
      typia.random<string>(),
      {},
    );
  typia.assert(output);
};
