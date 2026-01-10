import { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { User } from '../types';
import * as api from '../api';
import { setOnUnauthorized, clearToken } from '../api';
import { useNotification } from './NotificationContext';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  updateBalance: (balance: number, frozenBalance: number) => void;
  refreshBalance: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { showNotification } = useNotification();

  const handleUnauthorized = useCallback(() => {
    setUser(null);
    showNotification('Session expired. Please log in again.', 'warning');
  }, [showNotification]);

  useEffect(() => {
    setOnUnauthorized(handleUnauthorized);
    return () => setOnUnauthorized(null);
  }, [handleUnauthorized]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const userData = await api.getMe();
      setUser(userData);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string) => {
    const response = await api.login(username);
    setUser(response.user);
    showNotification(`Welcome, ${response.user.username}!`, 'success');
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      clearToken();
    }
    setUser(null);
  };

  const updateBalance = (balance: number, frozenBalance: number) => {
    if (user) {
      setUser({ ...user, balance, frozenBalance });
    }
  };

  const refreshBalance = async () => {
    if (user) {
      try {
        const { balance, frozenBalance } = await api.getBalance();
        setUser({ ...user, balance, frozenBalance });
      } catch {}
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateBalance, refreshBalance }}>
      {children}
    </AuthContext.Provider>
  );
}
