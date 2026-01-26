import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RoundConfig } from '../types';
import { useNotification } from '../context/NotificationContext';
import * as api from '../api';

// Store numeric inputs as strings for proper editing experience
interface NumericInputs {
  totalItems: string;
  minBidAmount: string;
  minBidIncrement: string;
  antiSnipingWindowMinutes: string;
  antiSnipingExtensionMinutes: string;
  maxExtensions: string;
  botCount: string;
}

export default function CreateAuctionPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { showNotification } = useNotification();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [numericInputs, setNumericInputs] = useState<NumericInputs>({
    totalItems: '10',
    minBidAmount: '100',
    minBidIncrement: '10',
    antiSnipingWindowMinutes: '2',
    antiSnipingExtensionMinutes: '2',
    maxExtensions: '6',
    botCount: '5',
  });
  const [rounds, setRounds] = useState<{ itemsCount: string; durationMinutes: string }[]>([
    { itemsCount: '5', durationMinutes: '5' },
    { itemsCount: '5', durationMinutes: '5' },
  ]);
  const [botsEnabled, setBotsEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Parse string to number, defaulting to 0 for empty/invalid
  const parseNum = (val: string): number => {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  };

  const updateNumericInput = (field: keyof NumericInputs, value: string) => {
    // Allow only digits (and empty string for clearing)
    if (value === '' || /^\d+$/.test(value)) {
      setNumericInputs((prev) => ({ ...prev, [field]: value }));
    }
  };

  const addRound = () => {
    setRounds([...rounds, { itemsCount: '1', durationMinutes: '5' }]);
  };

  const removeRound = (index: number) => {
    if (rounds.length > 1) {
      setRounds(rounds.filter((_, i) => i !== index));
    }
  };

  const updateRound = (index: number, field: 'itemsCount' | 'durationMinutes', value: string) => {
    if (value === '' || /^\d+$/.test(value)) {
      setRounds(
        rounds.map((round, i) =>
          i === index ? { ...round, [field]: value } : round
        )
      );
    }
  };

  const totalItems = parseNum(numericInputs.totalItems);
  const minBidAmount = parseNum(numericInputs.minBidAmount);
  const minBidIncrement = parseNum(numericInputs.minBidIncrement);
  const antiSnipingWindowMinutes = parseNum(numericInputs.antiSnipingWindowMinutes);
  const antiSnipingExtensionMinutes = parseNum(numericInputs.antiSnipingExtensionMinutes);
  const maxExtensions = parseNum(numericInputs.maxExtensions);
  const botCount = parseNum(numericInputs.botCount);

  const totalRoundItems = rounds.reduce((sum, r) => sum + parseNum(r.itemsCount), 0);

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
      const parsedRounds: RoundConfig[] = rounds.map((r) => ({
        itemsCount: parseNum(r.itemsCount),
        durationMinutes: parseNum(r.durationMinutes),
      }));

      const auction = await api.createAuction({
        title: title.trim(),
        description: description.trim() || undefined,
        totalItems,
        rounds: parsedRounds,
        minBidAmount,
        minBidIncrement,
        antiSnipingWindowMinutes,
        antiSnipingExtensionMinutes,
        maxExtensions,
        botsEnabled,
        botCount,
      });

      showNotification('Auction created successfully!', 'success');
      void navigate(`/auctions/${auction.id}`);
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
              type="text"
              inputMode="numeric"
              className="input"
              value={numericInputs.totalItems}
              onChange={(e) => updateNumericInput('totalItems', e.target.value)}
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
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={round.itemsCount}
                  onChange={(e) => updateRound(index, 'itemsCount', e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Duration (min)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={round.durationMinutes}
                  onChange={(e) => updateRound(index, 'durationMinutes', e.target.value)}
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
                type="text"
                inputMode="numeric"
                className="input"
                value={numericInputs.minBidAmount}
                onChange={(e) => updateNumericInput('minBidAmount', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Min Bid Increment (Stars)</label>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                value={numericInputs.minBidIncrement}
                onChange={(e) => updateNumericInput('minBidIncrement', e.target.value)}
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
                type="text"
                inputMode="numeric"
                className="input"
                value={numericInputs.antiSnipingWindowMinutes}
                onChange={(e) => updateNumericInput('antiSnipingWindowMinutes', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Extension (min)</label>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                value={numericInputs.antiSnipingExtensionMinutes}
                onChange={(e) => updateNumericInput('antiSnipingExtensionMinutes', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Max Extensions</label>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                value={numericInputs.maxExtensions}
                onChange={(e) => updateNumericInput('maxExtensions', e.target.value)}
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
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={numericInputs.botCount}
                  onChange={(e) => updateNumericInput('botCount', e.target.value)}
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

        <div className="flex gap-4" style={{ marginBottom: '32px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => await navigate('/auctions')}
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
