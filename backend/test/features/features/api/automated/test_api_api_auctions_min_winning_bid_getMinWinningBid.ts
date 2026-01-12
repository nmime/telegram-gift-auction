import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { IMinWinningBidResponse } from "../../../../../src/modules/auctions/dto";

export const test_api_api_auctions_min_winning_bid_getMinWinningBid = async (
  connection: api.IConnection,
) => {
  const output: Primitive<IMinWinningBidResponse> =
    await api.functional.api.auctions.min_winning_bid.getMinWinningBid(
      connection,
      typia.random<string>(),
    );
  typia.assert(output);
};
