// demo_api_ui/src/components/DetailedStepsTabContent.js
import React from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { isHaltedAt, resolveStatusVisual } from './TokenChainDisplay';
import { PingProductChip } from './PingProductChip';
import { productForEvent } from '../utils/pingProducts';
import './DetailedStepsTabContent.css';

// Claim keys that get a distinct colour to aid at-a-glance reading.
const CLAIM_VALUE_CLASS = {
  scope: 'dstc-claim-v--scope',
  act:   'dstc-claim-v--act',
  aud:   'dstc-claim-v--aud',
  cnf:   'dstc-claim-v--cnf',
};

export default function DetailedStepsTabContent() {
  const ctx = useTokenChainOptional();

  if (!ctx) return null;

  const events = ctx.events ?? [];
  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  if (events.length === 0) {
    return <div className="dstc-empty">No token events yet.</div>;
  }

  return (
    <div>
      {events.map((ev, i) => (
        <DetailCard
          key={ev.id ? `${ev.id}-${i}` : `no-id-${i}`}
          event={ev}
          index={i}
          halted={haltedIdx === i}
          didNotRun={haltedIdx !== -1 && i > haltedIdx}
        />
      ))}
    </div>
  );
}

function DetailCard({ event, index, halted, didNotRun }) {
  const { bucket } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);

  let cardCls = 'dstc-card';
  let numCls  = 'dstc-num';
  let statusCls, statusLabel;

  if (halted) {
    cardCls  += ' dstc-card--fail';
    numCls   += ' dstc-num--fail';
    statusCls = 'dstc-status dstc-status--fail';
    statusLabel = `✕ ${event.errorCode || 'halted'}`;
  } else if (didNotRun) {
    cardCls  += ' dstc-card--ghost';
    numCls   += ' dstc-num--skip';
    statusCls = 'dstc-status dstc-status--skip';
    statusLabel = '— did not run';
  } else if (bucket === 'notinpath') {
    cardCls  += ' dstc-card--skip';
    numCls   += ' dstc-num--skip';
    statusCls = 'dstc-status dstc-status--skip';
    statusLabel = 'Not in path';
  } else if (bucket === 'active' || bucket === 'exchanged') {
    cardCls  += ' dstc-card--ok';
    numCls   += ' dstc-num--ok';
    statusCls = 'dstc-status dstc-status--ok';
    statusLabel = '✓ Success';
  } else if (bucket === 'failed') {
    cardCls  += ' dstc-card--fail';
    numCls   += ' dstc-num--fail';
    statusCls = 'dstc-status dstc-status--fail';
    statusLabel = `✕ ${event.errorCode || 'Failed'}`;
  } else {
    // acquiring / waiting
    cardCls  += ' dstc-card--ok';
    numCls   += ' dstc-num--skip';
    statusCls = 'dstc-status dstc-status--wait';
    statusLabel = 'In progress…';
  }

  const labelCls = bucket === 'notinpath' || didNotRun
    ? 'dstc-label dstc-label--strikethrough'
    : 'dstc-label';

  const rfcPills = event.rfc
    ? event.rfc.split(' · ').map((r) => (
        <span key={r} className="dstc-rfc-pill">{r}</span>
      ))
    : null;

  const hasClaims = event.claims && Object.keys(event.claims).length > 0 && !didNotRun && bucket !== 'notinpath';

  return (
    <div className={cardCls}>
      <div className="dstc-head">
        <div className={numCls}>{index + 1}</div>
        <div className="dstc-info">
          <div className={labelCls}>{label}</div>
          <div className="dstc-meta">
            {product && <PingProductChip product={product} size="xs" />}
            <span className={statusCls}>{statusLabel}</span>
            {rfcPills}
          </div>
        </div>
      </div>

      {hasClaims && (
        <div className="dstc-claims">
          {Object.entries(event.claims).map(([k, v]) => {
            const extraCls = CLAIM_VALUE_CLASS[k] || '';
            const displayV = typeof v === 'object' ? JSON.stringify(v) : String(v);
            return (
              <div key={k} className="dstc-claim-row">
                <span className="dstc-claim-k">{k}</span>
                <span className={`dstc-claim-v ${extraCls}`}>{displayV}</span>
              </div>
            );
          })}
        </div>
      )}

      {halted && event.errorCode && (
        <div className="dstc-error">
          DENY — {event.errorCode}{event.errorMessage ? `: ${event.errorMessage}` : ''}
        </div>
      )}
    </div>
  );
}
