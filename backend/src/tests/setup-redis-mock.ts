/**
 * Global Redis Mock Setup for All Tests
 * Uses ioredis-mock to provide a fully functional Redis mock for testing
 */

import RedisMock from "ioredis-mock";
import { EventEmitter } from "events";

// Mock ioredis globally across all test files
jest.mock("ioredis", () => RedisMock);

// Mock BullMQ's Queue and Worker classes since they use Lua scripts that ioredis-mock doesn't support
jest.mock("bullmq", () => {
  class MockQueue extends EventEmitter {
    name: string;
    connection: unknown;

    constructor(name: string, options?: { connection?: unknown }) {
      super();
      this.name = name;
      this.connection = options?.connection;
    }
    async add() {
      return { id: "mock-job-id" };
    }
    async close() {}
    async clean() {}
    async drain() {}
    async obliterate() {}
  }

  class MockWorker extends EventEmitter {
    name: string;
    connection: unknown;

    constructor(
      name: string,
      _processor: unknown,
      options?: { connection?: unknown },
    ) {
      super();
      this.name = name;
      this.connection = options?.connection;
    }
    async run() {}
    async close() {}
    async drain() {}
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
    Job: class MockJob {
      id = "mock-job-id";
      data: unknown;
      constructor(data: unknown) {
        this.data = data;
      }
    },
  };
});
