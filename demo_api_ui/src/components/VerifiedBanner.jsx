import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
import './VerifiedBanner.css';

const GOOD_STATES = new Set(['verified', 'denied-as-expected']);

export default function VerifiedBanner({ onExpand }) {
  const { verdict } = useProofOfEnforcement();
  const [collapsed, setCollapsed] = useState(false);
  const timerRef = useRef(null);

  const key = verdict
    ? `${verdict.useCaseId}:${verdict.state}:${verdict.matchedSteps.join(',')}`
    : null;

  useEffect(() => {
    if (!key) return;
    setCollapsed(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCollapsed(true), 6000);
    return () => clearTimeout(timerRef.current);
  }, [key]);

  if (!verdict) return null;
  const good = GOOD_STATES.has(verdict.state);

  if (collapsed) {
    return createPortal(
      <button
        type="button"
        data-testid="verified-pill"
        className={`verified-pill${good ? '' : ' verified-pill--mismatch'}`}
        onClick={() => { setCollapsed(false); onExpand && onExpand(); }}
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
