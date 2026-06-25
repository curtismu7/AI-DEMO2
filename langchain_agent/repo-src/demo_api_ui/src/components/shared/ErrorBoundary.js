// banking_api_ui/src/components/shared/ErrorBoundary.js
import React from 'react';
import './ErrorBoundary.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      errorId: null 
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Generate unique error ID for tracking
    const errorId = `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.setState({
      error: error,
      errorInfo: errorInfo,
      errorId: errorId
    });

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.group('Error Boundary Caught Error');
      console.error('Error:', error);
      console.error('Error Info:', errorInfo);
      console.error('Error ID:', errorId);
      console.groupEnd();
    }

    // Log to error reporting service in production
    if (process.env.NODE_ENV === 'production') {
      this.logErrorToService(error, errorInfo, errorId);
    }
  }

  logErrorToService = (error, errorInfo, errorId) => {
    // In a real application, you would send this to an error reporting service
    // like Sentry, LogRocket, or your own logging endpoint
    try {
      const errorData = {
        errorId,
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
      };

      // Example: Send to logging endpoint
      fetch('/api/errors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(errorData),
      }).catch(() => {
        // Silently fail if error logging fails
        console.warn('Failed to log error to service');
      });
    } catch (loggingError) {
      console.warn('Error logging failed:', loggingError);
    }
  };

  handleRetry = () => {
    this.setState({ 
      hasError: false, 
      error: null, 
      errorInfo: null,
      errorId: null 
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    // Navigate to root without a full reload — React Router re-mounts cleanly.
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const { fallback, showDetails = process.env.NODE_ENV === 'development' } = this.props;
      
      // Custom fallback component
      if (fallback && typeof fallback === 'function') {
        return fallback({
          error: this.state.error,
          errorInfo: this.state.errorInfo,
          errorId: this.state.errorId,
          retry: this.handleRetry,
          reload: this.handleReload
        });
      }

      // Default fallback UI
      return (
        <div className="error-boundary">
          <div className="error-boundary__content">
            <div className="error-boundary__icon">
              ⚠️
            </div>
            
            <h2 className="error-boundary__title">
              Something went wrong
            </h2>
            
            <p className="error-boundary__message">
              We're sorry, but something unexpected happened. 
              {this.props.showRetry && (
                <span> You can try again or reload the page.</span>
              )}
            </p>

            {this.state.errorId && (
              <p className="error-boundary__error-id">
                Error ID: {this.state.errorId}
              </p>
            )}

            <div className="error-boundary__actions">
              {this.props.showRetry !== false && (
                <button
                  type="button"
                  className="error-boundary__btn error-boundary__btn--primary"
                  onClick={this.handleRetry}
                >
                  Try Again
                </button>
              )}

              <button
                type="button"
                className="error-boundary__btn error-boundary__btn--home"
                onClick={this.handleGoHome}
              >
                ← Go to App
              </button>
              
              <button
                type="button"
                className="error-boundary__btn error-boundary__btn--secondary"
                onClick={this.handleReload}
              >
                Reload Page
              </button>
            </div>

            {/* Show error details in development */}
            {showDetails && this.state.error && (
              <details className="error-boundary__details">
                <summary className="error-boundary__details-summary">
                  Error Details (Development Only)
                </summary>
                
                <div className="error-boundary__details-content">
                  <div className="error-boundary__error-section">
                    <h4>Error Message:</h4>
                    <pre className="error-boundary__error-message">
                      {this.state.error.toString()}
                    </pre>
                  </div>

                  <div className="error-boundary__error-section">
                    <h4>Stack Trace:</h4>
                    <pre className="error-boundary__stack-trace">
                      {this.state.error.stack}
                    </pre>
                  </div>

                  {this.state.errorInfo && (
                    <div className="error-boundary__error-section">
                      <h4>Component Stack:</h4>
                      <pre className="error-boundary__component-stack">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// HOC for wrapping components with error boundary
export const withErrorBoundary = (Component, errorBoundaryProps = {}) => {
  const WrappedComponent = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  
  return WrappedComponent;
};

// Hook for handling errors in functional components
export const useErrorHandler = () => {
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (error) {
      // Log the error
      console.error('Error caught by useErrorHandler:', error);
      
      // In production, you might want to send this to an error reporting service
      if (process.env.NODE_ENV === 'production') {
        // Send to error reporting service
      }
    }
  }, [error]);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  // Throw error to be caught by error boundary
  const throwError = React.useCallback((error) => {
    setError(error);
    throw error;
  }, []);

  return {
    error,
    setError,
    resetError,
    throwError
  };
};

export default ErrorBoundary;
