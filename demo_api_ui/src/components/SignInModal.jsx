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
      /* Sized for the COLLAPSED state. `detail` renders as a closed <details>,
         so reserving room for its expanded content left a band of empty white
         under two lines of text. The body scrolls, and the panel is resizable,
         so opening the disclosure costs nothing.

         The numbers are measured, not guessed — DraggableModal has no
         auto-height, so a fixed value that is too large shows as dead space and
         there is nothing in the layout to absorb it. On the live page the parts
         are: titlebar 48 + dm-scroll 114 (text 20, hint 19, details 16, margins,
         plus the wrapper's own 16px top and bottom padding) + footer 56 = 218.
         Without `detail` the disclosure and its margin come off.

         minHeight has to sit BELOW defaultHeight or it silently clamps the
         panel back up and dead space returns. */
      defaultHeight={detail ? 218 : 188}
      minHeight={150}
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
      {/* `dm-body` is bare by contract — no padding, no scroll. Text modals wrap
          in `dm-scroll` for both; without it the copy sits flush against the
          panel edge and reads as unstyled. */}
      <div className="dm-scroll">
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
      </div>
    </DraggableModal>
  );
}
