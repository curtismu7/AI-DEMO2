import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWidgetConfig, loadWidget, postWidgetSession } from "../lib/davinciWidgetClient";
import "./DavinciLoginPage.css";

// The live DaVinci widget, embedded as the "Try It Live" section of
// DavinciLoginGuidePage (/davinci-login-guide) — renders the DaVinci flow's own
// screens in-page via davinci.skRenderScreen, separate from and not touching
// the protected BFF redirect login (routes/oauth.js).
//
// username is optional in the flow's Input Schema, so the flow's own Sign On
// screen collects it — this component starts the flow immediately with no
// identifier field of its own.
//
// The flow ends with the PingOne Authentication connector's "Return Success
// Response (Widget Flows)", which hands OIDC tokens to successCallback. The page
// posts them to the BFF, which verifies them and signs the user in, then loads
// the confirmation page. There is no /authorize redirect: the PingOne session
// cookie from the widget's cross-site calls never reaches one (see
// routes/davinciLogin.js).

export default function DavinciLoginWidget() {
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
        successCallback: async (response) => {
          try {
            await postWidgetSession({
              idToken: response?.id_token,
              accessToken: response?.access_token,
            });
            // A full load, not a client-side navigation, so the app shell picks
            // up the session this request just created.
            window.location.assign("/davinci-login/confirmed");
          } catch (err) {
            setError(err.message);
            setStatus("error");
          }
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
