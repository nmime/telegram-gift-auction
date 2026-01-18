interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'title' | 'avatar' | 'button' | 'rect';
}

export function Skeleton({
  className = '',
  width,
  height,
  variant = 'rect'
}: SkeletonProps) {
  const variantClass = {
    text: 'skeleton-text',
    title: 'skeleton-title',
    avatar: 'skeleton-avatar',
    button: 'skeleton-button',
    rect: '',
  }[variant];

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return <div className={`skeleton ${variantClass} ${className}`} style={style} />;
}

export function SkeletonAuctionCard() {
  return (
    <div className="skeleton-card">
      <Skeleton variant="title" />
      <Skeleton variant="text" width="80%" />
      <Skeleton variant="text" width="60%" />
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <Skeleton width={60} height={24} />
        <Skeleton width={80} height={24} />
      </div>
    </div>
  );
}

export function SkeletonAuctionGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonAuctionCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonLeaderboardItem() {
  return (
    <div className="skeleton-leaderboard-item">
      <Skeleton width={30} height={24} />
      <Skeleton variant="avatar" />
      <div style={{ flex: 1 }}>
        <Skeleton variant="text" width="70%" />
      </div>
      <Skeleton width={60} height={20} />
    </div>
  );
}

export function SkeletonLeaderboard({ count = 5 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonLeaderboardItem key={i} />
      ))}
    </div>
  );
}

export function SkeletonStatBox() {
  return (
    <div className="skeleton-stat-box">
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
        <Skeleton height={32} width="50%" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Skeleton variant="text" className="skeleton-text-sm" width="70%" />
      </div>
    </div>
  );
}

export function SkeletonStats({ count = 5 }: { count?: number }) {
  return (
    <div className="round-stats">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatBox key={i} />
      ))}
    </div>
  );
}

export function SkeletonTableRow() {
  return (
    <div className="skeleton-table-row">
      <Skeleton variant="text" />
      <Skeleton variant="text" width="80%" />
      <Skeleton variant="text" width="60%" />
      <Skeleton variant="text" width="50%" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} />
      ))}
    </div>
  );
}

const ROW_WIDTHS = [
  ['65%', '55%', '75%', '65%', '60%', '65%'],
  ['58%', '48%', '68%', '58%', '50%', '58%'],
  ['72%', '62%', '82%', '72%', '70%', '72%'],
  ['60%', '52%', '70%', '60%', '55%', '60%'],
  ['68%', '58%', '78%', '68%', '65%', '68%'],
  ['55%', '45%', '65%', '55%', '48%', '55%'],
  ['75%', '65%', '85%', '75%', '72%', '75%'],
  ['62%', '52%', '72%', '62%', '58%', '62%'],
];

export function SkeletonTransactionsTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="skeleton-card">
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1.5fr 1.5fr 2fr 1fr',
        gap: '12px',
        padding: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        marginBottom: '8px'
      }}>
        <Skeleton variant="text" className="skeleton-text-sm" width="60%" />
        <Skeleton variant="text" className="skeleton-text-sm" width="80%" />
        <Skeleton variant="text" className="skeleton-text-sm" width="70%" />
        <Skeleton variant="text" className="skeleton-text-sm" width="70%" />
        <Skeleton variant="text" className="skeleton-text-sm" width="50%" />
        <Skeleton variant="text" className="skeleton-text-sm" width="60%" />
      </div>
      {Array.from({ length: rows }).map((_, i) => {
        const widths = ROW_WIDTHS[i % ROW_WIDTHS.length];
        return (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1.5fr 1.5fr 2fr 1fr',
              gap: '12px',
              padding: '12px',
              borderBottom: '1px solid rgba(255,255,255,0.05)'
            }}
          >
            <Skeleton variant="text" width={widths[0]} />
            <Skeleton variant="text" width={widths[1]} />
            <Skeleton variant="text" width={widths[2]} />
            <Skeleton variant="text" width={widths[3]} />
            <Skeleton variant="text" width={widths[4]} />
            <Skeleton variant="text" width={widths[5]} />
          </div>
        );
      })}
    </div>
  );
}

export function SkeletonBidForm() {
  return (
    <div className="skeleton-card">
      <Skeleton variant="title" width="40%" />
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <div style={{ flex: 1 }}>
          <Skeleton height={48} />
        </div>
        <Skeleton variant="button" width={100} />
      </div>
      <Skeleton variant="text" className="skeleton-text-sm" width="60%" />
    </div>
  );
}

export function SkeletonRoundInfo() {
  return (
    <div className="skeleton-card">
      <Skeleton variant="title" width="30%" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Skeleton variant="text" />
        <Skeleton variant="text" width="80%" />
        <Skeleton variant="text" width="90%" />
      </div>
    </div>
  );
}

export function SkeletonAuctionPage() {
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <Skeleton variant="title" width="40%" />
        <Skeleton variant="text" width="60%" />
      </div>

      {/* Round Stats */}
      <div className="round-info">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="round-stat">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
              <Skeleton height={32} width="60%" />
            </div>
            <Skeleton variant="text" className="skeleton-text-sm" width="80%" />
          </div>
        ))}
      </div>

      {/* Bid Form */}
      <div className="skeleton-card" style={{ marginBottom: '16px' }}>
        <Skeleton variant="title" width="40%" />
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <Skeleton height={48} />
          </div>
          <Skeleton variant="button" width={120} />
        </div>
        <Skeleton variant="text" className="skeleton-text-sm" width="50%" />
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-2 gap-4">
        {/* Leaderboard */}
        <div className="skeleton-card">
          <Skeleton variant="title" width="50%" />
          <SkeletonLeaderboard count={6} />
        </div>

        {/* Info */}
        <div className="skeleton-card">
          <Skeleton variant="title" width="30%" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {['70%', '85%', '65%', '80%', '75%', '90%', '68%'].map((width, i) => (
              <Skeleton key={i} variant="text" width={width} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
