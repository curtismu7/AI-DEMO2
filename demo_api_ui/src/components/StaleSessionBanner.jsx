import { useEffect, useRef, useState } from "react";
import { getCachedJson } from "../services/cachedStatusService";
import { navigateToCustomerOAuthForceLogin } from "../utils/authUi";
import "./StaleSessionBanner.css";

/**
 * StaleSessionBanner — proactive "sign in again" notice.
 *
 * When the BFF reports staleSession:true the banner first attempts a silent
 * re-authentication via prompt=none (OIDC §3.1.2.1). If the user still has
 * an active PingOne SSO session the page reloads with fresh tokens and the
 * banner never appears. If PingOne has no session (?silent_reauth_failed=1
 * is returned), or if the silent attempt was already made this page load,
 * the manual "Sign in again" button is shown.
 *
 * The silent attempt is made once per page load (tracked by sessionStorage so
 * it survives the redirect round-trip) to avoid an infinite redirect loop.
 */
const POLL_MS = 30_000;
const SILENT_ATTEMPTED_KEY = "bx-silent-reauth-attempted";

function getSilentReauthUrl(returnTo) {
  const apiUrl =
    process.env.REACT_APP_API_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const rt = returnTo || (typeof window !== "undefined" ? window.location.pathname : "/dashboard");
  return `${apiUrl}/api/auth/oauth/user/silent-reauth?return_to=${encodeURIComponent(rt)}`;
}

export default function StaleSessionBanner() {
  const [stale, setStale] = useState(null); // { reason } | null
  const silentAttemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await getCachedJson("/api/auth/oauth/user/status");
        if (cancelled) return;
        const d = res?.data;
        if (!d?.staleSession) {
          setStale(null);
          return;
        }
        // Detect if we just returned from a failed silent reauth attempt.
        // Read inside the effect (not at render time) so URL cleanup hooks
        // that strip this param don't create a stale-closure race.
        const silentFailed =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("silent_reauth_failed") === "1";

        // Attempt silent reauth once before showing the banner.
        // Skip if: we already tried this page load, the URL says it already failed,
        // or sessionStorage says we tried in a previous load this session.
        const alreadyTried =
          silentAttemptedRef.current ||
          silentFailed ||
          sessionStorage.getItem(SILENT_ATTEMPTED_KEY) === "1";
        if (!alreadyTried) {
          silentAttemptedRef.current = true;
          sessionStorage.setItem(SILENT_ATTEMPTED_KEY, "1");
          window.location.href = getSilentReauthUrl(window.location.pathname);
          return;
        }
        setStale({ reason: d.staleReason });
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

  // Clear the silent-reauth attempt guard whenever the session becomes valid again
  // (e.g. user signs in from another tab).
  useEffect(() => {
    if (!stale) {
      sessionStorage.removeItem(SILENT_ATTEMPTED_KEY);
    }
  }, [stale]);

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
        onClick={() => {
          sessionStorage.removeItem(SILENT_ATTEMPTED_KEY);
          navigateToCustomerOAuthForceLogin();
        }}
      >
        Sign in again
      </button>
    </div>
  );
}
