import React from 'react';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
import './ProofStrip.css';

const STATE_LABEL = {
  verified: 'Verified',
  'denied-as-expected': 'Verified (denied as expected)',
  mismatch: 'Mismatch',
  incomplete: 'Incomplete',
};

export default function ProofStrip() {
  const { verdict } = useProofOfEnforcement();
  if (!verdict) return null;

  const icon = verdict.state === 'verified' || verdict.state === 'denied-as-expected' ? '✅' : '⚠️';

  return (
    <div className={`proof-strip proof-strip--${verdict.state}`} data-testid="proof-strip">
      <div className="proof-strip-head">
        <span>{verdict.title} — {STATE_LABEL[verdict.state] || verdict.state}</span>
        <span>{icon}</span>
      </div>
      <div className="proof-strip-chain">
        {verdict.matchedSteps.map((step, i) => (
          <React.Fragment key={step}>
            <span className="proof-strip-step">{step}</span>
            {i < verdict.matchedSteps.length - 1 && <span className="proof-strip-arrow">→</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
