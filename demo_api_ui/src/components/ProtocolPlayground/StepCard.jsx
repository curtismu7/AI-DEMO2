import React from 'react';
import './StepCard.css';

const ACTOR_LABELS = {
  'client-app': 'Client',
  'auth-server': 'Auth Server',
  'gateway': 'Gateway',
  'resource-server': 'Resource',
  'token-exchanger': 'Exchanger',
  'human-approver': 'Approver',
  'spire-agent': 'SPIRE Agent',
  'txn-token-service': 'TTS',
  'idp-a': 'IdP-A',
  'workload-a': 'Workload-A'
};

export default function StepCard({
  step,
  stepNumber,
  isEnabled,
  isComplete,
  onExecute,
  result
}) {
  const title = step.title || step.label || `Step ${stepNumber}`;
  const description = step.description || '';
  const fromLabel = ACTOR_LABELS[step.fromActor] || step.fromActor;
  const toLabel = ACTOR_LABELS[step.toActor] || step.toActor;
  const status = result?.response?.status;
  const statusOk = status && status >= 200 && status < 300;

  const handleClick = () => {
    if (isEnabled) {
      onExecute(step.id);
    }
  };

  return (
    <div className={`step-card ${isComplete ? 'step-card--complete' : ''}`}>
      <div className="step-card-header">
        <div className="step-number">{stepNumber}</div>
        <div className="step-info">
          <div className="step-title">{title}</div>
          {description && <div className="step-description">{description}</div>}
        </div>
        {isComplete && (
          <div className={`step-status ${statusOk ? 'step-status--ok' : 'step-status--error'}`}>
            {statusOk ? '✓' : '✕'} {status}
          </div>
        )}
      </div>

      <div className="step-actors">
        <span className="actor-label">{fromLabel}</span>
        <span className="actor-arrow">→</span>
        <span className="actor-label">{toLabel}</span>
      </div>

      <div className="step-footer">
        <button
          className="step-execute-btn"
          onClick={handleClick}
          disabled={!isEnabled}
          title={isEnabled ? 'Execute this step' : 'Complete previous steps first'}
        >
          Execute
        </button>
      </div>
    </div>
  );
}
