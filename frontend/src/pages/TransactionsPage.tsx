import { useState, useEffect } from 'react';
import type { Transaction } from '../types';
import { useNotification } from '../context/NotificationContext';
import LoadingSpinner from '../components/LoadingSpinner';
import * as api from '../api';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { showNotification } = useNotification();

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getTransactions(100);
      setTransactions(data);
    } catch (err) {
      const message = (err as Error).message || 'Failed to load transactions';
      setError(message);
      showNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'deposit':
        return 'text-success';
      case 'withdraw':
        return 'text-danger';
      case 'bid_freeze':
        return 'text-warning';
      case 'bid_unfreeze':
        return 'text-muted';
      case 'bid_win':
        return 'text-danger';
      case 'bid_refund':
        return 'text-success';
      default:
        return '';
    }
  };

  const formatType = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <div>
      <h1>Transaction History</h1>

      {loading ? (
        <div className="card">
          <LoadingSpinner text="Loading transactions..." />
        </div>
      ) : error ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="text-danger" style={{ marginBottom: '16px' }}>{error}</p>
          <button className="btn btn-primary" onClick={loadTransactions}>
            Try Again
          </button>
        </div>
      ) : transactions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="text-muted">No transactions yet</p>
        </div>
      ) : (
        <div className="card">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Type</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Amount (Stars)</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Balance (Stars)</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Frozen (Stars)</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Description</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr
                  key={tx.id}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <td style={{ padding: '12px' }}>
                    <span className={getTypeColor(tx.type)}>{formatType(tx.type)}</span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <span className={tx.type.includes('refund') || tx.type === 'deposit' || tx.type === 'bid_unfreeze' ? 'text-success' : 'text-danger'}>
                      {tx.type.includes('refund') || tx.type === 'deposit' || tx.type === 'bid_unfreeze' ? '+' : '-'}
                      {tx.amount}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {tx.balanceBefore} → {tx.balanceAfter}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {tx.frozenBefore !== undefined && tx.frozenAfter !== undefined ? (
                      `${tx.frozenBefore} → ${tx.frozenAfter}`
                    ) : (
                      '-'
                    )}
                  </td>
                  <td style={{ padding: '12px' }} className="text-muted">
                    {tx.description || '-'}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }} className="text-muted">
                    {new Date(tx.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
