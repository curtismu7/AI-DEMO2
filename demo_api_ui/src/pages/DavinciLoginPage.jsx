import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWidgetConfig, loadWidget } from "../lib/davinciWidgetClient";
import "./DavinciLoginPage.css";

// DaVinci Widget login sandbox (/davinci-login). Renders the DaVinci flow's own
// screens in-page via davinci.skRenderScreen, separate from and not touching the
// protected BFF redirect login (routes/oauth.js). See
// docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.
//
// username is optional in the flow's Input Schema, so the flow's own Sign On
// screen collects it — this page starts the flow immediately with no
// identifier field of its own.
//
// The widget ends at a DaVinci sessionToken, not an OIDC code — Ping's docs tie
// OIDC issuance to the redirect integration, and the two are mutually exclusive
// on the flow's "PingOne Flow" toggle. So on success we hand PingOne the DaVinci
// session as the DV-ST cookie and follow the authorize URL the BFF prepared:
// PingOne recognises the session, does not re-challenge, and redirects to
// /davinci-login/callback with a code plus an ID token echoing the BFF's nonce.

export default function DavinciLoginPage() {
  const [status, setStatus] = useState("loading"); // loading | flow | error
  const [error, setError] = useState(null);
  const [flowVersion, setFlowVersion] = useState(null);
  const containerRef = useRef(null);
  // skRenderScreen mutates the container directly. StrictMode double-invokes
  // effects, so without this the flow renders twice into the same node.
  const renderedRef = useRef(false);

  const start = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const cfg = await fetchWidgetConfig();
      setFlowVersion(cfg.flowVersion || null);
      const davinci = await loadWidget();
      setStatus("flow");

      davinci.skRenderScreen(containerRef.current, {
        config: {
          method: "runFlow",
          apiRoot: cfg.apiRoot,
          accessToken: cfg.accessToken,
          companyId: cfg.companyId,
          policyId: cfg.policyId,
          includeHttpCredentials: true,
        },
        useModal: false,
        successCallback: (response) => {
          if (response?.sessionToken) {
            document.cookie = `DV-ST=${response.sessionToken}; path=/; max-age=86400; secure; samesite=lax`;
          }
          window.location.assign(cfg.authorizeUrl);
        },
        errorCallback: (err) => {
          setError(err?.message || "The DaVinci flow could not be completed.");
          setStatus("error");
        },
      });
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (renderedRef.current) return;
    renderedRef.current = true;
    start();
  }, [start]);

  const retry = () => {
    renderedRef.current = true;
    start();
  };

  return (
    <div className="dvl-page">
      <h1 className="dvl-title">DaVinci Widget Login</h1>
      {flowVersion && <p className="dvl-version">Flow version: {flowVersion}</p>}

      {error && <div className="dvl-error">{error}</div>}
      {status === "loading" && <p className="dvl-status">Starting the DaVinci flow...</p>}

      {/* Always mounted: skRenderScreen needs the node to exist before it runs. */}
      <div ref={containerRef} className="dvWidget dvl-widget" />

      {status === "error" && (
        <button type="button" className="dvl-retry" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}
