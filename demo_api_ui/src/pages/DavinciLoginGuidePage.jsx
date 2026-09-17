// /davinci-widget — the DaVinci widget lesson. Laid out on the shared lesson
// shell (components/lesson) so it reads as one course with /davinci-orchestration-sdk:
// Try It Live (the widget beside a live Call Inspector), then the lesson
// sections, then a "What just happened" summary after sign-in.
import { useCallback, useEffect, useState } from "react";
import CallInspector from "../components/davinci/CallInspector";
import WidgetLessonSections, { WIDGET_LESSON_SECTIONS } from "../components/davinci/WidgetLessonSections";
import WidgetRunSummary from "../components/davinci/WidgetRunSummary";
import DraggableModal from "../components/DraggableModal";
import { LessonLayout, Section } from "../components/lesson";
import { refreshWidgetSessionIfNeeded } from "../lib/davinciWidgetClient";
import DavinciLoginWidget from "./DavinciLoginWidget";
import "./DavinciLoginGuidePage.css";

export default function DavinciLoginGuidePage() {
  const isPopout = new URLSearchParams(window.location.search).get("popout") === "1";
  const [calls, setCalls] = useState([]);
  const [signedIn, setSignedIn] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [popupError, setPopupError] = useState("");

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
  const onCall = useCallback((call) => setCalls((prev) => [...prev, call]), []);
  const onSignedIn = useCallback((info) => {
    setSignedIn(info);
    setShowSummary(true);
  }, []);

  // From the summary's links: close it and bring that lesson section into view.
  const goToSection = useCallback((id) => {
    setShowSummary(false);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth" });
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
      <main className="dvl-popout-page">
        <header className="dvl-login-header">
          <p className="dvl-eyebrow">PingOne DaVinci</p>
          <h1>DaVinci Widget Login</h1>
          <p>Run the DaVinci flow in a separate window.</p>
        </header>
        <div className="dvl-popout-card">
          <DavinciLoginWidget />
        </div>
        <button type="button" className="dvl-secondary" onClick={() => window.close()}>
          Close window
        </button>
      </main>
    );
  }

  return (
    <LessonLayout
      title="DaVinci Widget"
      subtitle={
        <>
          Ping&rsquo;s hosted davinci.js runs a PingOne DaVinci flow and draws the flow&rsquo;s own screens
          inside this page. Try it live, watch every API call in the Call Inspector, then read how it works.
        </>
      }
      sections={WIDGET_LESSON_SECTIONS}
      storageKey="dvl-lesson-nav-width"
    >
      <Section id="try-it-live" title="Try It Live">
        <p>
          This is a working sign-in. Every screen below is DaVinci&rsquo;s own HTML, drawn by the widget. Each
          call the widget and this page make appears in the Call Inspector as it happens: config from the BFF,
          the flow start, each screen submit, the final node&rsquo;s tokens, and the session.
        </p>

        <div className="dvl-live">
          <div className="dvl-live-app">
            <div className="dvl-login-header">
              <p className="dvl-eyebrow">PingOne DaVinci</p>
              <h2>DaVinci Widget Login</h2>
              <p>Continue with the embedded widget, or open the same flow in a separate window.</p>
              <div className="dvl-mode-actions">
                <span className="dvl-mode-label">Embedded</span>
                <button type="button" className="dvl-secondary" onClick={openPopout}>
                  Open pop-out
                </button>
              </div>
              {popupError && (
                <p className="dvl-popup-error" role="alert">
                  {popupError}
                </p>
              )}
            </div>
            <DavinciLoginWidget onStart={onStart} onCall={onCall} onSignedIn={onSignedIn} />
            {signedIn && (
              <div className="dvl-signed-in">
                <p>
                  {signedIn.username ? (
                    <>
                      Signed in as <strong>{signedIn.username}</strong>.
                    </>
                  ) : (
                    "Signed in."
                  )}
                </p>
                <button type="button" className="dvl-retry" onClick={() => setShowSummary(true)}>
                  What just happened?
                </button>
              </div>
            )}
          </div>

          <div className="dvl-live-calls">
            <h3>Call Inspector</h3>
            <CallInspector calls={calls} />
          </div>
        </div>
      </Section>

      <WidgetLessonSections calls={calls} />

      <DraggableModal
        isOpen={showSummary}
        onClose={() => setShowSummary(false)}
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
  );
}
