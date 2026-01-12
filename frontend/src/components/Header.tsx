import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

export default function Header() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <header className="header">
      <Link to="/" className="logo">
        {t('app.title')}
      </Link>

      {/* Desktop navigation */}
      <nav className="desktop-nav">
        <Link to="/auctions" className="btn btn-secondary">
          {t('nav.auctions')}
        </Link>
        <Link to="/auctions/create" className="btn btn-primary">
          {t('nav.create')}
        </Link>
        <Link to="/transactions" className="btn btn-secondary">
          {t('transactions.title')}
        </Link>
      </nav>

      {/* Desktop balance & user */}
      <div className="desktop-user-info">
        <Link to="/balance" className="balance-chip">
          <span className="balance-amount">{user?.balance || 0}</span>
          <span className="balance-currency">{t('balance.currency')}</span>
        </Link>
        <Link to="/profile" className="user-avatar">
          {(user?.firstName || user?.username || '?').charAt(0).toUpperCase()}
        </Link>
      </div>

      {/* Mobile: show balance and avatar */}
      <div className="mobile-header-right">
        <Link to="/balance" className="balance-chip">
          <span className="balance-amount">{user?.balance || 0}</span>
          <span className="balance-currency">{t('balance.currency')}</span>
        </Link>
        <Link to="/profile" className="user-avatar">
          {(user?.firstName || user?.username || '?').charAt(0).toUpperCase()}
        </Link>
      </div>
    </header>
  );
}
