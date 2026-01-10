import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RoundConfig } from '../types';
import { useNotification } from '../context/NotificationContext';
import * as api from '../api';

export default function CreateAuctionPage() {
  const navigate = useNavigate();
  const { showNotification } = useNotification();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [totalItems, setTotalItems] = useState(10);
  const [rounds, setRounds] = useState<RoundConfig[]>([
    { itemsCount: 5, durationMinutes: 5 },
    { itemsCount: 5, durationMinutes: 5 },
  ]);
  const [minBidAmount, setMinBidAmount] = useState(100);
  const [minBidIncrement, setMinBidIncrement] = useState(10);
  const [antiSnipingWindowMinutes, setAntiSnipingWindowMinutes] = useState(2);
  const [antiSnipingExtensionMinutes, setAntiSnipingExtensionMinutes] = useState(2);
  const [maxExtensions, setMaxExtensions] = useState(6);
  const [botsEnabled, setBotsEnabled] = useState(true);
  const [botCount, setBotCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addRound = () => {
    setRounds([...rounds, { itemsCount: 1, durationMinutes: 5 }]);
  };

  const removeRound = (index: number) => {
    if (rounds.length > 1) {
      setRounds(rounds.filter((_, i) => i !== index));
    }
  };

  const updateRound = (index: number, field: keyof RoundConfig, value: number) => {
    const sanitizedValue = Math.max(1, value);
    setRounds(
      rounds.map((round, i) =>
        i === index ? { ...round, [field]: sanitizedValue } : round
      )
    );
  };

  const handleNumberInput = (
    setter: (value: number) => void,
    value: string,
    min: number = 1
  ) => {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      setter(Math.max(min, parsed));
    }
  };

  const totalRoundItems = rounds.reduce((sum, r) => sum + r.itemsCount, 0);

  const validateForm = (): string | null => {
    if (!title.trim()) {
      return 'Title is required';
    }
    if (title.trim().length < 3) {
      return 'Title must be at least 3 characters';
    }
    if (totalItems < 1) {
      return 'Total items must be at least 1';
    }
    if (totalRoundItems !== totalItems) {
      return `Sum of items in rounds (${totalRoundItems}) must equal total items (${totalItems})`;
    }
    if (minBidAmount < 1) {
      return 'Minimum bid amount must be at least 1';
    }
    if (minBidIncrement < 1) {
      return 'Minimum bid increment must be at least 1';
    }
    if (antiSnipingWindowMinutes < 1) {
      return 'Anti-sniping window must be at least 1 minute';
    }
    if (antiSnipingExtensionMinutes < 1) {
      return 'Anti-sniping extension must be at least 1 minute';
    }
    if (maxExtensions < 0) {
      return 'Max extensions cannot be negative';
    }
    if (botsEnabled && botCount < 0) {
      return 'Bot count cannot be negative';
    }
    if (botsEnabled && botCount > 50) {
      return 'Bot count cannot exceed 50';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const auction = await api.createAuction({
        title: title.trim(),
        description: description.trim() || undefined,
        totalItems,
        rounds,
        minBidAmount,
        minBidIncrement,
        antiSnipingWindowMinutes,
        antiSnipingExtensionMinutes,
        maxExtensions,
        botsEnabled,
        botCount,
      });

      showNotification('Auction created successfully!', 'success');
      navigate(`/auctions/${auction.id}`);
    } catch (err) {
      const message = (err as Error).message || 'Failed to create auction';
      setError(message);
      showNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <h1>Create Auction</h1>

      <form onSubmit={handleSubmit}>
        <div className="card">
          <h3>Basic Info</h3>

          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter auction title"
              maxLength={100}
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <input
              type="text"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              maxLength={500}
            />
          </div>

          <div className="form-group">
            <label>Total Items</label>
            <input
              type="number"
              className="input"
              value={totalItems}
              onChange={(e) => handleNumberInput(setTotalItems, e.target.value)}
              min={1}
            />
          </div>
        </div>

        <div className="card">
          <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Rounds</h3>
            <button type="button" className="btn btn-secondary" onClick={addRound}>
              Add Round
            </button>
          </div>

          {totalRoundItems !== totalItems && (
            <p className="text-warning" style={{ marginBottom: '16px' }}>
              Items in rounds ({totalRoundItems}) must equal total items ({totalItems})
            </p>
          )}

          {rounds.map((round, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                marginBottom: '12px',
                padding: '12px',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '8px',
              }}
            >
              <span style={{ minWidth: '80px' }}>Round {index + 1}</span>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Items</label>
                <input
                  type="number"
                  className="input"
                  value={round.itemsCount}
                  onChange={(e) => updateRound(index, 'itemsCount', parseInt(e.target.value, 10) || 1)}
                  min={1}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Duration (min)</label>
                <input
                  type="number"
                  className="input"
                  value={round.durationMinutes}
                  onChange={(e) => updateRound(index, 'durationMinutes', parseInt(e.target.value, 10) || 1)}
                  min={1}
                />
              </div>
              {rounds.length > 1 && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeRound(index)}
                  style={{ padding: '8px 12px' }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="card">
          <h3>Bidding Settings</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label>Min Bid Amount (Stars)</label>
              <input
                type="number"
                className="input"
                value={minBidAmount}
                onChange={(e) => handleNumberInput(setMinBidAmount, e.target.value)}
                min={1}
              />
            </div>

            <div className="form-group">
              <label>Min Bid Increment (Stars)</label>
              <input
                type="number"
                className="input"
                value={minBidIncrement}
                onChange={(e) => handleNumberInput(setMinBidIncrement, e.target.value)}
                min={1}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Anti-Sniping Settings</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label>Window (min)</label>
              <input
                type="number"
                className="input"
                value={antiSnipingWindowMinutes}
                onChange={(e) => handleNumberInput(setAntiSnipingWindowMinutes, e.target.value)}
                min={1}
              />
            </div>

            <div className="form-group">
              <label>Extension (min)</label>
              <input
                type="number"
                className="input"
                value={antiSnipingExtensionMinutes}
                onChange={(e) => handleNumberInput(setAntiSnipingExtensionMinutes, e.target.value)}
                min={1}
              />
            </div>

            <div className="form-group">
              <label>Max Extensions</label>
              <input
                type="number"
                className="input"
                value={maxExtensions}
                onChange={(e) => handleNumberInput(setMaxExtensions, e.target.value, 0)}
                min={0}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Bot Settings</h3>

          <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={botsEnabled}
                onChange={(e) => setBotsEnabled(e.target.checked)}
              />
              Enable bots for live auction demo
            </label>

            {botsEnabled && (
              <div className="form-group" style={{ margin: 0 }}>
                <label>Bot Count</label>
                <input
                  type="number"
                  className="input"
                  value={botCount}
                  onChange={(e) => handleNumberInput(setBotCount, e.target.value, 0)}
                  min={0}
                  max={50}
                  style={{ width: '100px' }}
                />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="card" style={{ background: 'rgba(244, 92, 67, 0.1)' }}>
            <p className="text-danger">{error}</p>
          </div>
        )}

        <div className="flex gap-4">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/auctions')}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || totalRoundItems !== totalItems}
            style={{ flex: 1 }}
          >
            {loading ? 'Creating...' : 'Create Auction'}
          </button>
        </div>
      </form>
    </div>
  );
}
