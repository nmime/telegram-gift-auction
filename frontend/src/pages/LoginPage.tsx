import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await login(username.trim());
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: '400px', paddingTop: '100px' }}>
      <div className="card">
        <h1 style={{ textAlign: 'center', marginBottom: '32px' }}>
          Gift Auction
        </h1>
        <p className="text-muted" style={{ textAlign: 'center', marginBottom: '32px' }}>
          Multi-round auction system inspired by Telegram Gift Auctions
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <p className="text-danger" style={{ marginBottom: '16px' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Login / Register'}
          </button>
        </form>

        <p className="text-muted" style={{ textAlign: 'center', marginTop: '24px', fontSize: '14px' }}>
          New users are automatically registered
        </p>
      </div>
    </div>
  );
}
