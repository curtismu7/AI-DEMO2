import { Link } from "react-router-dom";
import LessonProvenanceBadge from "./LessonProvenanceBadge";
import PresenterNotes from "./PresenterNotes";

function actionStatusText(actionState) {
  if (actionState === "checking") return "Checking evidence";
  if (actionState === "observed") return "Evidence captured.";
  if (actionState === "no-evidence")
    return "No observed evidence was captured.";
  if (actionState === "check-error") return "Evidence check unavailable.";
  if (actionState === "resetting") return "Resetting launcher state";
  if (actionState === "reset") return "Reset ready. Tenant state unchanged.";
  if (actionState === "reset-error") {
    return "Reset unavailable. Follow the linked demo reset instructions.";
  }
  return "";
}

export default function DemoCard({
  scenario,
  lesson,
  availability,
  observedResult,
  actionState,
  onCheckEvidence,
  onReset,
}) {
  const headingId = `demo-card-${scenario.id}`;
  const provenance = observedResult?.provenance || availability.provenance;
  const provenanceDetail = observedResult
    ? "Observed evidence from the latest launcher check."
    : availability.detail;
  const busy = actionState === "checking" || actionState === "resetting";
  const statusText = actionStatusText(actionState);

  return (
    <article
      className={`demo-card demo-card--${availability.available ? "available" : "unavailable"}`}
      aria-labelledby={headingId}
    >
      <header className="demo-card__header">
        <div>
          <p className="demo-card__category">{lesson.category}</p>
          <h2 id={headingId}>{scenario.title}</h2>
        </div>
        {!availability.available && (
          <strong className="demo-card__availability">UNAVAILABLE</strong>
        )}
      </header>

      <LessonProvenanceBadge
        provenance={provenance}
        detail={provenanceDetail}
      />

      <section className="demo-card__outcome">
        <h3>Customer outcome</h3>
        <p>{scenario.outcome}</p>
      </section>

      <PresenterNotes
        durationMinutes={scenario.durationMinutes}
        steps={scenario.script}
      />

      <div className="demo-card__operating-notes">
        <section>
          <h3>Prerequisites</h3>
          {availability.dependencies.length > 0 ? (
            <ul>
              {availability.dependencies.map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong>: {item.status}. {item.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p>Readiness check pending.</p>
          )}
        </section>
        <section>
          <h3>Reset behavior</h3>
          <p>{scenario.resetBehavior}</p>
        </section>
        <section>
          <h3>Fallback behavior</h3>
          <p>
            {lesson.fallback.label} is the declared fallback. It is not started
            automatically and must retain its{" "}
            {lesson.fallback.provenance.replaceAll("_", " ")} label.
          </p>
        </section>
      </div>

      <div className="demo-card__actions">
        <Link className="demo-card__launch" to={lesson.standaloneRoute}>
          Launch demo
        </Link>
        <button
          type="button"
          onClick={onCheckEvidence}
          disabled={
            !availability.available ||
            !availability.evidenceSupported ||
            busy
          }
          aria-label={`Check ${scenario.title} evidence`}
        >
          Check evidence
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          aria-label={`Reset ${scenario.title}`}
        >
          Reset
        </button>
        <Link className="demo-card__explain" to={lesson.route}>
          Explain this
        </Link>
      </div>

      {!availability.evidenceSupported && (
        <p className="demo-card__action-status">
          {availability.evidenceDetail}
        </p>
      )}

      {statusText && (
        <p
          className="demo-card__action-status"
          role="status"
          aria-live="polite"
        >
          {statusText}
        </p>
      )}
    </article>
  );
}
