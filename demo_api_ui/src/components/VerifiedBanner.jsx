import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
import './VerifiedBanner.css';

const GOOD_STATES = new Set(['verified', 'denied-as-expected']);

export default function VerifiedBanner({ onExpand }) {
  const { verdict } = useProofOfEnforcement();
  const [collapsed, setCollapsed] = useState(false);
  const timerRef = useRef(null);
  const lastKeyRef = useRef(null);

  useEffect(() => {
    if (!verdict) return;
    const key = `${verdict.useCaseId}:${verdict.state}:${verdict.matchedSteps.join(',')}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    setCollapsed(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCollapsed(true), 6000);
    return () => clearTimeout(timerRef.current);
  }, [verdict]);

  if (!verdict) return null;
  const good = GOOD_STATES.has(verdict.state);
  const modifier = good ? '' : ' verified-banner--mismatch';

  if (collapsed) {
    return createPortal(
      <button
        type="button"
        data-testid="verified-pill"
        className={`verified-pill${modifier}`}
        onClick={() => { setCollapsed(false); onExpand && onExpand(); }}
      >
        {good ? '✅' : '⚠️'} {verdict.useCaseId} {good ? 'verified' : verdict.state}
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div data-testid="verified-banner" className={`verified-banner${modifier}`} role="status">
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
