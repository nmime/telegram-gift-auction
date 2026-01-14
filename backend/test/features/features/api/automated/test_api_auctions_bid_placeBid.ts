import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  IPlaceBid,
  IPlaceBidResponse,
} from "../../../../../src/modules/auctions/dto";

export const test_api_auctions_bid_placeBid = async (
  connection: api.IConnection,
) => {
  const output: Primitive<IPlaceBidResponse> =
    await api.functional.auctions.bid.placeBid(
      connection,
      typia.random<string>(),
      typia.random<IPlaceBid>(),
    );
  typia.assert(output);
};
