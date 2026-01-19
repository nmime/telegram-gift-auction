/**
 * Test Utilities - Event-based waiting instead of arbitrary sleeps
 */
import { Socket } from 'socket.io-client';
import api from '../../src/api';

const HOST = `http://localhost:${process.env.PORT ?? 4000}/api`;

/**
 * Wait for a condition to become true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number; message?: string } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50, message = 'Condition not met' } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`Timeout: ${message}`);
}

/**
 * Wait for an array to reach a certain length
 */
export async function waitForCount<T>(
  arr: T[],
  count: number,
  options: { timeout?: number } = {}
): Promise<void> {
  return waitFor(() => arr.length >= count, {
    ...options,
    message: `Expected ${count} items, got ${arr.length}`,
  });
}

/**
 * Wait for a WebSocket event and return the data
 */
export function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  options: { timeout?: number } = {}
): Promise<T> {
  const { timeout = 5000 } = options;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    const handler = (data: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };

    socket.on(event, handler);
  });
}

/**
 * Wait for multiple WebSocket events
 */
export function collectEvents<T = unknown>(
  socket: Socket,
  event: string,
  count: number,
  options: { timeout?: number } = {}
): Promise<T[]> {
  const { timeout = 10000 } = options;
  const events: T[] = [];

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      if (events.length > 0) {
        resolve(events); // Return what we got
      } else {
        reject(new Error(`Timeout: expected ${count} ${event} events, got ${events.length}`));
      }
    }, timeout);

    const handler = (data: T) => {
      events.push(data);
      if (events.length >= count) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(events);
      }
    };

    socket.on(event, handler);
  });
}

/**
 * Create authenticated API connection
 */
export async function createConnection(username: string): Promise<api.IConnection> {
  const connection: api.IConnection = {
    host: HOST,
    headers: { Authorization: '' },
  };

  const auth = await api.functional.api.auth.login(connection, { username });
  connection.headers = { Authorization: `Bearer ${auth.accessToken}` };
  return connection;
}

/**
 * Get auth token for WebSocket connection
 */
export async function getAuthToken(username: string): Promise<string> {
  const authRes = await api.functional.api.auth.login(
    { host: HOST, headers: {} },
    { username }
  );
  return authRes.accessToken;
}

/**
 * Wait for bid lock to be released (minimal delay for Redlock)
 * Only use when absolutely necessary due to distributed locking
 */
export async function waitForLockRelease(): Promise<void> {
  // Redlock default TTL is typically 1000ms, but releases immediately on success
  // 100ms is enough for lock cleanup
  await new Promise((r) => setTimeout(r, 100));
}

/**
 * Retry an operation with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, initialDelay = 100 } = options;
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, initialDelay * Math.pow(2, i)));
      }
    }
  }

  throw lastError;
}

/**
 * Connect WebSocket and join auction room
 */
export async function connectAndJoin(
  wsUrl: string,
  token: string,
  auctionId: string
): Promise<Socket> {
  const { io } = await import('socket.io-client');

  const socket: Socket = io(wsUrl, {
    transports: ['websocket'],
    auth: { token },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);

    socket.on('connect', () => {
      socket.emit('join-auction', auctionId);
    });

    socket.on('join-auction-response', () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return socket;
}

/**
 * Create standard auction config
 */
export function createAuctionConfig(
  title: string,
  options: {
    totalItems?: number;
    rounds?: Array<{ itemsCount: number; durationMinutes: number }>;
    minBidAmount?: number;
    minBidIncrement?: number;
  } = {}
) {
  return {
    title,
    totalItems: options.totalItems ?? 1,
    rounds: options.rounds ?? [{ itemsCount: 1, durationMinutes: 5 }],
    minBidAmount: options.minBidAmount ?? 100,
    minBidIncrement: options.minBidIncrement ?? 10,
    antiSnipingWindowMinutes: 1,
    antiSnipingExtensionMinutes: 1,
    maxExtensions: 3,
    botsEnabled: false,
  };
}
