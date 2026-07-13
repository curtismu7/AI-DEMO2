/**
 * AuthErrorBanner — Smart error display based on classification category
 *
 * Shows category-specific UI:
 *   - USER: "Session expired, click Refresh" with re-auth button
 *   - TRANSIENT: "Connection issue — retrying..." with progress
 *   - CONFIG: "System config issue detected" with support contact link (no details)
 *   - UNKNOWN: Generic fallback, suggest status page
 *
 * Hides sensitive details (JWKS URIs, env IDs, issuer URLs) from users.
 */

import React, { useState } from 'react';
import './AuthErrorBanner.css';

function AuthErrorBanner({
  error,
  onDismiss,
  onRetry,
  onContactSupport,
  className = '',
}) {
  const [isContacting, setIsContacting] = useState(false);

  if (!error || !error.classification) {
    return null;
  }

  const { category, userAction } = error.classification;
  const { requestId, timestamp } = error;

  const handleContactSupport = async () => {
    setIsContacting(true);
    try {
      if (onContactSupport) {
        await onContactSupport(error);
      }
    } finally {
      setIsContacting(false);
    }
  };

  // USER ERROR: Session expired, token revoked, scope mismatch
  if (category === 'USER') {
    return (
      <div className={`auth-error-banner user ${className}`}>
        <div className="banner-content">
          <div className="banner-icon">⚠️</div>
          <div className="banner-text">
            <h3>Your session has expired</h3>
            <p>
              {userAction === 're-auth'
                ? 'Your authentication session is no longer valid. Please refresh or sign in again.'
                : 'Your token is no longer valid.'}
            </p>
          </div>
        </div>
        <div className="banner-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRetry || (() => window.location.reload())}
            aria-label="Refresh authentication"
          >
            Refresh
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              window.location.href = '/';
            }}
          >
            Sign In
          </button>
          {onDismiss && (
            <button
              className="btn btn-text"
              onClick={onDismiss}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  // TRANSIENT ERROR: Network issue, retry in progress
  if (category === 'TRANSIENT') {
    return (
      <div className={`auth-error-banner transient ${className}`}>
        <div className="banner-content">
          <div className="banner-icon spinner">⟳</div>
          <div className="banner-text">
            <h3>Connecting...</h3>
            <p>We're having a temporary connection issue. Retrying...</p>
          </div>
        </div>
        {onDismiss && (
          <button
            className="btn btn-text"
            onClick={onDismiss}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  // CONFIG ERROR: System misconfiguration, contact support
  if (category === 'CONFIG') {
    return (
      <div className={`auth-error-banner config ${className}`}>
        <div className="banner-content">
          <div className="banner-icon">🔧</div>
          <div className="banner-text">
            <h3>System configuration issue</h3>
            <p>
              Our system encountered a configuration problem. Our support team has been notified.
              Reference: <code>{requestId}</code>
            </p>
            <div className="banner-details">
              <small>{new Date(timestamp).toLocaleString()}</small>
            </div>
          </div>
        </div>
        <div className="banner-actions">
          <button
            className="btn btn-primary"
            onClick={handleContactSupport}
            disabled={isContacting}
            aria-label="Contact support"
          >
            {isContacting ? 'Opening...' : 'Contact Support'}
          </button>
          <a
            href={process.env.REACT_APP_STATUS_PAGE_URL || 'https://status.example.com'}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Check System Status
          </a>
          {onDismiss && (
            <button
              className="btn btn-text"
              onClick={onDismiss}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  // UNKNOWN ERROR: Fallback
  return (
    <div className={`auth-error-banner unknown ${className}`}>
      <div className="banner-content">
        <div className="banner-icon">❌</div>
        <div className="banner-text">
          <h3>Unexpected error</h3>
          <p>
            An unexpected error occurred. Please try again or check the system status page.
            Reference: <code>{requestId}</code>
          </p>
        </div>
      </div>
      <div className="banner-actions">
        {onRetry && (
          <button
            className="btn btn-primary"
            onClick={onRetry}
            aria-label="Retry"
          >
            Retry
          </button>
        )}
        <a
          href={process.env.REACT_APP_STATUS_PAGE_URL || 'https://status.example.com'}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary"
        >
          Status Page
        </a>
        {onDismiss && (
          <button
            className="btn btn-text"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}


export default AuthErrorBanner;
