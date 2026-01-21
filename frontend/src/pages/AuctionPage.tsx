import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Auction, LeaderboardEntry, PastWinnerEntry, Bid } from '../types';
import { AuctionStatus, BidStatus } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useNotification } from '../context/NotificationContext';
import { useSocket } from '../hooks/useSocket';
import { useCountdown } from '../hooks/useCountdown';
import { SkeletonAuctionPage } from '../components/Skeleton';
import * as api from '../api';

export default function AuctionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, refreshBalance } = useAuth();
  const { showNotification } = useNotification();

  const [auction, setAuction] = useState<Auction | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [pastWinners, setPastWinners] = useState<PastWinnerEntry[]>([]);
  const [myBids, setMyBids] = useState<Bid[]>([]);
  const [minWinningBid, setMinWinningBid] = useState<number | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [bidding, setBidding] = useState(false);
  const [error, setError] = useState('');

  const { subscribe, isConnected } = useSocket(id);
  const loadingRef = useRef(false);
  const lastLoadRef = useRef(0);
  const mountedRef = useRef(true);

  const currentRound = auction?.rounds[auction.currentRound - 1];
  const { formatted: timeLeft, timeLeft: secondsLeft } = useCountdown(currentRound?.endTime);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!id) return;

    const now = Date.now();
    if (now - lastLoadRef.current < 500) return;

    if (loadingRef.current) return;

    loadingRef.current = true;
    lastLoadRef.current = now;

    try {
      const [auctionData, leaderboardResponse, bidsData, minBidData] = await Promise.all([
        api.getAuction(id),
        api.getLeaderboard(id),
        api.getMyBids(id),
        api.getMinWinningBid(id),
      ]);

      if (!mountedRef.current) return;

      setAuction(auctionData);
      setLeaderboard(leaderboardResponse.leaderboard);
      setPastWinners(leaderboardResponse.pastWinners);
      setMyBids(bidsData);
      setMinWinningBid(minBidData.minWinningBid);
      setError('');
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('Failed to load auction:', err);
      setError(t('auction.failedToLoad'));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      loadingRef.current = false;
    }
  }, [id, t]);

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
  }, [subscribe, loadData, refreshBalance, showNotification, t]);

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
    if (!id || !bidAmount || !user) return;

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

    if (amount > user.balance) {
      setError(t('auction.insufficientBalance'));
      return;
    }

    setBidding(true);
    setError('');

    const previousLeaderboard = [...leaderboard];
    const previousMyBids = [...myBids];

    const optimisticEntry: LeaderboardEntry = {
      rank: 0,
      amount,
      username: user.username,
      isBot: false,
      isWinning: false,
      createdAt: new Date().toISOString(),
    };

    setLeaderboard((prev) => {
      const filtered = prev.filter((e) => e.username !== user.username);
      const updated = [...filtered, optimisticEntry].sort((a, b) => b.amount - a.amount);
      const itemsInRound = auction?.rounds[auction.currentRound - 1]?.itemsCount || 1;
      return updated.map((e, i) => ({ ...e, rank: i + 1, isWinning: i < itemsInRound }));
    });

    setBidAmount('');

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
      showNotification(t('auction.bidPlacedAmount', { amount }), 'success');
      await refreshBalance();
      await loadData();
    } catch (err) {
      setLeaderboard(previousLeaderboard);
      setMyBids(previousMyBids);
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
    return <SkeletonAuctionPage />;
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
                inputMode="numeric"
                className="input"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                placeholder={t('auction.min', { amount: minWinningBid || auction.minBidAmount })}
                disabled={bidding}
                min={minWinningBid || auction.minBidAmount}
                step={auction.minBidIncrement}
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
                    {entry.rank}
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
                    {entry.isWinning && (
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
            const roundNumber = index + 1;
            const roundWinners = pastWinners.filter(w => w.round === roundNumber);

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
                  <span>{t('auction.roundNumber', { number: roundNumber })}</span>
                  <span>{t('auction.itemsMinutes', { items: round.itemsCount, minutes: round.durationMinutes })}</span>
                </div>
                {roundState && (
                  <div className="text-muted" style={{ fontSize: '12px' }}>
                    {roundState.completed
                      ? t('auction.completedWinners', { count: roundState.winnerBidIds.length })
                      : roundNumber === auction.currentRound
                      ? t('auction.inProgress')
                      : t('auction.pending')}
                  </div>
                )}
                {roundWinners.length > 0 && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    {roundWinners.map((winner, winnerIndex) => (
                      <div key={winnerIndex} className="flex justify-between" style={{ fontSize: '12px', marginBottom: '4px' }}>
                        <span>
                          #{winner.itemNumber} {winner.username}
                          {winner.isBot && <span className="text-muted"> ({t('auction.bot')})</span>}
                        </span>
                        <span className="text-success">{winner.amount} Stars</span>
                      </div>
                    ))}
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
                      {t(`auction.bid${bid.status.charAt(0).toUpperCase() + bid.status.slice(1)}`)}
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
