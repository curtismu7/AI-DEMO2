import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import JourneyProgress from "../components/learning/JourneyProgress";
import JourneyStep from "../components/learning/JourneyStep";
import TenantReadinessStrip from "../components/learning/TenantReadinessStrip";
import { getLesson } from "../learning/lessonCatalog";
import { PROVENANCE } from "../learning/provenance";
import {
  canObserveLesson,
  getTenantReadiness,
  resetLesson,
  runLesson,
} from "../services/lessonExecutionService";
import "./GuidedJourneyPage.css";

const JOURNEY_SEQUENCE = Object.freeze([
  ["agent-landscape", "Discover agents"],
  ["login", "PingOne login"],
  ["delegation", "Delegation"],
  ["consumer-agent", "Personal Agent"],
  ["customer-service-agent", "Digital Assistant"],
  ["mcp", "MCP"],
  ["authorize", "PingOne Authorize"],
  ["hitl-step-up", "HITL and step-up"],
  ["a2a-delegation", "A2A delegation"],
  ["privilege-mcp", "Privilege MCP"],
  ["threat-defense", "Attack defense"],
  ["lifecycle", "Agent lifecycle"],
  ["evidence-timeline", "Evidence summary"],
]);

const PROVENANCE_LABELS = Object.freeze({
  [PROVENANCE.LIVE_CLOUD]: "LIVE CLOUD",
  [PROVENANCE.LIVE_LOCAL]: "LIVE LOCAL",
  [PROVENANCE.RECORDED]: "RECORDED",
  [PROVENANCE.SIMULATED]: "SIMULATED",
});

function buildJourneySteps() {
  return JOURNEY_SEQUENCE.map(([lessonId, stage]) => ({
    lesson: getLesson(lessonId),
    stage,
  })).filter((step) => step.lesson);
}

