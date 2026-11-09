// /davinci-widget — the DaVinci widget lesson. Laid out on the shared lesson
// shell (components/lesson) so it reads as one course with /davinci-orchestration-sdk:
// Try It Live (the widget beside a live Call Inspector), then the lesson
// sections, then a "What just happened" summary after sign-in.
//
// Ping UI Standard (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P4 cards, P5 key-value,
// P7 chips with a word, P9 buttons. The lesson shell (LessonLayout: title band + section nav) stays as the page frame,
// as on /ping-products/verify-recognize. Skipped: P3 PageFrame (the lesson shell is the frame), P6 (the Call Inspector
// is a list of calls, not a two-pane inspector), P8 (the lesson diagrams are the shared lesson figures). The standalone
// shell bar is not added (the app has its own).
//
// Honesty: nothing here is simulated. The widget runs the real DaVinci flow through this app's BFF; the Call Inspector
// lists the calls this browser made. The status chip is read from the widget itself (config fetched, script loaded,
// session accepted by the BFF), never assumed.
//
// P9, one primary per view state. The DaVinci screens inside the widget are DaVinci's own HTML, not ours.
//   starting / flow running (signed out)  : no primary ("Open pop-out" and the lesson header controls are secondaries)
//   flow failed to start or complete      : "Retry" is the one primary
//   signed in                             : "What just happened?" is the one primary
//   summary dialog open                   : the page behind it keeps its primary; the dialog's own Close is DraggableModal's
//   pop-out window                        : "Retry" on failure, otherwise none; "Close window" is a secondary
import { useCallback, useEffect, useRef, useState } from "react";
import CallInspector from "../components/davinci/CallInspector";
import WidgetLessonSections, { WIDGET_LESSON_SECTIONS } from "../components/davinci/WidgetLessonSections";
import WidgetRunSummary from "../components/davinci/WidgetRunSummary";
import DraggableModal from "../components/DraggableModal";
import { LessonLayout, Section } from "../components/lesson";
import { PingPage, SimBanner, Card, StatusChip, KvList } from "../components/pingUi";
import { refreshWidgetSessionIfNeeded } from "../lib/davinciWidgetClient";
import DavinciLoginWidget from "./DavinciLoginWidget";
import "./DavinciLoginGuidePage.css";
import PageHeader from '../components/common/PageHeader';
import DavinciFamilyNav from "../components/davinci/DavinciFamilyNav";

const JOURNEYS = [
  ["01", "Sign in", "Use an existing PingOne account."],
  ["02", "Register", "Create and verify a new account."],
  ["03", "Recover", "Reset a forgotten password."],
];

// What the widget reports (DavinciLoginWidget onStatus) as a chip. Green only for the one thing the page checked end to end.
const STATUS_VIEW = {
  loading: { tone: "neutral", word: "Starting", card: "live" },
  flow: { tone: "info", word: "Flow running", card: "live" },
  signedIn: { tone: "ok", word: "Signed in", card: "ok" },
  error: { tone: "danger", word: "Failed", card: "danger" },
};

// Two texts: the pop-out window has no Call Inspector, so its banner does not mention one.
const BANNER = (
  <>
    <strong>LIVE FLOW, NOTHING SIMULATED</strong> — the widget runs the real DaVinci flow: this page asks the app&apos;s
    BFF for a short-lived SDK token, DaVinci draws each screen, and a completed sign-in makes the BFF verify the
    returned tokens and start a real app session. The Call Inspector lists the calls this browser actually made
    (addresses and status only, never values or tokens). The lesson text is explanation. If the DaVinci connection is
    not configured or not reachable, the widget says so and offers Retry instead of faking a flow.
  </>
);

const POPOUT_BANNER = (
  <>
    <strong>LIVE FLOW, NOTHING SIMULATED</strong> — the widget runs the real DaVinci flow: this page asks the app&apos;s
    BFF for a short-lived SDK token, DaVinci draws each screen, and a completed sign-in makes the BFF verify the
    returned tokens and start a real app session. This window shows only the flow; open the lesson page for the call
    trace. If the DaVinci connection is not configured or not reachable, the widget says so and offers Retry instead of
    faking a flow.
  </>
);

function FlowStatus({ status }) {
  const v = STATUS_VIEW[status] || STATUS_VIEW.loading;
  // The wrapper is always mounted so a screen reader announces the word when it changes.
  return (
    <span role="status" className="dvlg-status">
      <StatusChip tone={v.tone}>{v.word}</StatusChip>
    </span>
  );
}

