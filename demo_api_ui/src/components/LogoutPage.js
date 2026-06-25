// banking_api_ui/src/components/LogoutPage.js
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './LogoutPage.css';

/**
 * LogoutPage — shown after successful logout from PingOne
 * Displays a confirmation message and redirects home after 3 seconds
 */
export default function LogoutPage() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    // Clear any remaining session data
    try {
      sessionStorage.clear();
      localStorage.removeItem('userLoggedOut');
    } catch (e) {
      // ignore storage errors (might not have permission in some contexts)
    }

    // Countdown timer before redirect
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Navigate when countdown reaches 0
  useEffect(() => {
    if (countdown === 0) {
      navigate('/');
    }
  }, [countdown, navigate]);

  return (
    <div className="logout-page">
      <div className="logout-container">
        <div className="logout-icon">👋</div>
        <h1>You're signed out</h1>
        <p className="logout-message">
          Your session has been ended and you've been securely signed out.
        </p>
        <div className="logout-actions">
          <button
            className="logout-button logout-button--primary"
            onClick={() => navigate('/')}
            title="Sign in again"
          >
            Sign In Again
          </button>
          <button
            className="logout-button logout-button--secondary"
            onClick={() => navigate('/')}
            title="Go to home"
          >
            Go Home
          </button>
        </div>
        <p className="logout-redirect-notice">
          Redirecting to home in {countdown}s...
        </p>
      </div>
    </div>
  );
}
