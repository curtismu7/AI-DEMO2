// demo_api_ui/src/components/InlineTokenChainView.js
import React, { useState, useCallback } from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { isHaltedAt, resolveStatusVisual } from './TokenChainDisplay';
import './InlineTokenChainView.css';
// A8 -- Ping product attribution
import { PingProductChip } from './PingProductChip';
import { productForEvent } from '../utils/pingProducts';

const LS_KEY = 'ba_inline_tc_show';

function loadVisible() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === null ? true : v === 'true';
  } catch (_) { return true; }
}

/**
 * A single horizontal step pill.
 *
 * Props:
 *   event      — token chain event object
 *   halted     — bool: this step halted the chain
 *   didNotRun  — bool: step came after the halt (ghost)
 *   isLast     — bool: suppress trailing arrow
 */
function InlineStep({ event, halted, didNotRun, isLast }) {
  const { bucket } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';

  let modClass = `itcv-step--${bucket}`;
  if (halted) modClass += ' itcv-step--halted';
  if (didNotRun) modClass += ' itcv-step--ghost';

  return (
    <React.Fragment>
      <div
        className={`itcv-step ${modClass}`}
        title={halted ? `Stopped here: ${event.errorCode || 'rejected'}` : label}
        aria-label={
          didNotRun
            ? `${label} — did not run`
            : halted
            ? `${label} — stopped here`
            : label
        }
      >
        <span className="itcv-step__label">{label}</span>
        {/* A8 -- micro product chip */}
        {(() => { const _pp = productForEvent(event); return _pp ? <PingProductChip product={_pp} size="xs" /> : null; })()}
        {halted && (
          <span className="itcv-step__stop" aria-hidden="true">
            {/* Inline SVG octagon stop mark — no emoji */}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <polygon
                points="3,0 7,0 10,3 10,7 7,10 3,10 0,7 0,3"
                fill="#dc2626"
              />
              <rect x="4.25" y="2" width="1.5" height="3.5" rx="0.5" fill="#fff" />
              <rect x="4.25" y="6.5" width="1.5" height="1.5" rx="0.5" fill="#fff" />
            </svg>
          </span>
        )}
      </div>
      {!isLast && (
        <span className="itcv-arrow" aria-hidden="true">&#x2192;</span>
      )}
    </React.Fragment>
  );
}

/**
 * Inline horizontal token chain view.
 * Mounts above banking-agent-messages in ba-right-col.
 * Reads live events from TokenChainContext — no props needed.
 * Returns null when outside the TokenChainContext provider (SSR / tests without provider).
 */
export default function InlineTokenChainView() {
  const ctx = useTokenChainOptional();
  const [visible, setVisible] = useState(loadVisible);

  const toggle = useCallback(() => {
    setVisible((v) => {
      const next = !v;
      try { localStorage.setItem(LS_KEY, String(next)); } catch (_) {}
      return next;
    });
  }, []);

  // Outside provider (tests without wrapper, SSR) — render nothing
  if (!ctx) return null;

  const events = ctx.events ?? [];

  // Always render the bar (so the Show button is accessible even when empty),
  // but collapse the flow row when visible === false or events is empty.
  const showFlow = visible && events.length > 0;
  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return (
    <div className="itcv-bar" aria-label="Token chain inline view">
      <div className="itcv-header">
        <span className="itcv-title">Token Chain</span>
        {events.length > 0 && (
          <span className="itcv-count" aria-label={`${events.length} step${events.length === 1 ? '' : 's'}`}>
            {events.length}
          </span>
        )}
        <button
          type="button"
          className="itcv-toggle"
          onClick={toggle}
          aria-expanded={showFlow}
          aria-controls="itcv-flow-row"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>

      {showFlow && (
        <div className="itcv-flow" id="itcv-flow-row" role="list" aria-label="Token exchange steps">
          {events.map((ev, i) => (
            <InlineStep
              key={ev.id || i}
              event={ev}
              halted={isHaltedAt(events, i)}
              didNotRun={haltedIdx !== -1 && i > haltedIdx}
              isLast={i === events.length - 1}
            />
          ))}
        </div>
      )}

      {!showFlow && events.length === 0 && visible && (
        <div className="itcv-empty">No token events yet.</div>
      )}
    </div>
  );
}
