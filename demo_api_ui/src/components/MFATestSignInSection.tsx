import { FC, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import { openAdminSignIn, openSignIn } from "../utils/signInService";

const PROVIDER_LABEL: Record<string, string> = {
  pingfederate: "PingFederate",
  pingone: "PingOne",
  pingone_sso: "PingOne",
};

/**
 * Sign-in MFA — opens the app's real sign-in pop-up (PiFlowSignInModal) in each
 * mode it supports, so the sign-in MFA steps (device picker, code, passkey) run
 * exactly as they do for a customer or admin. Each button forces a fresh sign-in
 * and comes back to this page.
 */
const MFATestSignInSection: FC = () => {
  const [session, setSession] = useState<{ username?: string; provider?: string } | null>(null);

  useEffect(() => {
    apiClient
      .get("/api/auth/oauth/user/status")
      .then(({ data }) =>
        setSession({
          username: data?.authenticated ? data?.user?.username : undefined,
          provider: PROVIDER_LABEL[data?.loginProvider] || data?.loginProvider,
        }),
      )
      .catch(() => setSession({}));
  }, []);

  const pf = session?.provider === "PingFederate";

  const deviceFirst = () => openSignIn({ returnTo: "/mfa-test", force: true });
  // ?signin=mfa is the modal's Multi_Factor selector: password, then an MFA step.
  const passwordThenMfa = () => {
    window.history.replaceState(null, "", "/mfa-test?signin=mfa");
    openSignIn({ returnTo: "/mfa-test?signin=mfa", force: true });
  };
  const admin = () => openAdminSignIn({ returnTo: "/mfa-test", force: true });

  return (
    <div className="mfa-test-card mfa-test-card--pending" data-testid="mfa-signin-card">
      <div className="mfa-test-card__api-preview">
        <div className="mfa-test-card__api-header">
          <span className="mfa-test-card__method mfa-test-card__method--get">GET</span>
          <code className="mfa-test-card__endpoint">/api/auth/oauth/user/login?pi_flow=1</code>
          <a
            href="https://developer.pingidentity.com/pingone-api/auth/authentication-flows.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mfa-test-card__docs-link"
            title="PingOne flows (pi.flow)"
          >
            Docs
          </a>
        </div>
      </div>

      <p className="info-text">
        Opens the app&apos;s own sign-in pop-up. It drives the PingOne or PingFederate flow without a
        redirect, so the MFA steps (device picker, one-time code, passkey) run exactly as they do at
        sign-in.
      </p>
      <p className="info-text" data-testid="mfa-signin-session">
        {session?.username ? `Signed in as ${session.username}` : "Not signed in"}
        {session?.provider ? ` · login provider: ${session.provider}` : ""}
      </p>
      {pf && (
        <p className="info-text">
          PingFederate has no device-first step, so every option opens on the password form.
        </p>
      )}

      <div className="mfa-test-card__actions">
        <button type="button" className="mfa-test-button mfa-test-button--primary" onClick={deviceFirst} data-testid="mfa-signin-device">
          Device-first sign-in
        </button>
        <button type="button" className="mfa-test-button mfa-test-button--secondary" onClick={passwordThenMfa} data-testid="mfa-signin-mfa">
          Password + MFA
        </button>
        <button type="button" className="mfa-test-button mfa-test-button--secondary" onClick={admin} data-testid="mfa-signin-admin">
          Admin sign-in
        </button>
      </div>
    </div>
  );
};

export default MFATestSignInSection;
