import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, TelegramWidgetUser } from '../types';
import * as api from '../api';
import { setOnUnauthorized, clearToken } from '../api';
import { useNotification } from './NotificationContext';
import { changeLanguage, mapToSupportedLanguage, saveLanguagePreference } from '../i18n';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  isTelegramMiniApp: boolean;
  loginWithTelegramWidget: (telegramUser: TelegramWidgetUser) => Promise<void>;
  loginWithTelegramMiniApp: (initData: string) => Promise<void>;
  logout: () => Promise<void>;
  updateBalance: (balance: number, frozenBalance: number) => void;
  refreshBalance: () => Promise<void>;
  setLanguage: (lang: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

function checkIsTelegramMiniApp(): boolean {
  return typeof window !== 'undefined' &&
    window.Telegram?.WebApp !== undefined &&
    !!window.Telegram.WebApp.initData;
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
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

  const syncLanguageFromUser = useCallback((userData: User) => {
    if (userData.languageCode) {
      const lang = mapToSupportedLanguage(userData.languageCode);
      saveLanguagePreference(lang);
      changeLanguage(lang);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const userData = await api.getMe();
      if (userData) {
        setUser(userData);
        syncLanguageFromUser(userData);
        setLoading(false);
        return;
      }
    } catch {
      // Ignore auth check errors - user is not logged in
    }

    if (isTelegramMiniApp) {
      try {
        const initData = window.Telegram?.WebApp.initData;
        if (initData !== undefined && initData !== '') {
          const response = await api.loginWithTelegramMiniApp(initData);
          setUser(response.user);
          syncLanguageFromUser(response.user);
          window.Telegram?.WebApp.expand();
          window.Telegram?.WebApp.ready();
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Telegram MiniApp auto-login failed:', error);
      }
    }

    setLoading(false);
  }, [isTelegramMiniApp, syncLanguageFromUser]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const loginWithTelegramWidget = async (telegramUser: TelegramWidgetUser) => {
    const response = await api.loginWithTelegramWidget(telegramUser);
    setUser(response.user);
    syncLanguageFromUser(response.user);
    const displayName = response.user.firstName ?? response.user.username;
    showNotification(t('auth.welcome', { name: displayName }), 'success');
  };

  const loginWithTelegramMiniApp = async (initData: string) => {
    const response = await api.loginWithTelegramMiniApp(initData);
    setUser(response.user);
    syncLanguageFromUser(response.user);
    const displayName = response.user.firstName ?? response.user.username;
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
      } catch {
        // Silently ignore balance refresh errors
      }
    }
  };

  const setLanguage = async (lang: string) => {
    const supportedLang = ['en', 'ru'].includes(lang) ? lang : 'en';
    changeLanguage(supportedLang);
    if (user) {
      try {
        await api.updateLanguage(supportedLang);
        setUser({ ...user, languageCode: supportedLang });
      } catch {
        // Silently ignore language update errors - local change already applied
      }
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
      refreshBalance,
      setLanguage
    }}>
      {children}
    </AuthContext.Provider>
  );
}
