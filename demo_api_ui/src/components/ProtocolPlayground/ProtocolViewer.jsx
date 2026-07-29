import React, { useState } from 'react';
import SequenceDiagram from './SequenceDiagram';
import ActivityPanel from './ActivityPanel';
import ExecutionControls from './ExecutionControls';
import ExecutionEngine from '../../services/executionEngine';

export default function ProtocolViewer({ flowSpec, executionState, onExecutionStateChange }) {
  const [engine] = useState(() => new ExecutionEngine(flowSpec));

  const handleExecute = async () => {
    const result = await engine.executeAll();
    onExecutionStateChange(engine.getState());
  };

  const handleStep = async () => {
    const nextStep = flowSpec.steps[executionState.results.length];
    if (nextStep) {
      await engine.executeStep(nextStep.id);
      onExecutionStateChange(engine.getState());
    }
  };

  const handleReset = () => {
    engine.reset();
    onExecutionStateChange(engine.getState());
  };

  return (
    <div className="protocol-viewer">
      <div className="viewer-header">
        <h2>{flowSpec.name || flowSpec.id}</h2>
        <p className="viewer-description">{flowSpec.description || 'Protocol flow'}</p>
      </div>

      <div className="viewer-body">
        <div className="diagram-section">
          <SequenceDiagram
            flowSpec={flowSpec}
            currentStep={executionState.currentStep}
          />
          <ExecutionControls
            onExecute={handleExecute}
            onStep={handleStep}
            onReset={handleReset}
            stepCount={executionState.results.length}
            totalSteps={flowSpec.steps?.length || 0}
          />
        </div>

        <div className="activity-section">
          <ActivityPanel
            results={executionState.results}
            error={executionState.error}
          />
        </div>
      </div>
    </div>
  );
}
