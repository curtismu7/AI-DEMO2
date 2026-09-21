export default function JourneyProgress({
  steps,
  activeIndex,
  completed,
  skipped,
  onSelect,
}) {
  return (
    <nav className="journey-progress" aria-label="Guided journey progress">
      <ol>
        {steps.map((step, index) => {
          const progressStatus = skipped.has(step.lesson.id)
            ? "skipped"
            : completed.has(step.lesson.id)
              ? "completed"
              : "not started";
          const isCurrent = index === activeIndex;
          const accessibleStatus = isCurrent
            ? progressStatus === "not started"
              ? "current"
              : `current, ${progressStatus}`
            : progressStatus;
          const statusClass = progressStatus.replace(" ", "-");

          return (
            <li key={step.lesson.id}>
              <button
                type="button"
                className={`journey-progress__step journey-progress__step--${statusClass}${isCurrent ? " journey-progress__step--current" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`${step.stage}, ${accessibleStatus}`}
                onClick={() => onSelect(index)}
              >
                <span className="journey-progress__number">{index + 1}</span>
                <span className="journey-progress__label">{step.stage}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
