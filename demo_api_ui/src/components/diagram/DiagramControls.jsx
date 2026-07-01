/**
 * DiagramControls — shared toolbar for diagram pages.
 *
 * Renders a horizontal toolbar with two optional, independent blocks:
 *   - Zoom block: shown when `zoom` prop is provided
 *   - Step nav block: shown when `currentStep` prop is provided
 *
 * The step nav block optionally includes:
 *   - a step-time selector (shown when `stepTimeOptions` is provided)
 *   - a Reset button (shown when `onReset` is provided)
 *
 * An optional `extra` node is rendered to the left of the zoom block
 * (e.g. a scenario dropdown, a title chip).
 */
import { memo } from "react";
import "./DiagramControls.css";

/**
 * Canonical per-step timing options shared by every simulate-capable diagram
 * page. Values are the dwell time per step, in milliseconds.
 */
export const STEP_TIME_OPTIONS = [
  { value: 800, label: "0.8s (fast)" },
  { value: 1500, label: "1.5s" },
  { value: 2500, label: "2.5s (default)" },
  { value: 4000, label: "4s" },
  { value: 6000, label: "6s (slow)" },
];

export const DEFAULT_STEP_MS = 2500;

function DiagramControls({
  // Zoom block (omit to hide)
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoomMin = 0.5,
  zoomMax = 4.0,
  zoomStep = 0.25,

  // Step nav block (omit to hide)
  currentStep,
  totalSteps,
  isSimulating = false,
  isPaused = false,
  onSimulate,
  onPrev,
  onPause,
  onResume,
  onNext,
  onStop,

  // Step-time selector (omit `stepTimeOptions` to hide)
  stepTimeOptions,
  stepMs,
  onSetStepMs,

  // Reset button (omit `onReset` to hide)
  onReset,

  // Extra content rendered left of zoom block
  extra,
}) {
  const hasZoom = zoom !== undefined && zoom !== null;
  const hasStep = currentStep !== undefined && currentStep !== null;
  const hasStepTime =
    Array.isArray(stepTimeOptions) && stepTimeOptions.length > 0;

  const zoomPct = hasZoom ? Math.round(zoom * 100) : null;
  const canZoomOut = hasZoom && zoom > zoomMin + 0.001;
  const canZoomIn  = hasZoom && zoom < zoomMax - 0.001;

  return (
    <div className="dc-toolbar">
      {extra}

      {extra && (hasZoom || hasStep) && <div className="dc-divider" />}

      {/* Zoom block */}
      {hasZoom && (
        <>
          <button
            type="button"
            className="dc-zoom-btn"
            onClick={onZoomOut}
            disabled={!canZoomOut}
            title="Zoom out"
          >
            −
          </button>
          <span className="dc-zoom-label">{zoomPct}%</span>
          <button
            type="button"
            className="dc-zoom-btn"
            onClick={onZoomIn}
            disabled={!canZoomIn}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="dc-zoom-btn dc-zoom-reset"
            onClick={onZoomReset}
            title="Reset zoom"
          >
            ↺
          </button>
        </>
      )}

      {hasZoom && hasStep && <div className="dc-divider" />}

      {/* Step nav block */}
      {hasStep && (
        <>
          {hasStepTime && (
            <label className="dc-steptime" title="Time each step takes during Simulate">
              <span className="dc-steptime-label">Step time:</span>
              <select
                className="dc-steptime-select"
                value={stepMs}
                onChange={(e) => onSetStepMs(Number(e.target.value))}
                disabled={isSimulating}
              >
                {stepTimeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isSimulating ? (
            <button
              type="button"
              className="dc-ctrl-btn dc-ctrl-btn--simulate"
              onClick={onSimulate}
            >
              Simulate
            </button>
          ) : (
            <>
              <button
                type="button"
                className="dc-ctrl-btn dc-ctrl-btn--prev"
                onClick={onPrev}
                disabled={!isPaused}
              >
                ← Prev
              </button>
              {!isPaused ? (
                <button
                  type="button"
                  className="dc-ctrl-btn dc-ctrl-btn--pause"
                  onClick={onPause}
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="dc-ctrl-btn dc-ctrl-btn--resume"
                  onClick={onResume}
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                className="dc-ctrl-btn dc-ctrl-btn--next"
                onClick={onNext}
                disabled={!isPaused}
              >
                Next →
              </button>
              <button
                type="button"
                className="dc-ctrl-btn dc-ctrl-btn--stop"
                onClick={onStop}
              >
                Stop
              </button>
            </>
          )}
          {onReset && (
            <button
              type="button"
              className="dc-ctrl-btn dc-ctrl-btn--reset"
              onClick={onReset}
              title="Reset the diagram and clear history"
            >
              ↺ Reset
            </button>
          )}
          <span
            className={`dc-step-label${isPaused ? " dc-step-label--paused" : ""}`}
          >
            Step {currentStep} / {totalSteps}
          </span>
        </>
      )}
    </div>
  );
}

export default memo(DiagramControls);
