import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  IAuctionResponse,
  ICreateAuction,
} from "../../../../../src/modules/auctions/dto";

export const test_api_auctions_create = async (connection: api.IConnection) => {
  const output: Primitive<IAuctionResponse> =
    await api.functional.auctions.create(
      connection,
      typia.random<ICreateAuction>(),
    );
  typia.assert(output);
};
