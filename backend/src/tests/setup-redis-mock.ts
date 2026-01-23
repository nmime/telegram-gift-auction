/**
 * Global Test Setup
 * Includes Redis mock and Nestia mock for testing without transforms
 */

import { vi } from "vitest";
import RedisMock from "ioredis-mock";
import { EventEmitter } from "events";
import {
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  Headers,
} from "@nestjs/common";

// Mock ioredis globally across all test files
vi.mock("ioredis", () => ({ default: RedisMock }));

// Mock @nestia/core to avoid transform requirement in tests
// This replaces nestia decorators with NestJS equivalents
vi.mock("@nestia/core", () => {
  // Create a typed route decorator that falls back to NestJS decorators
  const createTypedRoute = () => ({
    Get: (path?: string) => Get(path),
    Post: (path?: string) => Post(path),
    Put: (path?: string) => Put(path),
    Patch: (path?: string) => Patch(path),
    Delete: (path?: string) => Delete(path),
  });

  // TypedBody decorator - falls back to NestJS Body
  const TypedBody = () => Body();

  // TypedQuery decorator - falls back to NestJS Query
  const TypedQuery = () => Query();

  // TypedParam decorator - falls back to NestJS Param
  const TypedParam = (key?: string) => (key ? Param(key) : Param());

  // TypedHeader decorator - returns a parameter decorator that extracts header value
  const TypedHeader = (key: string, _defaultValue?: string) => Headers(key);

  // TypedHeaders decorator - falls back to NestJS Headers
  const TypedHeaders = () => Headers();

  // TypedException decorator - just returns a pass-through decorator
  const TypedException = () => {
    return (_target: unknown, _key?: string, _descriptor?: unknown) => {};
  };

  return {
    TypedRoute: createTypedRoute(),
    TypedBody,
    TypedQuery,
    TypedParam,
    TypedHeader,
    TypedHeaders,
    TypedException,
    // For direct imports
    default: {
      TypedRoute: createTypedRoute(),
      TypedBody,
      TypedQuery,
      TypedParam,
      TypedHeader,
      TypedHeaders,
      TypedException,
    },
  };
});

// Mock BullMQ's Queue and Worker classes since they use Lua scripts that ioredis-mock doesn't support
vi.mock("bullmq", () => {
  class MockQueue extends EventEmitter {
    name: string;
    connection: unknown;

    constructor(name: string, options?: { connection?: unknown }) {
      super();
      this.name = name;
      this.connection = options?.connection;
    }
    async add() {
      return await Promise.resolve({ id: "mock-job-id" });
    }
    async close() {
      await Promise.resolve();
    }
    async clean() {
      await Promise.resolve();
    }
    async drain() {
      await Promise.resolve();
    }
    async obliterate() {
      await Promise.resolve();
    }
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
