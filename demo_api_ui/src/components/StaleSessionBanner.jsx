import { useEffect, useState } from "react";
import { getCachedJson } from "../services/cachedStatusService";
import { navigateToCustomerOAuthForceLogin } from "../utils/authUi";
import "./StaleSessionBanner.css";

/**
 * StaleSessionBanner — passive "sign in again" notice.
 *
 * When the BFF reports staleSession:true, this renders a notice with a manual
 * "Sign in again" button. It NEVER navigates on its own.
 *
 * It used to attempt a prompt=none silent re-authentication first. That was
 * removed: signing in is a deliberate user action, and a component that can
 * navigate the top-level window on a timer is a footgun. When PingOne had no
 * SSO session it returned login_required forever, and each retry was a full
 * page navigation — which also swallowed the user's clicks on the real Sign In
 * button, because the loop yanked the page away mid-navigation.
 *
 * Not currently mounted anywhere: the customer dashboards were the only mount
 * sites, and they must not check authentication on load (a signed-out visitor
 * is a supported state — only protected prompts require PingOne authn).
 */
const POLL_MS = 30_000;

export default function StaleSessionBanner() {
  const [stale, setStale] = useState(null); // { reason } | null

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await getCachedJson("/api/auth/oauth/user/status");
        if (cancelled) return;
        const d = res?.data;
        setStale(d?.staleSession ? { reason: d.staleReason } : null);
      } catch {
        /* network blips: keep last known state */
      }
    };
    check();
    const t = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!stale) return null;

  return (
    <div className="stale-session-banner" role="alert">
      <span className="stale-session-banner__text">
        <strong>Your sign-in has expired.</strong>{" "}
        {stale.reason === "tokens_missing"
          ? "The session could not be renewed automatically — agent and transaction features will fail until you sign in again."
          : "Agent and transaction features will fail until you sign in again."}
      </span>
      <button
        type="button"
        className="stale-session-banner__btn"
        onClick={navigateToCustomerOAuthForceLogin}
      >
        Sign in again
      </button>
    </div>
  );
}
