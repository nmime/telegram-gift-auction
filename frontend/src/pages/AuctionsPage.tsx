import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Auction } from '../types';
import { AuctionStatus } from '../types';
import { useNotification } from '../context/NotificationContext';
import { SkeletonAuctionGrid } from '../components/Skeleton';
import * as api from '../api';

export default function AuctionsPage() {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<string>('');
  const { showNotification } = useNotification();

  const loadAuctions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAuctions(filter || undefined);
      setAuctions(data);
    } catch (err) {
      const message = (err as Error).message || 'Failed to load auctions';
      setError(message);
      showNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, showNotification]);

  useEffect(() => {
    loadAuctions();
  }, [loadAuctions]);

  const getStatusBadgeClass = (status: AuctionStatus) => {
    switch (status) {
      case AuctionStatus.ACTIVE:
        return 'badge badge-active';
      case AuctionStatus.PENDING:
        return 'badge badge-pending';
      case AuctionStatus.COMPLETED:
        return 'badge badge-completed';
      default:
        return 'badge';
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center" style={{ marginBottom: '24px' }}>
        <h1>Auctions</h1>
        <div className="flex gap-2">
          <button
            className={`btn ${filter === '' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('')}
          >
            All
          </button>
          <button
            className={`btn ${filter === 'active' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('active')}
          >
            Active
          </button>
          <button
            className={`btn ${filter === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('pending')}
          >
            Pending
          </button>
          <button
            className={`btn ${filter === 'completed' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('completed')}
          >
            Completed
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonAuctionGrid count={4} />
      ) : error ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="text-danger" style={{ marginBottom: '16px' }}>{error}</p>
          <button className="btn btn-primary" onClick={loadAuctions}>
            Try Again
          </button>
        </div>
      ) : auctions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="text-muted">No auctions found</p>
          <Link to="/auctions/create" className="btn btn-primary" style={{ marginTop: '16px' }}>
            Create Your First Auction
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {auctions.map((auction) => (
            <Link
              key={auction.id}
              to={`/auctions/${auction.id}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="card auction-card">
                <div className="flex justify-between items-center" style={{ marginBottom: '12px' }}>
                  <h3 style={{ margin: 0 }}>{auction.title}</h3>
                  <span className={getStatusBadgeClass(auction.status)}>
                    {auction.status}
                  </span>
                </div>

                {auction.description && (
                  <p className="text-muted" style={{ marginBottom: '12px' }}>
                    {auction.description}
                  </p>
                )}

                <div className="flex gap-4">
                  <div>
                    <span className="text-muted">Items: </span>
                    <strong>{auction.totalItems}</strong>
                  </div>
                  <div>
                    <span className="text-muted">Rounds: </span>
                    <strong>{auction.roundsConfig.length}</strong>
                  </div>
                  <div>
                    <span className="text-muted">Min Bid: </span>
                    <strong>{auction.minBidAmount} Stars</strong>
                  </div>
                </div>

                {auction.status === AuctionStatus.ACTIVE && auction.rounds.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <span className="text-muted">Current Round: </span>
                    <strong>{auction.currentRound} / {auction.roundsConfig.length}</strong>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
