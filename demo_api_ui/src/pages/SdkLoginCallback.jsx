import { useEffect, useState } from "react";
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

export default function SdkLoginCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);

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
        // Under StrictMode the first mount's cleanup fires before this settles;
        // gating on a `cancelled` flag (as the old code did) silently dropped
        // the error and left the page stuck on "Completing sign-in..." forever.
        // The dedupe on `exchangedCodes` above already prevents a duplicate
        // exchange, so it's safe to always report the outcome here.
        setError(err.message);
      }
    })();
  }, [navigate]);

  if (error) {
    return (
      <div style={WRAP_STYLE}>
        <div style={{ color: "#ff7b72", fontWeight: 600 }}>Sign-in failed</div>
        <div>{error}</div>
        <button
          type="button"
          onClick={() => navigate("/sdk-login", { replace: true })}
          style={{
            marginTop: 8,
            font: "inherit",
            fontWeight: 600,
            color: "#fff",
            background: "#2f81f7",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            cursor: "pointer",
          }}
        >
          Back to sign-in
        </button>
      </div>
    );
  }

  return <div style={WRAP_STYLE}>Completing sign-in...</div>;
}
