// banking_api_ui/src/components/LogoutPage.js
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { navigateToCustomerOAuthForceLogin } from '../utils/authUi';
import './LogoutPage.css';

/**
 * LogoutPage — shown after successful logout from PingOne.
 * Redirects to the dashboard user was on, or home if not on a dashboard.
 */
export default function LogoutPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let returnTo = '/';
    try {
      // Check if logout was initiated from a dashboard
      returnTo = sessionStorage.getItem('logoutReturnTo') || '/';
      sessionStorage.clear();
      localStorage.removeItem('userLoggedOut');
    } catch (e) {
      // ignore storage errors
    }

    navigate(returnTo, { replace: true });
  }, [navigate]);

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
              <span className="logout-value">Returning to dashboard</span>
            </div>
          </div>
        </div>

        <div className="logout-footer">
          <button
            type="button"
            className="logout-action logout-action--secondary"
            onClick={() => navigate('/')}
          >
            Go Home
          </button>
          <button
            type="button"
            className="logout-action logout-action--primary"
            onClick={() => navigateToCustomerOAuthForceLogin()}
          >
            Sign In Again
          </button>
        </div>
      </div>
    </div>
  );
}
