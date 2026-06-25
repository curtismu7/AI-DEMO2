/**
 * DiagramControls — shared toolbar for diagram pages.
 *
 * Renders a horizontal toolbar with two optional, independent blocks:
 *   - Zoom block: shown when `zoom` prop is provided
 *   - Step nav block: shown when `currentStep` prop is provided
 *
 * An optional `extra` node is rendered to the left of the zoom block
 * (e.g. a scenario dropdown, a title chip).
 */
import { memo } from "react";
import "./DiagramControls.css";

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

  // Extra content rendered left of zoom block
  extra,
}) {
  const hasZoom = zoom !== undefined && zoom !== null;
  const hasStep = currentStep !== undefined && currentStep !== null;

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
