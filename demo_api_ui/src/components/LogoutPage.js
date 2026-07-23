// banking_api_ui/src/components/LogoutPage.js
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { navigateToCustomerOAuthForceLogin } from '../utils/authUi';
import './LogoutPage.css';

/**
 * LogoutPage — shown after successful logout from PingOne.
 * Split-hero layout matching LoginSuccessModal (vertical brand colors).
 * Redirects to PingOne login after 3s with prompt=login so SSO cannot
 * silently restore the session.
 */
export default function LogoutPage() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    try {
      sessionStorage.clear();
      localStorage.removeItem('userLoggedOut');
    } catch (e) {
      // ignore storage errors
    }

    const timer = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (countdown === 0) {
      navigateToCustomerOAuthForceLogin();
    }
  }, [countdown, navigate]);

  return (
    <div className="logout-page">
      <div className="logout-card" role="dialog" aria-labelledby="logout-title">
        <div className="logout-titlebar">
          <span id="logout-title" className="logout-title">
            Signed out
          </span>
        </div>

        <div className="logout-split">
          <div className="logout-left">
            <div className="logout-mark" aria-hidden="true">
              🔐
            </div>
            <h1 className="logout-hello">You&apos;re signed out</h1>
            <p className="logout-via">Session ended through PingOne</p>
            <div className="logout-secure" aria-hidden="true">
              ✓ Secure logout
            </div>
          </div>

          <div className="logout-right">
            <div className="logout-field">
              <span className="logout-label">Status</span>
              <span className="logout-value">
                Signed out <span className="logout-tick" aria-hidden="true">✓</span>
              </span>
            </div>
            <div className="logout-field">
              <span className="logout-label">Session</span>
              <span className="logout-value">Cleared securely</span>
            </div>
            <div className="logout-field">
              <span className="logout-label">Next step</span>
              <span className="logout-value">
                Redirecting to sign in in {countdown}s
              </span>
            </div>
          </div>
        </div>

        <div className="logout-footer">
          <button
            type="button"
            className="logout-btn logout-btn--secondary"
            onClick={() => navigate('/')}
          >
            Go Home
          </button>
          <button
            type="button"
            className="logout-btn logout-btn--primary"
            onClick={() => navigateToCustomerOAuthForceLogin()}
          >
            Sign In Again
          </button>
        </div>
      </div>
    </div>
  );
}
