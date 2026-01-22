import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { IBidResponse } from "../../../../../src/modules/bids/dto";

export const test_api_bids_my_getMyBids = async (
  connection: api.IConnection,
) => {
  const output: Primitive<IBidResponse[]> =
    await api.functional.bids.my.getMyBids(connection);
  typia.assert(output);
};
