import { useEffect, useRef, useCallback, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { SocketEventMap, SocketEventName } from '../types';
import { getToken } from '../api';

interface UseSocketReturn {
  subscribe: <K extends SocketEventName>(
    event: K,
    callback: (data: SocketEventMap[K]) => void
  ) => () => void;
  isConnected: boolean;
}

export function useSocket(auctionId?: string): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const token = getToken();
    socketRef.current = io(import.meta.env.VITE_SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth: token ? { token } : undefined,
    });

    socketRef.current.on('connect', () => {
      setIsConnected(true);
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, []);

  useEffect(() => {
    if (auctionId && socketRef.current) {
      socketRef.current.emit('join-auction', auctionId);

      return () => {
        socketRef.current?.emit('leave-auction', auctionId);
      };
    }
    return undefined;
  }, [auctionId]);

  const subscribe = useCallback(
    <K extends SocketEventName>(
      event: K,
      callback: (data: SocketEventMap[K]) => void
    ): (() => void) => {
      const socket = socketRef.current;
      if (!socket) {
        return (): void => { /* noop */ };
      }

      socket.on(event as string, callback as (...args: unknown[]) => void);

      return () => {
        socket.off(event as string, callback as (...args: unknown[]) => void);
      };
    },
    []
  );

  return {
    subscribe,
    isConnected,
  };
}
