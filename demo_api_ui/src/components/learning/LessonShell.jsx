import { isValidElement, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PROVENANCE } from "../../learning/provenance";
import AcademyEvidenceMap from "./AcademyEvidenceMap";
import LessonModeToggle from "./LessonModeToggle";
import LessonProvenanceBadge from "./LessonProvenanceBadge";
import "./LessonShell.css";

const MODE_VALUES = new Set(["guided", "standalone"]);
const PROVENANCE_VALUES = new Set(Object.values(PROVENANCE));
const RUN_RESULT_STATUSES = new Set(["observed", "no-evidence", "not-run", "unavailable"]);

export function normalizeLessonRunResult(result) {
  if (
    !result ||
    typeof result !== "object" ||
    !("evidence" in result) ||
    !result.result ||
    typeof result.result !== "object" ||
    !RUN_RESULT_STATUSES.has(result.result.status) ||
    (result.result.status === "observed" && !PROVENANCE_VALUES.has(result.provenance))
  ) {
    return null;
  }

  return {
    provenance: result.result.status === "observed" ? result.provenance : null,
    evidence: result.evidence,
    result: result.result,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

function getFallbackDetail(lesson) {
  const fallback = lesson?.fallback;
  if (!fallback) return "Fallback behavior is not configured yet.";
  return `Fallback: ${fallback.label}`;
}

function formatEvidence(event) {
  if (!event || typeof event !== "object") return String(event);
  if (typeof event.label === "string" && Number.isFinite(event.count)) {
    return `${event.label}: ${event.count}`;
  }
  return JSON.stringify(event);
}

export default function LessonShell({ lesson, mode = "guided", children, evidence, onRun, onModeChange }) {
  const initialMode = MODE_VALUES.has(mode) ? mode : "guided";
  const [activeMode, setActiveMode] = useState(initialMode);
  const [runState, setRunState] = useState(typeof onRun === "function" ? "ready" : "unavailable");
  const [observedResult, setObservedResult] = useState(null);
  const [runError, setRunError] = useState("");
  const requestGeneration = useRef(0);

  useEffect(() => {
    if (MODE_VALUES.has(mode)) setActiveMode(mode);
  }, [mode]);

  const handleModeChange = (nextMode) => {
    setActiveMode(nextMode);
    onModeChange?.(nextMode);
  };

  const handleRun = async () => {
    if (typeof onRun !== "function") return;
    const generation = ++requestGeneration.current;
    setRunState("running");
    setObservedResult(null);
    setRunError("");
    try {
      const normalized = normalizeLessonRunResult(await onRun({ lesson, mode: activeMode }));
      if (generation !== requestGeneration.current) return;
      if (!normalized) {
        setRunState("error");
        setRunError("No normalized run result was returned.");
        return;
      }
      if (normalized.result.status !== "observed") {
        setRunState(normalized.result.status);
        setRunError(normalized.warnings[0] || "No lesson evidence was captured.");
        return;
      }
      setObservedResult(normalized);
      setRunState("complete");
    } catch {
      if (generation !== requestGeneration.current) return;
      setRunState("error");
      setRunError("Evidence check failed.");
    }
  };

  const handleReset = async () => {
    const generation = ++requestGeneration.current;
    setObservedResult(null);
    setRunError("");
    if (typeof onRun !== "function") {
      setRunState("unavailable");
      return;
    }
    setRunState("resetting");
    try {
      await onRun({ lesson, mode: activeMode, reset: true });
      if (generation === requestGeneration.current) setRunState("ready");
    } catch {
      if (generation !== requestGeneration.current) return;
      setRunState("reset-error");
      setRunError("Reset failed. The previous run may still be active.");
    }
  };

  const explanationRoute = lesson?.route || "/learning";
  const alternateRoute = lesson?.standaloneRoute || explanationRoute;
  const observedEvidence = observedResult?.evidence;
  const evidenceCount = Array.isArray(observedEvidence) ? observedEvidence.length : observedResult ? 1 : 0;

  const renderEvidence = () => {
    if (isValidElement(evidence)) return evidence;
    if (Array.isArray(observedEvidence)) {
      return (
        <ol className="lesson-shell__evidence-list">
          {observedEvidence.map((event, index) => <li key={`${formatEvidence(event)}-${index}`}>{formatEvidence(event)}</li>)}
        </ol>
      );
    }
    if (observedEvidence && typeof observedEvidence === "object") {
      return <pre className="lesson-shell__evidence-json">{JSON.stringify(observedEvidence, null, 2)}</pre>;
    }
    return <p className="lesson-shell__empty-evidence">No observed evidence yet.</p>;
  };

  return (
    <div className={`lesson-shell lesson-shell--${activeMode}`}>
      <header className="lesson-shell__header">
        <div>
          <p className="lesson-shell__eyebrow">AI Security Academy</p>
          <h1>{lesson?.title || "Lesson"}</h1>
          <p className="lesson-shell__audience">For {lesson?.audience || "sales engineers and customer teams"}</p>
        </div>
        <LessonModeToggle mode={activeMode} onChange={handleModeChange} />
      </header>

      <div className="lesson-shell__status-row">
        <LessonProvenanceBadge
          provenance={observedResult?.provenance}
          detail={
            observedResult
              ? `Observed evidence snapshot. ${getFallbackDetail(lesson)}`
              : onRun
                ? "Read-only evidence check connected. No lesson action runs here."
                : "No direct evidence check is connected. Use the linked demo to run this lesson."
          }
        />
        <span
          className={`lesson-shell__run-state lesson-shell__run-state--${runState}`}
          role="status"
          aria-live="polite"
        >
          {runState === "ready" && "Ready to check evidence"}
          {runState === "running" && "Checking evidence"}
          {runState === "resetting" && "Resetting"}
          {runState === "complete" && "Evidence captured"}
          {runState === "no-evidence" && runError}
          {runState === "not-run" && runError}
          {runState === "unavailable" && (runError || "Ready to configure")}
          {runState === "error" && runError}
          {runState === "reset-error" && "Reset failed"}
        </span>
      </div>

      <div className="lesson-shell__body">
        <section className="lesson-shell__content" aria-label={`${lesson?.title || "Lesson"} content`}>
          <div className="lesson-shell__content-inner">{children}</div>
          <div className="lesson-shell__actions">
            <button type="button" className="lesson-shell__run-button" onClick={handleRun} disabled={!onRun || runState === "running" || runState === "resetting"}>
              {runState === "running" ? "Checking evidence…" : "Check live evidence"}
            </button>
            <button type="button" className="lesson-shell__reset-button" onClick={handleReset} disabled={!onRun || runState === "resetting"}>
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
        </section>

        <aside className="lesson-shell__evidence" aria-label="Lesson evidence">
          <div className="lesson-shell__evidence-heading">
            <h2>Evidence</h2>
            <span>{evidenceCount} observed events</span>
          </div>
          {observedResult ? renderEvidence() : <p className="lesson-shell__empty-evidence">No observed evidence yet.</p>}
        </aside>
      </div>

      <AcademyEvidenceMap lesson={lesson} evidence={observedEvidence} />
    </div>
  );
}
