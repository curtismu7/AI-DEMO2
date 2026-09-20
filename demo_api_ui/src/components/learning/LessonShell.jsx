import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PROVENANCE } from "../../learning/provenance";
import LessonModeToggle from "./LessonModeToggle";
import LessonProvenanceBadge from "./LessonProvenanceBadge";
import "./LessonShell.css";

const MODE_VALUES = new Set(["guided", "standalone"]);

function getFallbackDetail(lesson) {
  const fallback = lesson?.fallback;
  if (!fallback) return "Fallback behavior is not configured yet.";
  return `Fallback: ${fallback.label}`;
}

export default function LessonShell({ lesson, mode = "guided", children, evidence, onRun }) {
  const initialMode = MODE_VALUES.has(mode) ? mode : "guided";
  const [activeMode, setActiveMode] = useState(initialMode);
  const [runState, setRunState] = useState("ready");

  useEffect(() => {
    if (MODE_VALUES.has(mode)) setActiveMode(mode);
  }, [mode]);

  const handleRun = async () => {
    setRunState("running");
    try {
      await onRun?.({ lesson, mode: activeMode });
      setRunState("complete");
    } catch {
      setRunState("error");
    }
  };

  const handleReset = async () => {
    setRunState("ready");
    try {
      await onRun?.({ lesson, mode: activeMode, reset: true });
    } catch {
      // Reset is presenter-local state; a failed cleanup callback must not
      // strand the shell in a running or error state.
    }
  };

  const primaryProvenance = lesson?.provenance?.primary || PROVENANCE.LIVE_CLOUD;
  const explanationRoute = lesson?.route || "/learning";
  const alternateRoute = lesson?.standaloneRoute || explanationRoute;

  return (
    <div className={`lesson-shell lesson-shell--${activeMode}`}>
      <header className="lesson-shell__header">
        <div>
          <p className="lesson-shell__eyebrow">AI Security Academy</p>
          <h1>{lesson?.title || "Lesson"}</h1>
          <p className="lesson-shell__audience">For {lesson?.audience || "sales engineers and customer teams"}</p>
        </div>
        <LessonModeToggle mode={activeMode} onChange={setActiveMode} />
      </header>

      <div className="lesson-shell__status-row">
        <LessonProvenanceBadge
          provenance={primaryProvenance}
          detail={`PingOne cloud tenant preferred. ${getFallbackDetail(lesson)}`}
        />
        <span
          className={`lesson-shell__run-state lesson-shell__run-state--${runState}`}
          role="status"
          aria-live="polite"
        >
          {runState === "ready" && "Ready to run"}
          {runState === "running" && "Running"}
          {runState === "complete" && "Run captured"}
          {runState === "error" && "Run needs attention"}
        </span>
      </div>

      <div className="lesson-shell__body">
        <main className="lesson-shell__content" aria-label={`${lesson?.title || "Lesson"} content`}>
          <div className="lesson-shell__content-inner">{children}</div>
          <div className="lesson-shell__actions">
            <button type="button" className="lesson-shell__run-button" onClick={handleRun} disabled={runState === "running"}>
              {runState === "running" ? "Running…" : "Run live lesson"}
            </button>
            <button type="button" className="lesson-shell__reset-button" onClick={handleReset}>
              Reset demo
            </button>
            {activeMode === "standalone" ? (
              <Link className="lesson-shell__explain-link" to={explanationRoute}>
                Explain what just happened
              </Link>
            ) : (
              <Link className="lesson-shell__explain-link" to={alternateRoute}>
                Open standalone demo
              </Link>
            )}
          </div>
        </main>

        <aside className="lesson-shell__evidence" aria-label="Lesson evidence">
          <div className="lesson-shell__evidence-heading">
            <h2>Evidence</h2>
            <span>{lesson?.evidence?.events?.length || 0} events</span>
          </div>
          {evidence || (
            <ol className="lesson-shell__evidence-list">
              {(lesson?.evidence?.events || []).map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
