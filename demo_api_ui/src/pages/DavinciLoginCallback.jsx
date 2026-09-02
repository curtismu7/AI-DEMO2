import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./DavinciLoginPage.css";

// OIDC redirect callback for the DaVinci widget login (/davinci-login/callback).
// The widget flow finished, the page followed the BFF's authorize URL, and
// PingOne redirected here with ?code. The BFF holds the PKCE verifier and the
// nonce it armed, so all we send is the code — POST /api/davinci-login/callback
// exchanges it, verifies the ID token echoes the nonce, and establishes the
// session.
//
// A React route rather than a static callback.html, matching SdkLoginCallback:
// a silent-renewal iframe must not be able to instantiate a second client and
// hijack the exchange.

// Authorization codes are single-use. StrictMode double-invokes effects in dev,
// so dedupe per code or the second attempt fails with invalid_grant.
const exchangedCodes = new Set();

export default function DavinciLoginCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const oauthErr = params.get("error");

        if (oauthErr) throw new Error(params.get("error_description") || oauthErr);
        if (!code) throw new Error("No authorization code in callback URL.");

        if (exchangedCodes.has(code)) return;
        exchangedCodes.add(code);

        try {
          const res = await fetch("/api/davinci-login/callback", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ code }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.message || `Sign-in failed (HTTP ${res.status}).`);
          navigate("/", { replace: true });
        } finally {
          exchangedCodes.delete(code);
        }
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [navigate]);

  if (error) {
    return (
      <div className="dvl-callback">
        <div className="dvl-callback-failed">Sign-in failed</div>
        <div>{error}</div>
        <button
          type="button"
          className="dvl-retry"
          onClick={() => navigate("/davinci-login", { replace: true })}
        >
          Back to sign-in
        </button>
      </div>
    );
  }

  return <div className="dvl-callback">Completing sign-in...</div>;
}
