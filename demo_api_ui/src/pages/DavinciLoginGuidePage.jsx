// /davinci-login-guide — the DaVinci widget lesson. Laid out on the shared lesson
// shell (components/lesson) so it reads as one course with /davinci-sdk-login:
// Try It Live (the widget beside a live Call Inspector), then the lesson
// sections, then a "What just happened" summary after sign-in.
import { useCallback, useState } from "react";
import CallInspector from "../components/davinci/CallInspector";
import WidgetLessonSections, { WIDGET_LESSON_SECTIONS } from "../components/davinci/WidgetLessonSections";
import WidgetRunSummary from "../components/davinci/WidgetRunSummary";
import DraggableModal from "../components/DraggableModal";
import { LessonLayout, Section } from "../components/lesson";
import DavinciLoginWidget from "./DavinciLoginWidget";
import "./DavinciLoginGuidePage.css";

export default function DavinciLoginGuidePage() {
  const [calls, setCalls] = useState([]);
  const [signedIn, setSignedIn] = useState(null);
  const [showSummary, setShowSummary] = useState(false);

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
