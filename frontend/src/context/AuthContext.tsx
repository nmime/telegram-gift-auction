import { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, TelegramWidgetUser } from '../types';
import * as api from '../api';
import { setOnUnauthorized, clearToken } from '../api';
import { useNotification } from './NotificationContext';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  isTelegramMiniApp: boolean;
  loginWithTelegramWidget: (telegramUser: TelegramWidgetUser) => Promise<void>;
  loginWithTelegramMiniApp: (initData: string) => Promise<void>;
  logout: () => Promise<void>;
  updateBalance: (balance: number, frozenBalance: number) => void;
  refreshBalance: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Check if running inside Telegram Mini App (must have initData)
function checkIsTelegramMiniApp(): boolean {
  return typeof window !== 'undefined' &&
    window.Telegram?.WebApp !== undefined &&
    !!window.Telegram.WebApp.initData;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTelegramMiniApp] = useState(() => checkIsTelegramMiniApp());
  const { showNotification } = useNotification();

  const handleUnauthorized = useCallback(() => {
    setUser(null);
    showNotification(t('errors.unauthorized'), 'warning');
  }, [showNotification, t]);

  useEffect(() => {
    setOnUnauthorized(handleUnauthorized);
    return () => setOnUnauthorized(null);
  }, [handleUnauthorized]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // First try to check existing token
      const userData = await api.getMe();
      if (userData) {
        setUser(userData);
        setLoading(false);
        return;
      }
    } catch {
      // Token invalid or missing
    }

    // If in Telegram Mini App and no valid token, auto-login with initData
    if (isTelegramMiniApp) {
      try {
        const initData = window.Telegram?.WebApp?.initData;
        if (initData) {
          const response = await api.loginWithTelegramMiniApp(initData);
          setUser(response.user);
          // Expand the Mini App
          window.Telegram?.WebApp?.expand();
          window.Telegram?.WebApp?.ready();
        }
      } catch (error) {
        console.error('Telegram MiniApp auto-login failed:', error);
      }
    }

    setLoading(false);
  };

  const loginWithTelegramWidget = async (telegramUser: TelegramWidgetUser) => {
    const response = await api.loginWithTelegramWidget(telegramUser);
    setUser(response.user);
    const displayName = response.user.firstName || response.user.username;
    showNotification(t('auth.welcome', { name: displayName }), 'success');
  };

  const loginWithTelegramMiniApp = async (initData: string) => {
    const response = await api.loginWithTelegramMiniApp(initData);
    setUser(response.user);
    const displayName = response.user.firstName || response.user.username;
    showNotification(t('auth.welcome', { name: displayName }), 'success');
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
    <AuthContext.Provider value={{
      user,
      loading,
      isTelegramMiniApp,
      loginWithTelegramWidget,
      loginWithTelegramMiniApp,
      logout,
      updateBalance,
      refreshBalance
    }}>
      {children}
    </AuthContext.Provider>
  );
}
