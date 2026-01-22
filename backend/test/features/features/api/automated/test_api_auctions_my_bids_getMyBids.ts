import type { IUserBidResponse } from "@/modules/bids";
import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";

export const test_api_auctions_my_bids_getMyBids = async (
  connection: api.IConnection,
) => {
  const output: Primitive<IUserBidResponse[]> =
    await api.functional.auctions.my_bids.getMyBids(
      connection,
      typia.random<string>(),
    );
  typia.assert(output);
};
