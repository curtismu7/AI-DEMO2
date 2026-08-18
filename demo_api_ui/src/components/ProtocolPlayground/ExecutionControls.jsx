import React from 'react';

export default function ExecutionControls({
  onExecute,
  onStep,
  onReset,
  stepCount,
  totalSteps,
  isExecuting = false
}) {
  const isComplete = stepCount >= totalSteps;

  return (
    <div className="execution-controls">
      <div className="controls-progress">
        <span className="progress-text">
          {isExecuting ? `Executing step ${Math.min(stepCount + 1, totalSteps)} of ${totalSteps}` : `Step ${stepCount} of ${totalSteps}`}
        </span>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${(stepCount / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <div className="controls-buttons">
        <button
          className="btn btn-primary"
          onClick={onExecute}
          disabled={isComplete || isExecuting}
        >
          {isExecuting ? (
            <>
              <span className="pp-spinner" aria-hidden="true" /> Executing
            </>
          ) : (
            'Execute All'
          )}
        </button>
        <button
          className="btn btn-default"
          onClick={onStep}
          disabled={isComplete || isExecuting}
        >
          Next Step
        </button>
        <button
          className="btn btn-default"
          onClick={onReset}
          disabled={isExecuting}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
