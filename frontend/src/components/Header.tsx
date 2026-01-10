import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useNotification } from '../context/NotificationContext';
import * as api from '../api';
import { useState } from 'react';

export default function Header() {
  const { user, logout, updateBalance } = useAuth();
  const { showNotification } = useNotification();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleDeposit = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { balance, frozenBalance } = await api.deposit(1000);
      updateBalance(balance, frozenBalance);
      showNotification('Deposited 1000 successfully', 'success');
    } catch (error) {
      const message = (error as Error).message || 'Deposit failed';
      showNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (loading || !user || user.balance < 1000) return;
    setLoading(true);
    try {
      const { balance, frozenBalance } = await api.withdraw(1000);
      updateBalance(balance, frozenBalance);
      showNotification('Withdrew 1000 successfully', 'success');
    } catch (error) {
      const message = (error as Error).message || 'Withdrawal failed';
      showNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="header">
      <Link to="/" className="logo">
        Gift Auction
      </Link>

      <nav className="flex gap-4 items-center">
        <Link to="/auctions" className="btn btn-secondary">
          Auctions
        </Link>
        <Link to="/auctions/create" className="btn btn-primary">
          Create Auction
        </Link>
        <Link to="/transactions" className="btn btn-secondary">
          Transactions
        </Link>
      </nav>

      <div className="user-info">
        <div className="balance-display">
          <span>Balance: <strong>{user?.balance || 0}</strong></span>
          {user && user.frozenBalance > 0 && (
            <span className="text-muted"> (Frozen: {user.frozenBalance})</span>
          )}
          <div className="balance-controls">
            <button
              className="balance-btn plus"
              onClick={handleDeposit}
              disabled={loading}
              title="Add 1000"
            >
              +
            </button>
            <button
              className="balance-btn minus"
              onClick={handleWithdraw}
              disabled={loading || !user || user.balance < 1000}
              title="Remove 1000"
            >
              -
            </button>
          </div>
        </div>
        <span>{user?.username}</span>
        <button className="btn btn-secondary" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
