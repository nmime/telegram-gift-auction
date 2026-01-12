/**
 * Benchmark Servant Worker
 *
 * This runs in a worker thread and executes test functions
 */
import { IConnection } from "@nestia/fetcher";
import { DynamicBenchmarker } from "@nestia/benchmark";
import api from "../src/api";

const connection: api.IConnection = {
  host: `http://localhost:${process.env.PORT ?? 3001}`,
  headers: {
    Authorization: process.env.BENCHMARK_TOKEN
      ? `Bearer ${process.env.BENCHMARK_TOKEN}`
      : "",
  },
};

DynamicBenchmarker.servant({
  connection,
  location: `${__dirname}/benchmark-features`,
  prefix: "test",
  parameters: (conn: IConnection) => [conn],
});