export default function DavinciLoginGuidePage() {
  const isPopout = new URLSearchParams(window.location.search).get("popout") === "1";
  const [calls, setCalls] = useState([]);
  const [signedIn, setSignedIn] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [popupError, setPopupError] = useState("");
  const [widgetStatus, setWidgetStatus] = useState("loading");
  const summaryTriggerRef = useRef(null);

  // 2026-09-13 tech debt: a widget session carries no refresh token, so a
  // returning visitor whose access token is near expiry gets a silent,
  // invisible re-run of the same flow instead of just losing the session.
  // Non-fatal: on any failure the session simply expires as it does today.
  useEffect(() => {
    refreshWidgetSessionIfNeeded().catch(() => {});
  }, []);

  const onStart = useCallback(() => {
    setCalls([]);
    setSignedIn(null);
  }, []);
  const onCall = useCallback((call) => {
    // The background session refresh can overlap StrictMode's first render.
    // It is unrelated to the journey the visitor is watching.
    if (call.path?.endsWith("/api/davinci-login/session-status")) return;
    setCalls((prev) => [...prev, call]);
  }, []);
  const onSignedIn = useCallback((info) => {
    setSignedIn(info);
    setShowSummary(true);
  }, []);

  // The summary opens by itself on sign-in, so the element focused before it is usually gone from the page.
  // Hand focus back to a control that is always there: the button that reopens the summary.
  const closeSummary = useCallback(() => {
    setShowSummary(false);
    setTimeout(() => summaryTriggerRef.current?.focus?.({ preventScroll: true }), 0);
  }, []);

  // From the summary's links: close it and bring that lesson section into view, with focus on its heading.
  const goToSection = useCallback((id) => {
    setShowSummary(false);
    const section = document.getElementById(id);
    setTimeout(() => {
      const heading = section?.querySelector?.("h2");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus?.({ preventScroll: true });
      }
      section?.scrollIntoView?.({ behavior: "smooth" });
    }, 0);
  }, []);

  const openPopout = useCallback(() => {
    setPopupError("");
    const popup = window.open(
      "/davinci-widget?popout=1",
      "davinci-widget-popup",
      "popup,width=560,height=820,resizable=yes,scrollbars=yes",
    );
    if (popup) {
      popup.focus?.();
    } else {
      setPopupError("Your browser blocked the pop-out. Allow pop-ups for this site, or continue with the embedded widget.");
    }
  }, []);

  if (isPopout) {
    return (
      <PingPage className="dvlg dvlg-popout-page">
        <SimBanner data-testid="dvlg-banner">{POPOUT_BANNER}</SimBanner>
        <PageHeader className="dvl-login-header" eyebrow="PingOne DaVinci" title="DaVinci Widget Login" summary="Run the DaVinci flow in a separate window." />
        <Card tone={(STATUS_VIEW[widgetStatus] || STATUS_VIEW.loading).card} className="dvlg-popout-card">
          <p className="pu-status-line"><FlowStatus status={widgetStatus} />Pop-out window</p>
          <DavinciLoginWidget onStatus={setWidgetStatus} ping />
        </Card>
        <p className="pu-actions dvlg-popout-actions">
          <button type="button" className="pu-btn" onClick={() => window.close()}>
            Close window
          </button>
        </p>
      </PingPage>
    );
  }

  const view = STATUS_VIEW[widgetStatus] || STATUS_VIEW.loading;

  return (
    <PingPage className="dvlg">
      <SimBanner data-testid="dvlg-banner">{BANNER}</SimBanner>
      <LessonLayout
        title="DaVinci Widget"
        pageClassName="dvl-lesson"
        subtitle={
          <>
            Run a live DaVinci journey inside the app. See each screen DaVinci sends and inspect the calls
            that move the journey forward.
          </>
        }
        sections={WIDGET_LESSON_SECTIONS}
        storageKey="dvl-lesson-nav-width"
      >
        <DavinciFamilyNav current="widget" />
        <Section id="try-it-live" title="Try It Live">
          <p className="dvl-live-intro">
            Choose a path on the first DaVinci screen. The trace records each transition and the app session
            when sign-in completes.
          </p>

          <ol className="pu-card-grid dvlg-journeys" aria-label="Paths in this DaVinci flow">
            {JOURNEYS.map(([n, name, hint]) => (
              <li key={n}>
                <Card className="dvlg-journey" title={`${n} · ${name}`}>
                  <p className="pu-note">{hint}</p>
                </Card>
              </li>
            ))}
          </ol>

          <div className="dvlg-live">
            <Card tone={view.card} className={`dvlg-live-app${signedIn ? " dvlg-live-app--signed-in" : ""}`} data-testid="dvlg-live-app">
              <h3 className="pu-h3">Live DaVinci flow</h3>
              <p className="pu-status-line">
                <FlowStatus status={widgetStatus} />
                Embedded in this page. Continue here, or open the same flow in a separate window.
              </p>
              <p className="pu-actions">
                <button type="button" className="pu-btn" onClick={openPopout}>
                  Open pop-out
                </button>
              </p>
              {popupError && (
                <p className="dvl-popup-error pu-note" role="alert">
                  {popupError}
                </p>
              )}
              <DavinciLoginWidget
                onStart={onStart}
                onCall={onCall}
                onSignedIn={onSignedIn}
                onStatus={setWidgetStatus}
                ping
              />
              {signedIn && (
                <div className="dvl-signed-in" data-testid="dvlg-signed-in">
                  <KvList
                    items={[
                      { label: "Signed in as", value: signedIn.username || "Not returned by the BFF" },
                      { label: "App session", value: "Started by the BFF after it verified both tokens" },
                      { label: "Calls recorded", value: String(calls.length) },
                    ]}
                  />
                  <p className="pu-actions">
                    <button
                      type="button"
                      ref={summaryTriggerRef}
                      className="pu-btn pu-btn--primary"
                      onClick={() => setShowSummary(true)}
                    >
                      What just happened?
                    </button>
                  </p>
                </div>
              )}
            </Card>

            <Card tone="neutral" className="dvl-live-calls" data-testid="dvlg-calls">
              <div className="dvl-calls-heading">
                <h3 className="pu-h3">Call Inspector</h3>
                <span role="status">
                  <StatusChip tone="neutral">
                    {calls.length} {calls.length === 1 ? "call" : "calls"} recorded
                  </StatusChip>
                </span>
              </div>
              <CallInspector calls={calls} />
            </Card>
          </div>
        </Section>

        <WidgetLessonSections calls={calls} />

        <DraggableModal
          isOpen={showSummary}
          onClose={closeSummary}
          title="What just happened"
          storageKey="davinci-widget-run-summary"
          defaultWidth={720}
          defaultHeight={620}
        >
          <div className="dm-scroll">
            <WidgetRunSummary username={signedIn?.username} calls={calls} onNavigate={goToSection} />
          </div>
        </DraggableModal>
      </LessonLayout>
    </PingPage>
  );
}
