import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import { startRoleSwitch } from "../utils/roleSwitch";

/**
 * Inline sign-in call-to-action for content that needs a session.
 * Standing rule: a page must always render; where its data needs auth, show
 * this prompt — never a silent redirect, dead-end text, or raw 401.
 *
 * `admin` switches the CTA to the admin OAuth flow (via POST /api/auth/switch,
 * which works signed-out) for surfaces backed by admin-gated endpoints.
 * `returnTo` must be a bare path — the BFF's sanitizePostLoginReturnPath
 * rejects query strings.
 */
export default function SignInPrompt({
  message,
  admin = false,
  returnTo = typeof window !== "undefined" ? window.location.pathname : undefined,
}) {
  const handleSignIn = () => {
    if (admin) {
      startRoleSwitch("admin", returnTo).catch((e) =>
        console.error("[SignInPrompt] Admin sign-in failed:", e.message),
      );
    } else {
      navigateToCustomerOAuthLogin(returnTo);
    }
  };

  return (
    <div className="signin-prompt" role="alert">
      <h3 className="signin-prompt__title">
        {admin ? "Admin sign-in required" : "Sign in required"}
      </h3>
      <p className="signin-prompt__text">
        {message ||
          (admin
            ? "This content needs an admin session."
            : "This content needs a signed-in session.")}
      </p>
      <button type="button" className="signin-prompt__btn" onClick={handleSignIn}>
        {admin ? "Sign in as admin" : "Sign in"}
      </button>
    </div>
  );
}
