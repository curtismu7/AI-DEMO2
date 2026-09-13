import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWidgetConfig, loadWidget, postWidgetSession } from "../lib/davinciWidgetClient";
import { installWidgetTrace } from "../lib/davinciWidgetTrace";
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
// posts them to the BFF, which verifies them and signs the user in. The widget
// stays on the page and reports the sign-in through onSignedIn; installWidgetTrace
// records each API call (addresses and status only) for the lesson's Call
// Inspector while a run is in flight.

export default function DavinciLoginWidget({ onCall, onStart, onSignedIn }) {
  const [status, setStatus] = useState("loading"); // loading | flow | signedIn | error
  const [error, setError] = useState(null);
  const [flowVersion, setFlowVersion] = useState(null);
  const containerRef = useRef(null);
  // skRenderScreen mutates the container directly. StrictMode double-invokes
  // effects, so without this the flow renders twice into the same node.
  const renderedRef = useRef(false);
  // Whether a call belongs to the run. installWidgetTrace asks this when each
  // call STARTS: asking when its record arrives dropped /widget-session live,
  // because the trace reads that body after the sign-in has finished. The trace
  // itself is installed once per onCall identity below, independent of start()'s
  // own lifecycle, so StrictMode's mount/uninstall/remount (which happens before
  // start()'s first await resolves) cannot leave it uninstalled for the run.
  const recordingRef = useRef(false);

  useEffect(
    () => (onCall ? installWidgetTrace(onCall, window, () => recordingRef.current) : undefined),
    [onCall],
  );

  const start = useCallback(async () => {
    setStatus("loading");
    setError(null);
    onStart?.();
    recordingRef.current = true;
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
            const result = await postWidgetSession({
              idToken: response?.id_token,
              accessToken: response?.access_token,
            });
            recordingRef.current = false;
            // One-shot signal the app shell listens for (useAuth.js) so TopNav
            // and route guards flip to signed-in. Dispatch only here, never
            // from a listener (that loops — see AIAgent.js:2301).
            window.dispatchEvent(new CustomEvent("userAuthenticated"));
            setStatus("signedIn");
            onSignedIn?.({ username: result?.username || null });
          } catch (err) {
            recordingRef.current = false;
            setError(err.message);
            setStatus("error");
          }
        },
        errorCallback: (err) => {
          recordingRef.current = false;
          setError(err?.message || "The DaVinci flow could not be completed.");
          setStatus("error");
        },
      });
    } catch (err) {
      recordingRef.current = false;
      setError(err.message);
      setStatus("error");
    }
  }, [onStart, onSignedIn]);

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
