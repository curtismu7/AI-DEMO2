import React from 'react';
import './ErrorBoundary.css';

/**
 * Error Boundary component to catch rendering errors and display fallback UI
 * Prevents entire app from crashing on component errors
 *
 * @component
 * @example
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  /**
   * Update state so next render shows fallback UI
   * @param {Error} error - The error that was thrown
   * @returns {Object} Updated state
   */
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  /**
   * Log error details for debugging/monitoring
   * @param {Error} error - The error that was thrown
   * @param {Object} errorInfo - Component stack trace
   */
  componentDidCatch(error, errorInfo) {
    this.setState({
      errorInfo,
    });

    // Log in all environments so production crashes are diagnosable from the console.
    console.error('Error Boundary caught:', error, errorInfo);

    // TODO: Send to error tracking service (Sentry, LogRocket, etc)
    // logErrorToService(error, errorInfo);
  }

  /**
   * Reset error state to allow user to retry
   */
  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  componentWillUnmount() {
    clearTimeout(this._copyTimer);
  }

  handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const text = [
      error?.stack || error?.message,
      errorInfo?.componentStack,
    ].filter(Boolean).join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      this._copyTimer = setTimeout(() => this.setState({ copied: false }), 2000);
    }).catch(() => {
      this.setState({ copied: false });
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <div className="error-boundary-content">
            <h2>Something went wrong</h2>
            <p className="error-message">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            {this.state.errorInfo && (
              <details className="error-details">
                <summary>
                  Error Details
                  <button
                    type="button"
                    className="btn btn-copy-error"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); this.handleCopyError(); }}
                    aria-label="Copy error details to clipboard"
                  >
                    {this.state.copied ? '✅ Copied' : 'Copy'}
                  </button>
                </summary>
                {window.__lastAgentError && (
                  <div className="error-details-agent">
                    <strong>Last agent error:</strong>
                    <pre>{JSON.stringify(window.__lastAgentError, null, 2)}</pre>
                  </div>
                )}
                <pre>{this.state.error?.stack || this.state.error?.message}</pre>
                <pre>{this.state.errorInfo.componentStack}</pre>
              </details>
            )}
            <div className="error-actions">
              <button
                onClick={this.handleReset}
                className="btn btn-primary"
                aria-label="Retry loading the page"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="btn btn-secondary"
                aria-label="Go to home page"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
