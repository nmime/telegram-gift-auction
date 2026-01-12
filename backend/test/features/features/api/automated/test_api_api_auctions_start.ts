import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { IAuctionResponse } from "../../../../../src/modules/auctions/dto";

export const test_api_api_auctions_start = async (
  connection: api.IConnection,
) => {
  const output: Primitive<IAuctionResponse> =
    await api.functional.api.auctions.start(connection, typia.random<string>());
  typia.assert(output);
};
