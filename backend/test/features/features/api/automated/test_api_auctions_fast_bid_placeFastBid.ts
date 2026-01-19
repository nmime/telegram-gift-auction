import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  IFastBidResponse,
  IPlaceBid,
} from "../../../../../src/modules/auctions/dto";

export const test_api_auctions_fast_bid_placeFastBid = async (
  connection: api.IConnection,
) => {
  const output: Primitive<IFastBidResponse> =
    await api.functional.auctions.fast_bid.placeFastBid(
      connection,
      typia.random<string>(),
      typia.random<IPlaceBid>(),
    );
  typia.assert(output);
};
