import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="container" style={{ paddingTop: '100px', textAlign: 'center' }}>
          <div className="card" style={{ maxWidth: '500px', margin: '0 auto' }}>
            <h1 style={{ marginBottom: '16px' }}>Something went wrong</h1>
            <p className="text-muted" style={{ marginBottom: '24px' }}>
              An unexpected error occurred. Please try again.
            </p>
            {this.state.error && (
              <pre
                style={{
                  background: 'rgba(244, 92, 67, 0.1)',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  overflow: 'auto',
                  textAlign: 'left',
                  marginBottom: '24px',
                  color: 'var(--color-danger)',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button className="btn btn-primary" onClick={this.handleRetry}>
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
