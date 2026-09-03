import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSdkClient, isSdkError } from "../lib/oidcSdkClient";

// OIDC redirect callback for the SDK centralized-login demo.
// PingOne redirects here with ?code&state. We exchange the code for tokens via the
// SDK (which validates the stored state + PKCE verifier and persists tokens through
// the LMDB-backed custom storage adapter), then return to /sdk-login.
//
// Implemented as a React route — NOT a static callback.html — so a silent-renewal
// iframe can't instantiate a second OIDC client and hijack the code exchange.
const WRAP_STYLE = {
  minHeight: "60vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "2rem",
  color: "#93a4c0",
  font: '14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
};

// Authorization codes are single-use. React StrictMode double-invokes effects in
// dev, so dedupe the exchange per code to avoid a second invalid_grant attempt.
// Cleared after each exchange settles so the Set does not grow unbounded.
const exchangedCodes = new Set();

// Reloading this page (same ?code&state still in the URL bar) survives past the
// in-memory Set above — the JS context restarts, and the SDK has already deleted
// its sessionStorage state/PKCE entry on the first read. That reload then throws
// the SDK's raw "State mismatch" error, which reads as a bug rather than "this
// link was already used." Persist the attempted code in sessionStorage (which
// does survive a reload) so a repeat visit gets a clear explanation instead.
const ATTEMPTED_CODE_KEY = "sdk-login-attempted-code";

export default function SdkLoginCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");
        const oauthErr = params.get("error");

        if (oauthErr) {
          throw new Error(params.get("error_description") || oauthErr);
        }
        if (!code) {
          throw new Error("No authorization code in callback URL.");
        }
        if (!state) {
          throw new Error(
            "Missing state parameter - possible CSRF or stale callback."
          );
        }

        // StrictMode double-invoke: skip if this code is already being exchanged.
        if (exchangedCodes.has(code)) return;
        exchangedCodes.add(code);

        // A reload of this exact callback URL means the code/state were already
        // consumed on the first pass — the SDK's exchange call would otherwise
        // fail with a raw "State mismatch" further down.
        if (sessionStorage.getItem(ATTEMPTED_CODE_KEY) === code) {
          throw new Error(
            "This sign-in link has already been used. Go back and sign in again."
          );
        }
        sessionStorage.setItem(ATTEMPTED_CODE_KEY, code);

        try {
          const client = await getSdkClient();
          const result = await client.token.exchange(code, state);
          if (isSdkError(result)) {
            // 'state_error' means the stored state/PKCE verifier didn't match —
            // usually a stale or replayed callback.
            throw new Error(result.error || "Token exchange failed.");
          }
          navigate("/sdk-login", { replace: true });
        } finally {
          exchangedCodes.delete(code);
        }
      } catch (err) {
        // This is a demo: a technical error page (state mismatch, an already-used
        // link, a stale callback) isn't useful to anyone. Clear whatever local
        // token state might be lingering and drop the visitor straight back on
        // the sign-in screen for a fresh attempt, instead of making them read an
        // error and click a button.
        console.error("[sdk-login] callback failed, auto-recovering:", err.message);
        try {
          const client = await getSdkClient();
          await client.token.revoke();
        } catch {
          // best effort — the client may never have initialized
        }
        navigate("/sdk-login", { replace: true });
      }
    })();
  }, [navigate]);

  return <div style={WRAP_STYLE}>Completing sign-in...</div>;
}