export default function GuidedJourneyPage({
  loadReadiness = getTenantReadiness,
  executeLesson = runLesson,
  resetExecution = resetLesson,
  readinessPollIntervalMs = 30000,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const steps = useMemo(buildJourneySteps, []);
  const requestedStep = new URLSearchParams(location.search).get("step");
  const requestedIndex = steps.findIndex(
    (step) => step.lesson.id === requestedStep,
  );
  const activeIndex = requestedIndex >= 0 ? requestedIndex : 0;
  const activeStep = steps[activeIndex];
  const [completed, setCompleted] = useState(() => new Set());
  const [skipped, setSkipped] = useState(() => new Set());
  const [runResults, setRunResults] = useState({});
  const [journeyGeneration, setJourneyGeneration] = useState(0);
  const journeyGenerationRef = useRef(0);

  const selectStep = (index, options = {}) => {
    const next = steps[index];
    if (!next) return;
    navigate(`${location.pathname}?step=${next.lesson.id}`, options);
  };

  const handleNext = () => {
    if (activeIndex >= steps.length - 1) return;
    setCompleted((current) => new Set(current).add(activeStep.lesson.id));
    setSkipped((current) => {
      const next = new Set(current);
      next.delete(activeStep.lesson.id);
      return next;
    });
    selectStep(activeIndex + 1);
  };

  const handleSkip = () => {
    if (activeIndex >= steps.length - 1) return;
    setSkipped((current) => new Set(current).add(activeStep.lesson.id));
    setCompleted((current) => {
      const next = new Set(current);
      next.delete(activeStep.lesson.id);
      return next;
    });
    selectStep(activeIndex + 1);
  };

  const handleRestart = () => {
    journeyGenerationRef.current += 1;
    setCompleted(new Set());
    setSkipped(new Set());
    setRunResults({});
    setJourneyGeneration((current) => current + 1);
    selectStep(0, { replace: true });
  };

  const handleRun = async ({ reset, ...input }) => {
    const lessonId = activeStep.lesson.id;
    const requestGeneration = journeyGenerationRef.current;
    if (reset) {
      const result = await resetExecution(lessonId);
      if (requestGeneration !== journeyGenerationRef.current) return result;
      setRunResults((current) => {
        const next = { ...current };
        delete next[lessonId];
        return next;
      });
      return result;
    }

    const result = await executeLesson(lessonId, input);
    if (requestGeneration !== journeyGenerationRef.current) return result;
    setRunResults((current) => ({ ...current, [lessonId]: result }));
    return result;
  };

  const evidenceSteps = steps.slice(0, -1);
  const capturedRuns = evidenceSteps.filter(
    (step) => runResults[step.lesson.id]?.result?.status === "observed",
  );
  const summary =
    activeIndex === steps.length - 1 ? (
      <section
        className="journey-summary"
        aria-label="Journey evidence summary"
      >
        <h3>Journey evidence</h3>
        <div className="journey-summary__counts">
          <strong>
            {completed.size} completed {completed.size === 1 ? "step" : "steps"}
          </strong>
          <strong>
            {skipped.size} skipped {skipped.size === 1 ? "step" : "steps"}
          </strong>
          <strong>
            {capturedRuns.length} captured evidence{" "}
            {capturedRuns.length === 1 ? "check" : "checks"}
          </strong>
        </div>
        <ul>
          {evidenceSteps.map((step) => {
            const result = runResults[step.lesson.id];
            const observed = result?.result?.status === "observed";
            let detail = "Not visited";
            if (skipped.has(step.lesson.id)) detail = "Skipped";
            else if (observed)
              detail = PROVENANCE_LABELS[result.provenance] || "Observed";
            else if (result)
              detail = `No observed evidence (${result.result.status})`;
            else if (completed.has(step.lesson.id))
              detail = "Progressed without captured evidence";
            return (
              <li key={step.lesson.id}>
                <span>{step.stage}</span>
                <strong>{detail}</strong>
              </li>
            );
          })}
        </ul>
      </section>
    ) : null;

  return (
    <div className="guided-journey">
      <header className="guided-journey__intro">
        <div>
          <p className="guided-journey__kicker">AI Security Academy</p>
          <h1>Guided customer journey</h1>
          <p>
            Follow one customer story from the business risk to the evidence
            that proves every agent action stayed governed.
          </p>
        </div>
        <span className="guided-journey__position">
          {activeIndex + 1} / {steps.length}
        </span>
      </header>

      <TenantReadinessStrip
        loadReadiness={loadReadiness}
        pollIntervalMs={readinessPollIntervalMs}
      />

      <JourneyProgress
        steps={steps}
        activeIndex={activeIndex}
        completed={completed}
        skipped={skipped}
        onSelect={selectStep}
      />

      <JourneyStep
        key={`${activeStep.lesson.id}-${journeyGeneration}`}
        step={activeStep}
        stepNumber={activeIndex + 1}
        totalSteps={steps.length}
        onRun={
          activeIndex < steps.length - 1 && canObserveLesson(activeStep.lesson.id)
            ? handleRun
            : undefined
        }
        summary={summary}
      />

      <div className="guided-journey__controls" aria-label="Presenter controls">
        <button
          type="button"
          className="guided-journey__control guided-journey__control--secondary"
          onClick={() => selectStep(activeIndex - 1)}
          disabled={activeIndex === 0}
        >
          Previous step
        </button>
        <button
          type="button"
          className="guided-journey__control guided-journey__control--secondary"
          onClick={handleRestart}
        >
          Restart journey
        </button>
        <button
          type="button"
          className="guided-journey__control guided-journey__control--secondary"
          onClick={handleSkip}
          disabled={activeIndex === steps.length - 1}
        >
          Skip step
        </button>
        <button
          type="button"
          className="guided-journey__control guided-journey__control--primary"
          onClick={handleNext}
          disabled={activeIndex === steps.length - 1}
        >
          Next step
        </button>
      </div>
    </div>
  );
}
