import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import { startRoleSwitch } from "../utils/roleSwitch";
import { ForgotPasswordLink } from "./ForgotPasswordFlow";

/**
 * The canonical "you need to sign in" affordance for content that still renders.
 * Standing rule: a page must always render; where its data needs auth, show
 * this prompt — never a silent redirect, dead-end text, or raw 401.
 *
 * Two form factors, one design:
 *   variant="card"  (default) — the page/panel owns the whole area
 *   variant="strip"           — a bar above content that still renders below it
 *
 * `admin` switches the CTA to the admin OAuth flow (via POST /api/auth/switch,
 * which works signed-out) for surfaces backed by admin-gated endpoints.
 * `returnTo` is a same-origin path plus a simple ?query — never window.location.href
 * (the BFF's sanitizePostLoginReturnPath rejects full URLs and '#').
 */
export default function SignInPrompt({
  message,
  admin = false,
  variant = "card",
  // A full-page gate (SignInRequired) is the page's only heading, so it passes 1; a prompt inside a panel keeps h3.
  headingLevel = 3,
  returnTo = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search || ""}` : undefined,
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

  const heading = admin ? "Admin sign-in required" : "Sign in required";
  const body =
    message ||
    (admin
      ? "This content needs an admin session."
      : "This content needs a signed-in session.");
  const cta = admin ? "Sign in as admin" : "Sign in";

  if (variant === "strip") {
    return (
      <div className="signin-strip" role="alert">
        <p className="signin-strip__text">
          <strong className="signin-strip__title">{heading}</strong> {body}
        </p>
        <button
          type="button"
          className="signin-prompt__btn signin-prompt__btn--sm"
          onClick={handleSignIn}
        >
          {cta}
        </button>
      </div>
    );
  }

  const Heading = `h${headingLevel}`;
  return (
    <div className="signin-prompt" role="alert">
      <Heading className="signin-prompt__title">{heading}</Heading>
      <p className="signin-prompt__text">{body}</p>
      <button type="button" className="signin-prompt__btn" onClick={handleSignIn}>
        {cta}
      </button>
      {!admin && <ForgotPasswordLink />}
    </div>
  );
}
