import React from 'react';
import './UseCaseRunContextCard.css';

const EVIDENCE_LABELS = {
  'user-token': 'user token',
  'token-exchange': 'token exchange',
  'authorize-decision': 'Authorize decision',
  'tool-dispatched': 'tool dispatch',
};

function evidenceItems(evidence = {}) {
  return [...new Set([
    ...(evidence.tokenChain || []),
    ...(evidence.activity || []),
  ])];
}

function humanizeUseCaseId(useCaseId) {
  if (!useCaseId) return '';
  return useCaseId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function UseCaseRunContextCard({ runContext }) {
  const launchedFromUseCases = runContext?.source === 'use-cases';
  const evidence = evidenceItems(runContext?.evidence);

  return (
    <section className="ba-run-context-card" aria-label="Current run details">
      <div className="ba-run-context-card__header">
        <div>
          <div className="ba-run-context-card__eyebrow">
            {launchedFromUseCases ? 'Launched from Use Cases' : 'Direct dashboard run'}
          </div>
          <h2 className="ba-run-context-card__title">
            {runContext?.useCaseLabel
              || humanizeUseCaseId(runContext?.useCaseId)
              || 'No use case selected'}
          </h2>
        </div>
        {runContext?.expectedOutcome && (
          <span className={`ba-run-context-card__verdict ba-run-context-card__verdict--${runContext.expectedOutcome.toLowerCase()}`}>
            {runContext.expectedOutcome}
          </span>
        )}
      </div>

      {runContext ? (
        <>
          <p className="ba-run-context-card__summary">
            This dashboard is executing the selected scenario and collecting the evidence shown below.
          </p>
          <dl className="ba-run-context-card__facts">
            <div>
              <dt>Trigger</dt>
              <dd>{runContext.triggerText || 'Dashboard interaction'}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>Use Cases → {runContext.useCaseLabel || runContext.useCaseId}</dd>
            </div>
          </dl>
          {evidence.length > 0 && (
            <div className="ba-run-context-card__evidence">
              <div className="ba-run-context-card__label">Evidence expected in this run</div>
              <div className="ba-run-context-card__chips">
                {evidence.map((item) => (
                  <span className="ba-run-context-card__chip" key={item}>
                    {EVIDENCE_LABELS[item] || item}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="ba-run-context-card__summary">
          Open a scenario from Use Cases to bind this dashboard to a named run and its expected evidence.
        </p>
      )}
    </section>
  );
}
