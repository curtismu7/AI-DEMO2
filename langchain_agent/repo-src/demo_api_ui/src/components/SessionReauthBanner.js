// banking_api_ui/src/components/SessionReauthBanner.js
import { navigateToAdminOAuthLogin, navigateToCustomerOAuthForceLogin } from '../utils/authUi';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';

/**
 * Fixed on-page notice when the session is invalid and the user must sign in again.
 * @param {{ message: string, role: 'admin' | 'customer', onDismiss: () => void, isHITL?: boolean }} props
 */
export default function SessionReauthBanner({ message, role, onDismiss, isHITL = false }) {
  const { open } = useEducationUI();
  
  const handleSignIn = () => {
    if (role === 'admin') navigateToAdminOAuthLogin();
    else navigateToCustomerOAuthForceLogin();
  };

  const handleLearnMore = () => {
    open(EDU.HUMAN_IN_LOOP, 'what');
  };

  const signInLabel = role === 'admin' ? 'Admin Sign In' : 'Sign In';

  return (
    <div className={`session-reauth-banner ${isHITL ? 'session-reauth-banner--hitl' : ''}`} role="alert" aria-live="assertive">
      <div className="session-reauth-banner__inner">
        {isHITL && (
          <div className="session-reauth-banner__hitl-indicator">
            <span className="session-reauth-banner__hitl-icon">👤</span>
            <span className="session-reauth-banner__hitl-text">Manual approval required</span>
          </div>
        )}
        <p className="session-reauth-banner__text">{message}</p>
        <div className="session-reauth-banner__actions">
          <button type="button" className="session-reauth-banner__btn session-reauth-banner__btn--primary" onClick={handleSignIn}>
            {signInLabel}
          </button>
          {isHITL && (
            <button type="button" className="session-reauth-banner__btn session-reauth-banner__btn--secondary" onClick={handleLearnMore}>
              Learn more
            </button>
          )}
          <button type="button" className="session-reauth-banner__btn session-reauth-banner__btn--ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
