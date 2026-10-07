import { DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import "./DiagramStepBar.css";

/**
 * Play/Step bar for a diagram that keeps its own drawing. Pairs with
 * useDiagramStepper. Renders nothing when the diagram has no
 * arrows to walk. Reset clears the walkthrough back to the plain diagram.
 */
export default function DiagramStepBar({ stepper, caption, testId = "diagram-step-bar" }) {
  if (!stepper || stepper.total < 1) return null;
  const { step, total, active, paused } = stepper;
  return (
    <div className="dstep-bar" data-testid={testId}>
      <DiagramControls
        currentStep={step + 1}
        totalSteps={total}
        isSimulating={active}
        isPaused={paused}
        onSimulate={stepper.simulate}
        onPrev={stepper.prev}
        onPause={stepper.pause}
        onResume={stepper.resume}
        onNext={stepper.next}
        onStop={stepper.stop}
        stepTimeOptions={STEP_TIME_OPTIONS}
        stepMs={stepper.stepMs}
        onSetStepMs={stepper.setStepMs}
      />
      <button type="button" className="dstep-reset" onClick={stepper.stop} disabled={!active} title="Clear the walkthrough and start over">
        Reset
      </button>
      <p className="dstep-caption" aria-live="polite">
        {active ? (
          <>
            <strong>
              Step {step + 1} of {total}
            </strong>
            {caption ? ` · ${caption}` : ""}
          </>
        ) : (
          `Simulate walks the ${total} arrows in order.`
        )}
      </p>
    </div>
  );
}
