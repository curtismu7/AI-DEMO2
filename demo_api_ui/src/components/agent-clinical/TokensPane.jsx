import { useState } from 'react';
import { PingProductChip } from '../PingProductChip';
import { isHaltedAt, resolveStatusVisual } from '../TokenChainDisplay';
import { useTokenChainOptional } from '../../context/TokenChainContext';
import { productForEvent } from '../../utils/pingProducts';
import './TokensPane.css';

// Namespace: tp-  (no overlap with sstp- / tcd- / ac-)

export default function TokensPane() {
  const [subTab, setSubTab] = useState('simple');
  const ctx = useTokenChainOptional();
  const events = ctx?.events ?? [];

  return (
    <div className="tp-wrap">
      <div className="tp-tabs">
        <button
          className={`tp-tab${subTab === 'simple' ? ' tp-tab--active' : ''}`}
          onClick={() => setSubTab('simple')}
          type="button"
        >
          Simple
          {events.length > 0 && <span className="tp-tab-cnt">{events.length}</span>}
        </button>
        <button
          className={`tp-tab${subTab === 'detailed' ? ' tp-tab--active' : ''}`}
          onClick={() => setSubTab('detailed')}
          type="button"
        >
          Detailed
          {events.length > 0 && <span className="tp-tab-cnt">{events.length}</span>}
        </button>
      </div>

      <div className="tp-body">
        {subTab === 'simple'
          ? <SimpleStepper events={events} />
          : <DetailedStepper events={events} />}
      </div>
    </div>
  );
}

// ── Simple: classic #/Step/Product/Status table ───────────────────────────

export function SimpleStepper({ events }) {
  if (!events.length) {
    return <div className="tp-empty">No token events yet.</div>;
  }

  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return (
    <table className="tp-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Step</th>
          <th scope="col">Product</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev, i) => (
          <SimpleRow
            key={ev.id || `idx-${i}`}
            event={ev}
            index={i}
            halted={haltedIdx === i}
            didNotRun={haltedIdx !== -1 && i > haltedIdx}
          />
        ))}
      </tbody>
    </table>
  );
}

function SimpleRow({ event, index, halted, didNotRun }) {
  const { bucket, label: statusLabel } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);

  let rowCls = '';
  if (halted)                          rowCls = 'tp-row--halted';
  else if (didNotRun)                  rowCls = 'tp-row--ghost';
  else if (bucket === 'notinpath')     rowCls = 'tp-row--notinpath';

  let statusEl;
  if (didNotRun)       statusEl = <span className="tp-st tp-st--skip">— did not run</span>;
  else if (halted)     statusEl = <span className="tp-st tp-st--halt">✕ {event.errorCode || 'halted'}</span>;
  else if (bucket === 'success') statusEl = <span className="tp-st tp-st--ok" aria-label="Success">✓</span>;
  else                 statusEl = <span className={`tp-st tp-st--${bucket}`}>{statusLabel}</span>;

  return (
    <tr className={rowCls}>
      <td className="tp-col-num">{index + 1}</td>
      <td className="tp-col-step">{label}</td>
      <td className="tp-col-product">{product ? <PingProductChip product={product} size="xs" /> : null}</td>
      <td className="tp-col-status">{statusEl}</td>
    </tr>
  );
}

// ── Detailed: card-per-step with claims, RFC pills, narratives ────────────

export function DetailedStepper({ events }) {
  if (!events.length) {
    return <div className="tp-empty">No token events yet.</div>;
  }

  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return (
    <div className="tp-det">
      {haltedIdx !== -1 && (
        <div className="tp-det-banner">
          <strong>✕ Run stopped at step {haltedIdx + 1} — &ldquo;{events[haltedIdx].label || events[haltedIdx].id}&rdquo;</strong>
          {' '}Steps after the halt did not run.
        </div>
      )}
      {events.map((ev, i) => (
        <DetailedCard
          key={ev.id || `idx-${i}`}
          event={ev}
          index={i}
          halted={haltedIdx === i}
          didNotRun={haltedIdx !== -1 && i > haltedIdx}
        />
      ))}
    </div>
  );
}

function DetailedCard({ event, index, halted, didNotRun }) {
  const { bucket } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);
  const hasClaims = event.claims && typeof event.claims === 'object' && Object.keys(event.claims).length > 0;
  const notInPath = bucket === 'notinpath';

  let cardCls = 'tp-det-card';
  let numCls = 'tp-det-num';
  let statusCls = 'tp-det-status';
  let statusLabel;

  if (halted) {
    cardCls += ' tp-det-card--fail';
    numCls += ' tp-det-num--fail';
    statusCls += ' tp-det-status--fail';
    statusLabel = `✕ ${event.errorCode || 'Halted'}`;
  } else if (didNotRun) {
    cardCls += ' tp-det-card--ghost';
    numCls += ' tp-det-num--skip';
    statusCls += ' tp-det-status--skip';
    statusLabel = '— did not run';
  } else if (notInPath) {
    cardCls += ' tp-det-card--skip';
    numCls += ' tp-det-num--skip';
    statusCls += ' tp-det-status--skip';
    statusLabel = 'Not in path';
  } else {
    cardCls += ' tp-det-card--ok';
    numCls += ' tp-det-num--ok';
    statusCls += ' tp-det-status--ok';
    statusLabel = '✓ Success';
  }

  const rfcPills = event.rfc
    ? String(event.rfc).split(/\s*·\s*/).map((r) => (
        <span key={r} className="tp-det-rfc">{r}</span>
      ))
    : null;

  return (
    <div className={cardCls}>
      <div className="tp-det-head">
        <div className={numCls}>{index + 1}</div>
        <div className="tp-det-info">
          <div className={notInPath ? 'tp-det-label tp-det-label--strike' : 'tp-det-label'}>{label}</div>
          <div className="tp-det-meta">
            {product && <PingProductChip product={product} size="xs" />}
            <span className={statusCls}>{statusLabel}</span>
            {rfcPills}
          </div>
        </div>
      </div>
      {hasClaims && !didNotRun && !notInPath && (
        <div className="tp-det-claims">
          {Object.entries(event.claims).map(([k, v]) => (
            <div key={k} className="tp-det-claim-row">
              <span className="tp-det-claim-k">{k}</span>
              <span className={`tp-det-claim-v${k === 'scope' ? ' tp-det-claim-v--scope' : ''}${k === 'act' ? ' tp-det-claim-v--act' : ''}${k === 'aud' ? ' tp-det-claim-v--aud' : ''}`}>
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
      {(event.narrative || event.why) && !didNotRun && !notInPath && (
        <p className="tp-det-narrative">{event.narrative || event.why}</p>
      )}
      {halted && (
        <div className="tp-det-error">
          DENY — {event.errorCode || 'BLOCKED'}: action blocked by policy
        </div>
      )}
    </div>
  );
}
