// banking_api_ui/src/components/SessionReauthBanner.js
import { navigateToAdminOAuthLogin, navigateToCustomerOAuthForceLogin } from '../utils/authUi';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import DraggableModal from './DraggableModal';

/**
 * Shown when the session is invalid and the user must sign in again, and — via
 * `isHITL` — when a transfer is waiting on manual approval.
 *
 * Two presentations on purpose:
 *   session expiry → DraggableModal, because it interrupts a task and the user
 *                    should deal with it before carrying on
 *   isHITL         → the original fixed banner, UNCHANGED. HITL consent is a
 *                    protected flow (REGRESSION_PLAN §1) and restyling it was
 *                    not part of the ask.
 *
 * Either way the sign-in carries `returnTo`, so the user lands back on the page
 * they were interrupted on rather than somewhere else.
 *
 * @param {{ message: string, role: 'admin' | 'customer', onDismiss: () => void, isHITL?: boolean }} props
 */
export default function SessionReauthBanner({ message, role, onDismiss, isHITL = false }) {
  const { open } = useEducationUI();

  // A bare path: the BFF's sanitizePostLoginReturnPath rejects query strings,
  // so pass pathname only — never window.location.href.
  const returnTo =
    typeof window !== 'undefined' ? window.location.pathname : undefined;

  const handleSignIn = () => {
    if (role === 'admin') navigateToAdminOAuthLogin(returnTo);
    else navigateToCustomerOAuthForceLogin(returnTo);
  };

  const handleLearnMore = () => {
    open(EDU.HUMAN_IN_LOOP, 'what');
  };

  const signInLabel = role === 'admin' ? 'Admin Sign In' : 'Sign In';

  // ── HITL: original banner, deliberately untouched ─────────────────────────
  if (isHITL) {
    return (
      <div className="session-reauth-banner session-reauth-banner--hitl" role="alert" aria-live="assertive">
        <div className="session-reauth-banner__inner">
          <div className="session-reauth-banner__hitl-indicator">
            <span className="session-reauth-banner__hitl-icon">👤</span>
            <span className="session-reauth-banner__hitl-text">Manual approval required</span>
          </div>
          <p className="session-reauth-banner__text">{message}</p>
          <div className="session-reauth-banner__actions">
            <button type="button" className="session-reauth-banner__btn session-reauth-banner__btn--primary" onClick={handleSignIn}>
              {signInLabel}
            </button>
            <button type="button" className="session-reauth-banner__btn session-reauth-banner__btn--secondary" onClick={handleLearnMore}>
              Learn more
            </button>
            <button type="button" className="session-reauth-banner__btn session-reauth-banner__btn--ghost" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Session expiry: modal ─────────────────────────────────────────────────
  return (
    <DraggableModal
      isOpen
      onClose={onDismiss}
      title="Sign in required"
      className="session-reauth-modal"
      defaultWidth={460}
      defaultHeight={260}
      minHeight={220}
      footer={
        <div className="session-reauth-banner__actions">
          <button type="button" className="session-reauth-banner__btn session-reauth-banner__btn--primary" onClick={handleSignIn}>
            {signInLabel}
          </button>
          <button type="button" className="session-reauth-banner__btn session-reauth-banner__btn--ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      }
    >
      <p className="session-reauth-banner__text" role="alert" aria-live="assertive">
        {message}
      </p>
      <p className="session-reauth-modal__hint">
        You&apos;ll come back to this page after signing in.
      </p>
    </DraggableModal>
  );
}
