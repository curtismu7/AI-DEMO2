import { useState } from "react";
import LessonShell from "./LessonShell";
import PersonalAgentClientCards from "./PersonalAgentClientCards";

export default function JourneyStep({
  step,
  stepNumber,
  totalSteps,
  onRun,
  summary,
}) {
  const [showTalkingPoints, setShowTalkingPoints] = useState(true);

  return (
    <article className="journey-step">
      <header className="journey-step__header">
        <p>
          Step {stepNumber} of {totalSteps}
        </p>
        <h2>{step.stage}</h2>
      </header>

      <LessonShell lesson={step.lesson} mode="guided" onRun={onRun}>
        <p className="journey-step__category">{step.lesson.category}</p>
        {summary}
        <button
          type="button"
          className="journey-step__talking-points-toggle"
          aria-expanded={showTalkingPoints}
          onClick={() => setShowTalkingPoints((visible) => !visible)}
        >
          {showTalkingPoints
            ? "Hide customer talking points"
            : "Show customer talking points"}
        </button>
        {showTalkingPoints && (
          <ul className="journey-step__talking-points">
            {step.lesson.talkingPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
        {step.lesson.id === "consumer-agent" ? <PersonalAgentClientCards /> : null}
      </LessonShell>
    </article>
  );
}
