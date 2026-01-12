import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Auction, LeaderboardEntry, Bid } from '../types';
import { AuctionStatus, BidStatus } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useNotification } from '../context/NotificationContext';
import { useSocket } from '../hooks/useSocket';
import { useCountdown } from '../hooks/useCountdown';
import LoadingSpinner from '../components/LoadingSpinner';
import * as api from '../api';

export default function AuctionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, refreshBalance } = useAuth();
  const { showNotification } = useNotification();

  const [auction, setAuction] = useState<Auction | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myBids, setMyBids] = useState<Bid[]>([]);
  const [minWinningBid, setMinWinningBid] = useState<number | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [bidding, setBidding] = useState(false);
  const [error, setError] = useState('');

  const { subscribe, isConnected } = useSocket(id);
  const loadingRef = useRef(false);
  const lastLoadRef = useRef(0);

  const currentRound = auction?.rounds[auction.currentRound - 1];
  const { formatted: timeLeft, timeLeft: secondsLeft } = useCountdown(currentRound?.endTime);

  const loadData = useCallback(async () => {
    if (!id) return;

    const now = Date.now();
    if (now - lastLoadRef.current < 500) return;

    if (loadingRef.current) return;

    loadingRef.current = true;
    lastLoadRef.current = now;

    try {
      const [auctionData, leaderboardData, bidsData, minBidData] = await Promise.all([
        api.getAuction(id),
        api.getLeaderboard(id),
        api.getMyBids(id),
        api.getMinWinningBid(id),
      ]);

      setAuction(auctionData);
      setLeaderboard(leaderboardData);
      setMyBids(bidsData);
      setMinWinningBid(minBidData.minWinningBid);
      setError('');
    } catch (err) {
      console.error('Failed to load auction:', err);
      setError(t('auction.failedToLoad'));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (isConnected || auction?.status !== AuctionStatus.ACTIVE) {
      return;
    }

    const interval = setInterval(() => {
      loadData();
    }, 5000);

    return () => clearInterval(interval);
  }, [auction?.status, isConnected, loadData]);

  useEffect(() => {
    const unsubAuction = subscribe('auction-update', (data) => {
      setAuction((prev) => prev ? { ...prev, ...data } : prev);
      loadData();
    });

    const unsubBid = subscribe('new-bid', () => {
      loadData();
    });

    const unsubAntiSniping = subscribe('anti-sniping', (data) => {
      showNotification(t('auction.antiSnipingExtension', { count: data.extensionCount }), 'warning');
      loadData();
    });

    const unsubRoundComplete = subscribe('round-complete', (data) => {
      showNotification(t('auction.roundComplete', { round: data.roundNumber, count: data.winnersCount }), 'success');
      loadData();
      refreshBalance();
    });

    const unsubAuctionComplete = subscribe('auction-complete', () => {
      showNotification(t('auction.auctionComplete'), 'success');
      loadData();
      refreshBalance();
    });

    return () => {
      unsubAuction();
      unsubBid();
      unsubAntiSniping();
      unsubRoundComplete();
      unsubAuctionComplete();
    };
  }, [subscribe, loadData, refreshBalance, showNotification]);

  const handleStartAuction = async () => {
    if (!id) return;

    try {
      const started = await api.startAuction(id);
      setAuction(started);
      showNotification(t('auction.auctionStarted'), 'success');
    } catch (err) {
      const message = (err as Error).message || t('errors.unknown');
      setError(message);
      showNotification(message, 'error');
    }
  };

  const handlePlaceBid = async () => {
    if (!id || !bidAmount) return;

    const amount = parseInt(bidAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      setError(t('auction.invalidBid'));
      return;
    }

    const minBid = minWinningBid || auction?.minBidAmount || 0;
    if (amount < minBid) {
      setError(t('auction.bidTooLow', { min: minBid }));
      return;
    }

    if (user && amount > user.balance) {
      setError(t('auction.insufficientBalance'));
      return;
    }

    setBidding(true);
    setError('');

    try {
      const { bid, auction: updatedAuction } = await api.placeBid(id, amount);
      setAuction(updatedAuction);
      setMyBids((prev) => {
        const existing = prev.find((b) => b.id === bid.id);
        if (existing) {
          return prev.map((b) => (b.id === bid.id ? bid : b));
        }
        return [bid, ...prev];
      });
      setBidAmount('');
      showNotification(t('auction.bidPlacedAmount', { amount }), 'success');
      await refreshBalance();
      await loadData();
    } catch (err) {
      const message = (err as Error).message || t('errors.unknown');
      setError(message);
      showNotification(message, 'error');
    } finally {
      setBidding(false);
    }
  };

  const myActiveBid = myBids.find((b) => b.status === BidStatus.ACTIVE);
  const isInAntiSnipingWindow =
    currentRound && auction && secondsLeft <= auction.antiSnipingWindowMinutes * 60;

  if (loading) {
    return (
      <div className="card">
        <LoadingSpinner text={t('auction.loadingAuction')} />
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <p>{t('auction.auctionNotFound')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/auctions')}>
          {t('auction.backToAuctions')}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center" style={{ marginBottom: '24px' }}>
        <div>
          <h1>{auction.title}</h1>
          {auction.description && <p className="text-muted">{auction.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {!isConnected && auction.status === AuctionStatus.ACTIVE && (
            <span className="badge badge-pending" title="Using polling fallback">
              {t('auction.reconnecting')}
            </span>
          )}
          <span
            className={`badge ${
              auction.status === AuctionStatus.ACTIVE
                ? 'badge-active'
                : auction.status === AuctionStatus.PENDING
                ? 'badge-pending'
                : 'badge-completed'
            }`}
          >
            {t(`auction.${auction.status}`)}
          </span>
        </div>
      </div>

      {auction.status === AuctionStatus.PENDING && (
        <div className="card">
          <h3>{t('auction.auctionNotStarted')}</h3>
          <p className="text-muted" style={{ marginBottom: '16px' }}>
            {t('auction.waitingToStart')}
          </p>
          <button className="btn btn-success" onClick={handleStartAuction}>
            {t('auction.startAuction')}
          </button>
        </div>
      )}

      {auction.status === AuctionStatus.ACTIVE && currentRound && (
        <>
          {isInAntiSnipingWindow && (
            <div className="anti-sniping-alert">
              <span>{t('auction.antiSnipingActive')}</span>
            </div>
          )}

          <div className="round-info">
            <div className="round-stat">
              <div className="round-stat-value">{auction.currentRound}</div>
              <div className="round-stat-label">{t('auction.round')}</div>
            </div>
            <div className="round-stat">
              <div className="round-stat-value">{currentRound.itemsCount}</div>
              <div className="round-stat-label">{t('auction.itemsThisRound')}</div>
            </div>
            <div className="round-stat">
              <div className="timer">{timeLeft}</div>
              <div className="round-stat-label">{t('auction.timeLeft')}</div>
            </div>
            <div className="round-stat">
              <div className="round-stat-value">{currentRound.extensionsCount}</div>
              <div className="round-stat-label">{t('auction.extensions')}</div>
            </div>
            <div className="round-stat">
              <div className="round-stat-value">{minWinningBid || auction.minBidAmount} Stars</div>
              <div className="round-stat-label">{t('auction.minWinningBid')}</div>
            </div>
          </div>

          <div className="card">
            <h3>{t('auction.placeYourBid')}</h3>

            {myActiveBid && (
              <p style={{ marginBottom: '12px' }}>
                {t('auction.currentBid', { amount: myActiveBid.amount })}
                {leaderboard.findIndex((l) => l.username === user?.username) < currentRound.itemsCount && (
                  <span className="text-success"> ({t('auction.winningBid')})</span>
                )}
              </p>
            )}

            {error && <p className="text-danger" style={{ marginBottom: '12px' }}>{error}</p>}

            <div className="bid-form">
              <input
                type="number"
                className="input"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                placeholder={t('auction.min', { amount: minWinningBid || auction.minBidAmount })}
                disabled={bidding}
                min={1}
              />
              <button
                className="btn btn-primary"
                onClick={handlePlaceBid}
                disabled={bidding || !bidAmount}
              >
                {bidding ? t('auction.placing') : myActiveBid ? t('auction.increaseBid') : t('auction.placeBid')}
              </button>
            </div>

            <p className="text-muted" style={{ marginTop: '12px', fontSize: '14px' }}>
              {t('auction.availableBalance', { amount: user?.balance || 0 })}
            </p>
          </div>
        </>
      )}

      {auction.status === AuctionStatus.COMPLETED && (
        <div className="card">
          <h3 className="text-success">{t('auction.auctionCompleted')}</h3>
          <p className="text-muted">
            {t('auction.auctionEnded')}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h3>{t('auction.leaderboard')}</h3>
          {leaderboard.length === 0 ? (
            <p className="text-muted">{t('auction.noBidsYet')}</p>
          ) : (
            <div>
              {leaderboard.map((entry, index) => (
                <div
                  key={index}
                  className={`leaderboard-item ${
                    entry.isWinning ? 'winning' : ''
                  } ${entry.username === user?.username ? 'my-bid' : ''}`}
                >
                  <div className={`rank ${index < 3 ? 'top-3' : ''}`}>
                    {entry.status === BidStatus.WON ? t('auction.itemNumber', { number: entry.itemNumber }) : entry.rank}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div>
                      {entry.username}
                      {entry.isBot && <span className="text-muted"> ({t('auction.bot')})</span>}
                    </div>
                    <div className="text-muted" style={{ fontSize: '12px' }}>
                      {new Date(entry.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 'bold' }}>{entry.amount} Stars</div>
                    {entry.status === BidStatus.WON && (
                      <span className="text-success" style={{ fontSize: '12px' }}>{t('auction.won')}</span>
                    )}
                    {entry.isWinning && entry.status === BidStatus.ACTIVE && (
                      <span className="text-success" style={{ fontSize: '12px' }}>{t('bids.winning')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3>{t('auction.info')}</h3>
          <div style={{ marginBottom: '16px' }}>
            <p><strong>{t('auction.totalItems')}:</strong> {auction.totalItems}</p>
            <p><strong>{t('auction.minBid')}:</strong> {auction.minBidAmount} Stars</p>
            <p><strong>{t('auction.minIncrement')}:</strong> {auction.minBidIncrement} Stars</p>
            <p><strong>{t('auction.antiSnipingWindow')}:</strong> {auction.antiSnipingWindowMinutes} min</p>
            <p><strong>{t('auction.extensionDuration')}:</strong> {auction.antiSnipingExtensionMinutes} min</p>
            <p><strong>{t('auction.maxExtensions')}:</strong> {auction.maxExtensions}</p>
            <p><strong>{t('auction.bots')}:</strong> {auction.botsEnabled ? t('auction.botsEnabled', { count: auction.botCount }) : t('auction.botsDisabled')}</p>
          </div>

          <h4>{t('auction.rounds')}</h4>
          {auction.roundsConfig.map((round, index) => {
            const roundState = auction.rounds[index];
            return (
              <div
                key={index}
                style={{
                  padding: '8px 12px',
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '4px',
                  marginBottom: '8px',
                }}
              >
                <div className="flex justify-between">
                  <span>{t('auction.roundNumber', { number: index + 1 })}</span>
                  <span>{t('auction.itemsMinutes', { items: round.itemsCount, minutes: round.durationMinutes })}</span>
                </div>
                {roundState && (
                  <div className="text-muted" style={{ fontSize: '12px' }}>
                    {roundState.completed
                      ? t('auction.completedWinners', { count: roundState.winnerBidIds.length })
                      : index + 1 === auction.currentRound
                      ? t('auction.inProgress')
                      : t('auction.pending')}
                  </div>
                )}
              </div>
            );
          })}

          {myBids.length > 0 && (
            <>
              <h4 style={{ marginTop: '16px' }}>{t('auction.yourBids')}</h4>
              {myBids.map((bid) => (
                <div
                  key={bid.id}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '4px',
                    marginBottom: '8px',
                  }}
                >
                  <div className="flex justify-between">
                    <span>{bid.amount} Stars</span>
                    <span
                      className={
                        bid.status === BidStatus.WON
                          ? 'text-success'
                          : bid.status === BidStatus.REFUNDED
                          ? 'text-warning'
                          : ''
                      }
                    >
                      {bid.status === BidStatus.WON ? t('auction.won') : bid.status === BidStatus.REFUNDED ? t('auction.refunded') : bid.status}
                      {bid.itemNumber && ` (${t('auction.itemNumber', { number: bid.itemNumber })})`}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
