import DraggableModal from "./DraggableModal";
import {
  navigateToAdminOAuthLogin,
  navigateToCustomerOAuthForceLogin,
} from "../utils/authUi";

/**
 * The canonical sign-in INTERRUPT: the session is gone (or was never there) and
 * the user cannot carry on until they sign in. Sibling of `SignInPrompt`, which
 * is for content that still renders.
 *
 * `detail` is the raw provider text (e.g. "PingOne token validation failed: jwt
 * expired"). It is never the first thing the user reads — it lives behind a
 * disclosure so the demo can still show it without leading with it.
 *
 * The sign-in carries `returnTo` (a bare pathname — the BFF's
 * sanitizePostLoginReturnPath rejects query strings), so the user lands back on
 * the page they were interrupted on.
 *
 * @param {{
 *   message: string,
 *   detail?: string,
 *   role?: 'admin' | 'customer',
 *   onDismiss: () => void,
 *   dismissLabel?: string,
 *   footerExtra?: React.ReactNode,
 * }} props
 */
export default function SignInModal({
  message,
  detail,
  role = "customer",
  onDismiss,
  dismissLabel = "Dismiss",
  footerExtra = null,
}) {
  const returnTo =
    typeof window !== "undefined" ? window.location.pathname : undefined;

  const admin = role === "admin";

  const handleSignIn = () => {
    if (admin) navigateToAdminOAuthLogin(returnTo);
    else navigateToCustomerOAuthForceLogin(returnTo);
  };

  return (
    <DraggableModal
      isOpen
      onClose={onDismiss}
      title={admin ? "Admin sign-in required" : "Sign in required"}
      className="signin-modal"
      defaultWidth={460}
      defaultHeight={detail ? 300 : 260}
      minHeight={220}
      footer={
        <div className="signin-modal__actions">
          {footerExtra}
          <button
            type="button"
            className="signin-prompt__btn"
            onClick={handleSignIn}
          >
            {admin ? "Sign in as admin" : "Sign in"}
          </button>
          <button
            type="button"
            className="signin-prompt__btn signin-prompt__btn--ghost"
            onClick={onDismiss}
          >
            {dismissLabel}
          </button>
        </div>
      }
    >
      <p className="signin-modal__text" role="alert" aria-live="assertive">
        {message}
      </p>
      <p className="signin-modal__hint">
        You&apos;ll come back to this page after signing in.
      </p>
      {detail ? (
        <details className="signin-modal__detail">
          <summary>What the server said</summary>
          <code>{detail}</code>
        </details>
      ) : null}
    </DraggableModal>
  );
}
