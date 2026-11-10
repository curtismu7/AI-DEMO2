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

// headingLevel: the card's title is a heading, and its level has to sit one below whatever heading contains the card.
// 2 is right when the card sits in a section with no heading of its own (the floating or docked agent); the dashboard
// puts the agent inside its "Banking assistant" h2 card and passes 3.
export default function UseCaseRunContextCard({ runContext, headingLevel = 2 }) {
  const Title = `h${[2, 3, 4].includes(headingLevel) ? headingLevel : 2}`;
  const launchedFromUseCases = runContext?.source === 'use-cases';
  const launchedFromDemoTrack = runContext?.source === 'demo-track';
  const launchedFromDemoSteps = runContext?.source === 'demo-steps';
  const evidence = evidenceItems(runContext?.evidence);

  return (
    <section className="ba-run-context-card" aria-label="Current run details">
      <div className="ba-run-context-card__header">
        <div>
          <div className="ba-run-context-card__eyebrow">
            {launchedFromUseCases
              ? 'Launched from Use Cases'
              : launchedFromDemoTrack
                ? 'Launched from Demo Track'
                : launchedFromDemoSteps
                  ? 'Launched from Demo Steps'
                  : 'Direct dashboard run'}
          </div>
          <Title className="ba-run-context-card__title">
            {runContext?.useCaseLabel
              || humanizeUseCaseId(runContext?.useCaseId)
              || 'No use case selected'}
          </Title>
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
          Ask a banking question or choose a scenario from Use Cases to run it here. This dashboard shows the authorization and tool evidence behind each run.
        </p>
      )}
    </section>
  );
}
