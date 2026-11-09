import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWidgetConfig, loadWidget, postWidgetSession } from "../lib/davinciWidgetClient";
import { installWidgetTrace } from "../lib/davinciWidgetTrace";
import { agentFlowDiagram } from "../services/agentFlowDiagramService";
import DeviceSignInLink from "../components/DeviceSignInLink";
import "./DavinciLoginPage.css";

// The live DaVinci widget, embedded as the "Try It Live" section of
// DavinciLoginGuidePage (/davinci-widget) — renders the DaVinci flow's own
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

// Optional props, so other callers are unchanged:
//   onStatus(status)  reports loading | flow | screen | signedIn | error, so a host page can show what actually happened.
//                     "flow" = the SDK loaded and was asked to draw; "screen" = DaVinci has put content in the flow area.
//   ping              Ping UI Standard host (inside a PingPage): Retry is that view's one primary button (pu-btn--primary).
export default function DavinciLoginWidget({ onCall, onStart, onSignedIn, onStatus, ping = false }) {
  const [status, setStatus] = useState("loading"); // loading | flow | signedIn | error
  const [error, setError] = useState(null);
  const [flowVersion, setFlowVersion] = useState(null);
  const [drawn, setDrawn] = useState(false); // DaVinci has put content in the flow area
  const containerRef = useRef(null);
  const retryRef = useRef(null);
  // Set by Retry: if the restarted run fails again, focus goes to the new Retry button (it sits before the empty flow area).
  const refocusRetryRef = useRef(false);
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

  const reported = status === "flow" && drawn ? "screen" : status;
  useEffect(() => {
    onStatus?.(reported);
  }, [reported, onStatus]);

  // "Flow running" is only true once DaVinci has drawn something. Until then the page reports "flow" (asked, not yet seen).
  useEffect(() => {
    const el = containerRef.current;
    if (status !== "flow" || !el) return undefined;
    if (el.childNodes.length > 0) {
      setDrawn(true);
      return undefined;
    }
    if (typeof MutationObserver === "undefined") return undefined;
    const mo = new MutationObserver(() => {
      if (el.childNodes.length > 0) {
        setDrawn(true);
        mo.disconnect();
      }
    });
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, [status]);

  useEffect(() => {
    if (status === "error" && refocusRetryRef.current) {
      refocusRetryRef.current = false;
      const active = document.activeElement;
      // Only when focus was left on the empty flow area or nowhere; never pull it from something the visitor chose.
      if (!active || active === document.body || active === containerRef.current) {
        retryRef.current?.focus?.({ preventScroll: true });
      }
    } else if (status !== "loading" && status !== "error") {
      refocusRetryRef.current = false;
    }
  }, [status]);

  useEffect(
    () => (onCall ? installWidgetTrace(onCall, window, () => recordingRef.current) : undefined),
    [onCall],
  );

  const start = useCallback(async () => {
    setStatus("loading");
    setDrawn(false);
    setError(null);
    onStart?.();
    recordingRef.current = true;
    // Live trace for /davinci-widget's "The Flow" section (2026-09-12
    // tech debt) — there is no BFF→browser channel for this flow, so the page
    // instruments its own calls into agentFlowDiagramService, same as
    // startMcpToolCall/completeMcpToolCall do for the agent's fetches.
    agentFlowDiagram.startDavinciWidgetLogin();
    try {
      const cfg = await fetchWidgetConfig();
      agentFlowDiagram.updateDavinciWidgetStep("sdk-token", "done");
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
          agentFlowDiagram.updateDavinciWidgetStep("widget-flow", "done");
          try {
            const result = await postWidgetSession({
              idToken: response?.id_token,
              accessToken: response?.access_token,
            });
            recordingRef.current = false;
            agentFlowDiagram.updateDavinciWidgetStep("widget-session", "done");
            agentFlowDiagram.completeDavinciWidgetLogin(true);
            // One-shot signal the app shell listens for (useAuth.js) so TopNav
            // and route guards flip to signed-in. Dispatch only here, never
            // from a listener (that loops — see AIAgent.js:2301).
            window.dispatchEvent(new CustomEvent("userAuthenticated"));
            setStatus("signedIn");
            onSignedIn?.({ username: result?.username || null });
          } catch (err) {
            recordingRef.current = false;
            agentFlowDiagram.completeDavinciWidgetLogin(false, err.message);
            setError(err.message);
            setStatus("error");
          }
        },
        errorCallback: (err) => {
          recordingRef.current = false;
          const message = err?.message || "The DaVinci flow could not be completed.";
          agentFlowDiagram.completeDavinciWidgetLogin(false, message);
          setError(message);
          setStatus("error");
        },
      });
    } catch (err) {
      recordingRef.current = false;
      agentFlowDiagram.completeDavinciWidgetLogin(false, err.message);
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
    refocusRetryRef.current = true;
    // A failed run can leave its own markup behind; the restart must look like a first run (and not count as "drawn").
    containerRef.current?.replaceChildren?.();
    start();
    // The Retry button unmounts as the flow restarts. Keep keyboard focus on the flow it restarted.
    containerRef.current?.focus?.({ preventScroll: true });
  };

  return (
    <div className="dvl-page">
      {flowVersion && <p className="dvl-version">Policy variant: {flowVersion}</p>}
      <DeviceSignInLink />

      {error && <div className="dvl-error" role="alert">{error}</div>}
      {/* Right under the error it answers, not below the 580px widget area. */}
      {status === "error" && (
        <button type="button" ref={retryRef} className={ping ? "pu-btn pu-btn--primary" : "dvl-retry"} onClick={retry}>
          Retry
        </button>
      )}
      {/* Always mounted, so a screen reader announces the text when it appears. */}
      <p className="dvl-status" role="status">{status === "loading" ? "Starting the DaVinci flow..." : ""}</p>

      {/* Always mounted: skRenderScreen needs the node to exist before it runs. A named region so Retry can hand focus to it. */}
      <div ref={containerRef} className="dvWidget dvl-widget" role="region" aria-label="DaVinci flow" tabIndex={-1} />
    </div>
  );
}
