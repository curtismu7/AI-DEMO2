import React from 'react';

export default function ExecutionControls({
  onExecute,
  onStep,
  onReset,
  stepCount,
  totalSteps
}) {
  const isComplete = stepCount >= totalSteps;

  return (
    <div className="execution-controls">
      <div className="controls-progress">
        <span className="progress-text">Step {stepCount} of {totalSteps}</span>
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
          disabled={isComplete}
        >
          Execute All
        </button>
        <button
          className="btn btn-default"
          onClick={onStep}
          disabled={isComplete}
        >
          Next Step
        </button>
        <button
          className="btn btn-default"
          onClick={onReset}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
