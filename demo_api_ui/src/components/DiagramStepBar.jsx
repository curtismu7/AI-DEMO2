import { useEffect, useId, useSyncExternalStore } from "react";
import { DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import { REFIT_EVENT } from "../hooks/useFitOnResize";
import "./DiagramStepBar.css";

// Every bar on screen, in mount order. A page that draws several diagrams gets several bars, and each would
// otherwise be a second red "Simulate" with the same name as the first: two primaries in one view state, and
// identical buttons to a screen reader. With more than one bar mounted each one turns secondary (data-multi, see
// DiagramStepBar.css) and takes a numbered toolbar name unless the caller gave it a `label`.
let mounted = [];
const listeners = new Set();
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => mounted;
const setMounted = (next) => {
  mounted = next;
  listeners.forEach((fn) => fn());
};
function useBarSlot() {
  const id = useId();
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    setMounted([...mounted, id]);
    return () => setMounted(mounted.filter((x) => x !== id));
  }, [id]);
  return { index: list.indexOf(id), count: list.length };
}

/**
 * Play/Step bar for a diagram that keeps its own drawing. Pairs with
 * useDiagramStepper. Renders nothing when the diagram has no
 * arrows to walk. Reset clears the walkthrough back to the plain diagram.
 */
export default function DiagramStepBar(props) {
  const { stepper } = props;
  if (!stepper || stepper.total < 1) return null;
  return <StepBar {...props} />;
}

function StepBar({ stepper, caption, testId = "diagram-step-bar", label }) {
  const { step, total, active, paused } = stepper;
  const { index, count } = useBarSlot();
  const multi = count > 1;
  // `label` names this bar when a page carries several diagrams, so the identical Simulate / Zoom / Reset
  // buttons are told apart by their toolbar; with no label, several bars are numbered.
  const name = label || (multi && index >= 0 ? `Diagram ${index + 1} controls` : undefined);
  return (
    <div className="dstep-bar" data-testid={testId} data-multi={multi ? "true" : undefined} {...(name ? { role: "toolbar", "aria-label": name } : {})}>
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
      <button type="button" className="dstep-reset" onClick={() => {
          stepper.stop();
          window.dispatchEvent(new Event(REFIT_EVENT));
        }} disabled={!active} title="Clear the walkthrough and start over">
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
