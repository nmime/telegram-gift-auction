/**
 * Global Redis Mock Setup for All Tests
 * Uses ioredis-mock to provide a fully functional Redis mock for testing
 */

import RedisMock from "ioredis-mock";

// Mock ioredis globally across all test files
jest.mock("ioredis", () => RedisMock);

// Mock BullMQ's Queue and Worker classes since they use Lua scripts that ioredis-mock doesn't support
jest.mock("bullmq", () => {
  const EventEmitter = require("events");

  class MockQueue extends EventEmitter {
    constructor(name: string, options: any) {
      super();
      this.name = name;
      this.connection = options?.connection;
    }
    name: string;
    connection: any;
    async add() {
      return { id: "mock-job-id" };
    }
    async close() {}
    async clean() {}
    async drain() {}
    async obliterate() {}
  }

  class MockWorker extends EventEmitter {
    constructor(name: string, processor: any, options: any) {
      super();
      this.name = name;
      this.connection = options?.connection;
    }
    name: string;
    connection: any;
    async run() {}
    async close() {}
    async drain() {}
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
    Job: class MockJob {
      id = "mock-job-id";
      data: any;
      constructor(data: any) {
        this.data = data;
      }
    },
  };
});
