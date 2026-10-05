// banking_api_ui/src/components/LogoutPage.js
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { navigateToCustomerOAuthForceLogin } from '../utils/authUi';
import bffAxios from '../services/bffAxios';
import { clearIdJagRunState, ID_JAG_PENDING_INTENT_KEY, ID_JAG_USE_CASE_ID, RUN_MODES } from '../utils/idJagRunMode';
import { notifyError } from '../utils/appToast';
import { navigateWithOverlay } from '../utils/navigateWithOverlay';
import './LogoutPage.css';

/**
 * LogoutPage — shown after successful logout from PingOne.
 * Redirects to the dashboard user was on, or home if not on a dashboard.
 */
export default function LogoutPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const finishLogout = async () => {
      let returnTo = '/';
      try { returnTo = sessionStorage.getItem('logoutReturnTo') || '/'; } catch { /* storage unavailable */ }
      let pending = null;
      try { pending = (await bffAxios.get('/api/auth/oauth/user/id-jag/pending')).data; }
      catch {
        // The verified server intent remains authoritative at login. A failed
        // status read must not turn an explicit live handoff into normal logout.
        try {
          const saved = JSON.parse(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY) || 'null');
          if (saved?.useCaseId === ID_JAG_USE_CASE_ID && saved.mode === RUN_MODES.LIVE_ID_JAG
            && ['/pingfederate-id-jag/demo', '/dashboard'].includes(saved.returnTo)) {
            pending = { pending: true, mode: saved.mode, returnTo: saved.returnTo };
          }
        } catch { /* no usable client handoff; ordinary logout continues */ }
      }
      try {
        await bffAxios.post('/api/auth/clear-session');
        if (cancelled) return;
        clearIdJagRunState();
        try { sessionStorage.clear(); localStorage.removeItem('userLoggedOut'); } catch { /* storage unavailable */ }
        const isLiveHandoff = pending?.pending === true && pending.mode === 'live-id-jag'
          && ['/pingfederate-id-jag/demo', '/dashboard'].includes(pending.returnTo);
        if (isLiveHandoff) {
          navigateWithOverlay(`/api/auth/oauth/user/login?mode=live-id-jag&return_to=${encodeURIComponent(pending.returnTo)}`, { message: 'Signing in...' });
          return;
        }
        navigate(returnTo, { replace: true });
      } catch {
        if (cancelled) return;
        clearIdJagRunState();
        notifyError('Sign-out cleanup failed. Please try again.');
        navigate('/pingfederate-id-jag/demo?error=id_jag_handoff_failed', { replace: true });
      }
    };
    void finishLogout();
    return () => { cancelled = true; };
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
