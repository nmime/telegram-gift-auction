import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Header from './components/Header';
import LoadingSpinner from './components/LoadingSpinner';
import LoginPage from './pages/LoginPage';
import AuctionsPage from './pages/AuctionsPage';
import AuctionPage from './pages/AuctionPage';
import CreateAuctionPage from './pages/CreateAuctionPage';
import TransactionsPage from './pages/TransactionsPage';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '100px' }}>
        <LoadingSpinner size="lg" text="Loading..." />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="container">
      <Header />
      <Routes>
        <Route path="/" element={<AuctionsPage />} />
        <Route path="/auctions" element={<AuctionsPage />} />
        <Route path="/auctions/create" element={<CreateAuctionPage />} />
        <Route path="/auctions/:id" element={<AuctionPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
