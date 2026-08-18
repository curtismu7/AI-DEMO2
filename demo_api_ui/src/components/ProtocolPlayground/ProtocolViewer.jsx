import React, { useState, useEffect } from 'react';
import useDividerDrag from '../../hooks/useDividerDrag';
import SequenceDiagram from './SequenceDiagram';
import StepCard from './StepCard';
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
  const [isExecuting, setIsExecuting] = useState(false);
  const { size: activityWidth, handleProps: activityHandleProps } = useDividerDrag({
    min: 300,
    max: 700,
    initial: 420,
    storageKey: 'pp-activity-width',
    invert: true, // rail sits right of its divider — dragging left grows it
  });

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
    if (isExecuting) return;
    setIsExecuting(true);
    try {
      // Progress callback pushes state after every step so results stream
      // into the activity panel instead of appearing all at once at the end.
      await engine.executeAll((state) => onExecutionStateChange(state));
      onExecutionStateChange(engine.getState());
    } catch (err) {
      onExecutionStateChange({
        ...engine.getState(),
        error: err.message || 'Execution failed'
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleStep = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
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
    } finally {
      setIsExecuting(false);
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

  const handleStepCardExecute = async (stepId) => {
    if (isExecuting) return;
    setIsExecuting(true);
    try {
      await engine.executeStep(stepId);
      onExecutionStateChange(engine.getState());
    } catch (err) {
      onExecutionStateChange({
        ...engine.getState(),
        error: err.message || 'Step execution failed'
      });
    } finally {
      setIsExecuting(false);
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

          {flowSpec.steps && flowSpec.steps.length > 0 && (
            <div className="step-cards-container">
              {flowSpec.steps.map((step, idx) => {
                const result = executionState.results[idx];
                const isComplete = !!result;
                const isEnabled = idx === 0 || !!executionState.results[idx - 1];
                return (
                  <StepCard
                    key={step.id}
                    step={step}
                    stepNumber={idx + 1}
                    isEnabled={isEnabled}
                    isComplete={isComplete}
                    result={result}
                    onExecute={handleStepCardExecute}
                  />
                );
              })}
            </div>
          )}

          <ExecutionControls
            onExecute={handleExecute}
            onStep={handleStep}
            onReset={handleReset}
            stepCount={executionState.results.length}
            totalSteps={flowSpec.steps?.length || 0}
            isExecuting={isExecuting}
          />
        </div>

        <div
          className="protocol-playground__resize-handle"
          aria-label="Resize activity column"
          {...activityHandleProps}
        />
        <div className="activity-section" style={{ flex: `0 0 ${activityWidth}px` }}>
          <ActivityPanel
            results={executionState.results}
            error={executionState.error}
          />
        </div>
      </div>
    </div>
  );
}
