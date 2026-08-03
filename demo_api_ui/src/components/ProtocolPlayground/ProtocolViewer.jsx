import React, { useState, useEffect } from 'react';
import SequenceDiagram from './SequenceDiagram';
import ActivityPanel from './ActivityPanel';
import ExecutionControls from './ExecutionControls';
import ProtocolExplainer from './ProtocolExplainer';
import ExecutionEngine from '../../services/executionEngine';

/**
 * ProtocolViewer — main content area for protocol execution
 *
 * @param {object} flowSpec - protocol flow specification { id, name, description, steps, actors }
 * @param {object} executionState - current execution state { currentStep, results, error }
 * @param {function} onExecutionStateChange - callback(state) when execution state changes
 */
export default function ProtocolViewer({ flowSpec, executionState, onExecutionStateChange, dark = false }) {
  const [engine, setEngine] = useState(null);

  // Recreate engine when flowSpec changes
  useEffect(() => {
    if (flowSpec) {
      setEngine(new ExecutionEngine(flowSpec));
    }
  }, [flowSpec]);

  // Validate required props
  if (!flowSpec || !executionState || !onExecutionStateChange) {
    return null;
  }

  if (!engine) {
    return null;
  }

  const handleExecute = async () => {
    try {
      await engine.executeAll();
      onExecutionStateChange(engine.getState());
    } catch (err) {
      onExecutionStateChange({
        ...engine.getState(),
        error: err.message || 'Execution failed'
      });
    }
  };

  const handleStep = async () => {
    try {
      const nextStep = flowSpec.steps[executionState.results.length];
      if (nextStep) {
        await engine.executeStep(nextStep.id);
        onExecutionStateChange(engine.getState());
      }
    } catch (err) {
      onExecutionStateChange({
        ...engine.getState(),
        error: err.message || 'Step execution failed'
      });
    }
  };

  const handleReset = () => {
    try {
      engine.reset();
      onExecutionStateChange(engine.getState());
    } catch (err) {
      onExecutionStateChange({
        currentStep: null,
        results: [],
        error: err.message || 'Reset failed'
      });
    }
  };

  return (
    <div className="protocol-viewer">
      <div className="viewer-header">
        <h2>{flowSpec.name || flowSpec.id}</h2>
        <p className="viewer-description">{flowSpec.description || 'Protocol flow'}</p>
        <ProtocolExplainer spec={flowSpec.spec} />
      </div>

      <div className="viewer-body">
        <div className="diagram-section">
          <SequenceDiagram
            flowSpec={flowSpec}
            currentStep={executionState.currentStep}
            results={executionState.results}
            dark={dark}
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
