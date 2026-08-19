import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
import './VerifiedBanner.css';

const GOOD_STATES = new Set(['verified', 'denied-as-expected']);

// The verdict announces itself, shrinks out of the way, then clears itself:
// banner -> pill -> gone. The last hop is the point — without it the pill sat
// over the TopNav Sign Out button for the rest of the session, still reading
// "verified" long after the run it described had failed.
const PHASE_MS = { banner: 6000, pill: 15000 };
const NEXT_PHASE = { banner: 'pill', pill: 'gone' };

export default function VerifiedBanner({ onExpand }) {
  const { verdict } = useProofOfEnforcement();
  const [phase, setPhase] = useState('banner');

  const key = verdict
    ? `${verdict.useCaseId}:${verdict.state}:${verdict.matchedSteps.join(',')}`
    : null;

  // A genuinely new verdict restarts the cycle. Keyed on content, not object
  // identity, so recompute() re-emitting an equal verdict does not reset it.
  useEffect(() => {
    if (key) setPhase('banner');
  }, [key]);

  useEffect(() => {
    if (!key || phase === 'gone') return undefined;
    const timer = setTimeout(() => setPhase(NEXT_PHASE[phase]), PHASE_MS[phase]);
    return () => clearTimeout(timer);
  }, [key, phase]);

  if (!verdict || phase === 'gone') return null;
  const good = GOOD_STATES.has(verdict.state);

  if (phase === 'pill') {
    return createPortal(
      <button
        type="button"
        data-testid="verified-pill"
        className={`verified-pill${good ? '' : ' verified-pill--mismatch'}`}
        onClick={() => { setPhase('banner'); onExpand && onExpand(); }}
      >
        {good ? '✅' : '⚠️'} {verdict.useCaseId} {good ? 'verified' : verdict.state}
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div data-testid="verified-banner" className={`verified-banner${good ? '' : ' verified-banner--mismatch'}`} role="status">
      <div className="verified-banner-check">{good ? '✓' : '!'}</div>
      <div>
        <div className="verified-banner-title">
          {verdict.useCaseId.toUpperCase()} — {verdict.title} — {good ? 'VERIFIED' : verdict.state.toUpperCase()}
        </div>
        <div className="verified-banner-detail">{verdict.matchedSteps.join(' → ') || 'no evidence yet'}</div>
      </div>
      <button type="button" className="verified-banner-link" onClick={onExpand}>View trace ▸</button>
    </div>,
    document.body,
  );
}
