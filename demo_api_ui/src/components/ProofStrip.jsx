import React from 'react';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
import './ProofStrip.css';

const STATE_LABEL = {
  verified: 'Verified',
  'denied-as-expected': 'Verified (as expected)',
  mismatch: 'Mismatch',
  incomplete: 'Incomplete',
};

// `runId` binds this strip to ONE run (the trace.startedAt captured when the
// message it hangs under was added), so a later run can no longer repaint it.
// Omitting it keeps the old behaviour — always the latest verdict — for callers
// that render a single live strip.
export default function ProofStrip({ runId = null }) {
  const { verdict, verdictFor } = useProofOfEnforcement();
  const item = runId == null ? verdict : verdictFor(runId);
  if (!item) return null;

  const icon = item.state === 'verified' || item.state === 'denied-as-expected' ? '✅' : '⚠️';

  return (
    <div className={`proof-strip proof-strip--${item.state}`} data-testid="proof-strip">
      <div className="proof-strip-head">
        <span>{item.title} — {STATE_LABEL[item.state] || item.state}</span>
        <span>{icon}</span>
      </div>
      <div className="proof-strip-chain">
        {item.matchedSteps.map((step, i) => (
          <React.Fragment key={step}>
            <span className="proof-strip-step">{step}</span>
            {i < item.matchedSteps.length - 1 && <span className="proof-strip-arrow">→</span>}
          </React.Fragment>
        ))}
      </div>
      {(item.intent || item.resultText || (item.mechanism && item.mechanism.length > 0)) && (
        <div className="proof-strip-details">
          {item.intent && (
            <div className="proof-strip-row">
              <span className="proof-strip-label">Intent</span>
              <span>{item.intent}</span>
            </div>
          )}
          {item.resultText && (
            <div className="proof-strip-row">
              <span className="proof-strip-label">Result</span>
              <span className={`proof-strip-result${item.resultText === 'Denied as expected by policy' ? ' proof-strip-result--denied' : ''}`}>
                {item.resultText}
              </span>
            </div>
          )}
          {item.mechanism && item.mechanism.length > 0 && (
            <div className="proof-strip-row">
              <span className="proof-strip-label">Used</span>
              <span>{[...item.mechanism, item.tool].filter(Boolean).join(' · ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
