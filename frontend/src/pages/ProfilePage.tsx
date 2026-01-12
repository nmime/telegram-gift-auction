import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, logout, isTelegramMiniApp } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : user?.username || '';

  return (
    <div>
      <div className="profile-header">
        <div className="profile-avatar-large">
          {(user?.firstName || user?.username || '?').charAt(0).toUpperCase()}
        </div>
        <div className="profile-name">{displayName}</div>
        {user?.username && (
          <div className="profile-username">@{user.username}</div>
        )}
      </div>

      <div className="profile-stats">
        <div className="profile-stat">
          <div className="profile-stat-value">{user?.balance || 0}</div>
          <div className="profile-stat-label">{t('balance.available')}</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-value">{user?.frozenBalance || 0}</div>
          <div className="profile-stat-label">{t('balance.frozen')}</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-value">
            {(user?.balance || 0) + (user?.frozenBalance || 0)}
          </div>
          <div className="profile-stat-label">{t('balance.total')}</div>
        </div>
      </div>

      {!isTelegramMiniApp && (
        <div className="card">
          <button
            className="btn btn-danger"
            style={{ width: '100%' }}
            onClick={handleLogout}
          >
            {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
