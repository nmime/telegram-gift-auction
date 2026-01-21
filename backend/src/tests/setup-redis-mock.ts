/**
 * Global Redis Mock Setup for All Tests
 * Uses ioredis-mock to provide a fully functional Redis mock for testing
 */

import RedisMock from "ioredis-mock";

// Mock ioredis globally across all test files
jest.mock("ioredis", () => RedisMock);
