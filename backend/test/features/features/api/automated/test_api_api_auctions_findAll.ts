import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type { IAuctionStatusQuery } from "../../../../../src/modules/auctions/auctions.controller";
import type { IAuctionResponse } from "../../../../../src/modules/auctions/dto";

export const test_api_api_auctions_findAll = async (
  connection: api.IConnection,
) => {
  const output: Primitive<IAuctionResponse[]> =
    await api.functional.api.auctions.findAll(
      connection,
      typia.random<IAuctionStatusQuery>(),
    );
  typia.assert(output);
};
