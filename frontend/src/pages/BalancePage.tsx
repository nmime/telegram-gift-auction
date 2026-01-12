import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useNotification } from '../context/NotificationContext';
import * as api from '../api';

export default function BalancePage() {
  const { t } = useTranslation();
  const { user, updateBalance } = useAuth();
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('1000');

  const handleDeposit = async () => {
    if (loading) return;
    const value = parseInt(amount) || 0;
    if (value <= 0) return;

    setLoading(true);
    try {
      const { balance, frozenBalance } = await api.deposit(value);
      updateBalance(balance, frozenBalance);
      showNotification(t('balance.depositSuccess', { amount: value }), 'success');
    } catch (error) {
      const message = (error as Error).message || t('errors.unknown');
      showNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (loading || !user) return;
    const value = parseInt(amount) || 0;
    if (value <= 0 || value > user.balance) return;

    setLoading(true);
    try {
      const { balance, frozenBalance } = await api.withdraw(value);
      updateBalance(balance, frozenBalance);
      showNotification(t('balance.withdrawSuccess', { amount: value }), 'success');
    } catch (error) {
      const message = (error as Error).message || t('errors.unknown');
      showNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const quickAmounts = [100, 500, 1000, 5000];

  return (
    <div>
      <h1>{t('balance.title')}</h1>

      {/* Balance cards */}
      <div className="balance-cards">
        <div className="balance-card available">
          <div className="balance-card-label">{t('balance.available')}</div>
          <div className="balance-card-value">{user?.balance || 0}</div>
          <div className="balance-card-currency">{t('balance.currency')}</div>
        </div>

        <div className="balance-card frozen">
          <div className="balance-card-label">{t('balance.frozen')}</div>
          <div className="balance-card-value">{user?.frozenBalance || 0}</div>
          <div className="balance-card-currency">{t('balance.currency')}</div>
        </div>
      </div>

      {/* Amount input */}
      <div className="card">
        <div className="form-group">
          <label>{t('balance.depositAmount')}</label>
          <input
            type="number"
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="1"
            disabled={loading}
          />
        </div>

        {/* Quick amount buttons */}
        <div className="quick-amounts">
          {quickAmounts.map((val) => (
            <button
              key={val}
              className={`btn btn-sm ${amount === String(val) ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setAmount(String(val))}
              disabled={loading}
            >
              {val}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="balance-actions">
          <button
            className="btn btn-success btn-lg"
            onClick={handleDeposit}
            disabled={loading || parseInt(amount) <= 0}
          >
            {t('balance.deposit')}
          </button>
          <button
            className="btn btn-danger btn-lg"
            onClick={handleWithdraw}
            disabled={loading || !user || parseInt(amount) <= 0 || parseInt(amount) > user.balance}
          >
            {t('balance.withdraw')}
          </button>
        </div>
      </div>
    </div>
  );
}
