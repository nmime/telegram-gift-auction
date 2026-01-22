import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import type { TelegramWidgetUser } from '../types';

const BOT_USERNAME: string = (import.meta.env.VITE_BOT_USERNAME as string | undefined) ?? '';
const isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export default function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [widgetLoading, setWidgetLoading] = useState(true);
  const { loginWithTelegramWidget, isTelegramMiniApp } = useAuth();
  const telegramWidgetRef = useRef<HTMLDivElement>(null);

  const handleTelegramAuth = useCallback(async (user: TelegramWidgetUser) => {
    setLoading(true);
    setError('');

    try {
      await loginWithTelegramWidget(user);
    } catch (err) {
      setError((err as Error).message !== '' ? (err as Error).message : t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  }, [loginWithTelegramWidget, t]);

  useEffect(() => {
    // Only show widget if not in Telegram Mini App and bot username is configured
    if (isTelegramMiniApp || BOT_USERNAME === '' || telegramWidgetRef.current === null) {
      setWidgetLoading(false);
      return;
    }

    // Add the Telegram callback to window
    (window as Window & { onTelegramAuth?: (user: TelegramWidgetUser) => Promise<void> }).onTelegramAuth = handleTelegramAuth;

    // Create Telegram Login Widget script
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    script.async = true;

    script.onload = () => {
      // Widget script loaded, give it a moment to render
      setTimeout(() => setWidgetLoading(false), 500);
    };
    script.onerror = () => {
      setWidgetLoading(false);
      setError(t('auth.widgetLoadFailed'));
    };

    telegramWidgetRef.current.appendChild(script);

    return () => {
      delete (window as Window & { onTelegramAuth?: unknown }).onTelegramAuth;
    };
  }, [isTelegramMiniApp, handleTelegramAuth, t]);

  // In Telegram Mini App, show loading while auto-auth happens
  if (isTelegramMiniApp) {
    return (
      <div className="container" style={{ maxWidth: '400px', paddingTop: '100px' }}>
        <div className="card">
          <h1 style={{ textAlign: 'center', marginBottom: '32px' }}>
            {t('app.title')}
          </h1>
          <p className="text-muted" style={{ textAlign: 'center' }}>
            {t('auth.authenticating')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '400px', paddingTop: '100px' }}>
      <div className="card">
        <h1 style={{ textAlign: 'center', marginBottom: '32px' }}>
          {t('app.title')}
        </h1>
        <p className="text-muted" style={{ textAlign: 'center', marginBottom: '32px' }}>
          {t('app.description')}
        </p>

        {/* Telegram Login Widget */}
        {BOT_USERNAME === '' ? (
          <div style={{ padding: '12px', backgroundColor: 'rgba(255,0,0,0.1)', borderRadius: '8px' }}>
            <p className="text-danger" style={{ textAlign: 'center', margin: 0 }}>
              {t('auth.botNotConfigured')}
            </p>
            <p className="text-muted" style={{ textAlign: 'center', fontSize: '12px', marginTop: '8px', marginBottom: 0 }}>
              {t('auth.setBotUsername')}
            </p>
          </div>
        ) : isLocalhost ? (
          <div style={{ padding: '16px', backgroundColor: 'rgba(255,165,0,0.1)', borderRadius: '8px' }}>
            <p style={{ textAlign: 'center', margin: 0, color: 'var(--warning-color, #f0ad4e)' }}>
              {t('auth.localhostWarning')}
            </p>
            <p className="text-muted" style={{ textAlign: 'center', fontSize: '12px', marginTop: '8px', marginBottom: 0 }}>
              {t('auth.useMiniApp')}
            </p>
          </div>
        ) : (
          <>
            {widgetLoading && (
              <p className="text-muted" style={{ textAlign: 'center' }}>
                {t('auth.loadingWidget')}
              </p>
            )}
            <div
              ref={telegramWidgetRef}
              style={{
                display: 'flex',
                justifyContent: 'center',
                minHeight: '44px',
              }}
            />
            {loading && (
              <p className="text-muted" style={{ textAlign: 'center', marginTop: '16px' }}>
                {t('auth.loggingIn')}
              </p>
            )}
            {error !== '' && (
              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'rgba(255,0,0,0.1)', borderRadius: '8px' }}>
                <p className="text-danger" style={{ textAlign: 'center', margin: 0 }}>
                  {error}
                </p>
              </div>
            )}
          </>
        )}

        <p className="text-muted" style={{ textAlign: 'center', marginTop: '24px', fontSize: '14px' }}>
          {t('auth.signIn')}
        </p>
      </div>
    </div>
  );
}
