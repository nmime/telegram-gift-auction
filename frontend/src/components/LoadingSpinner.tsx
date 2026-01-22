interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export default function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps): React.JSX.Element {
  const sizeClass = size === 'sm' ? 'spinner-sm' : size === 'lg' ? 'spinner-lg' : '';

  return (
    <div className="loading-container">
      <div className={`spinner ${sizeClass}`} />
      {text && <span className="loading-text">{text}</span>}
    </div>
  );
}
