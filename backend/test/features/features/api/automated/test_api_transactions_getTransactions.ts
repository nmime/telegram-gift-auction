import typia from "typia";
import type { Primitive } from "typia";

import api from "../../../../../src/api";
import type {
  ITransactionQuery,
  ITransactionResponse,
} from "../../../../../src/modules/transactions/dto";

export const test_api_transactions_getTransactions = async (
  connection: api.IConnection,
) => {
  const output: Primitive<Array<ITransactionResponse>> =
    await api.functional.transactions.getTransactions(
      connection,
      typia.random<ITransactionQuery>(),
    );
  typia.assert(output);
};
