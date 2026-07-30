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

function SimpleStepper({ events }) {
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
            key={ev.id ? `${ev.id}-${i}` : `noid-${i}`}
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

// ── Detailed: same table, each row expands to show claims + narrative ─────

function DetailedStepper({ events }) {
  const [openIdx, setOpenIdx] = useState(null);

  if (!events.length) {
    return <div className="tp-empty">No token events yet.</div>;
  }

  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return (
    <table className="tp-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col" style={{ width: 20 }} />{/* expand chevron */}
          <th scope="col">Step</th>
          <th scope="col">Product</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev, i) => (
          <DetailedRows
            key={ev.id ? `${ev.id}-${i}` : `noid-${i}`}
            event={ev}
            index={i}
            halted={haltedIdx === i}
            didNotRun={haltedIdx !== -1 && i > haltedIdx}
            open={openIdx === i}
            onToggle={() => setOpenIdx(openIdx === i ? null : i)}
          />
        ))}
      </tbody>
    </table>
  );
}

function DetailedRows({ event, index, halted, didNotRun, open, onToggle }) {
  const { bucket, label: statusLabel } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);
  const hasClaims = event.claims && Object.keys(event.claims).length > 0;
  const canExpand = hasClaims || event.narrative || event.why;

  let rowCls = '';
  if (halted)                      rowCls = 'tp-row--halted';
  else if (didNotRun)              rowCls = 'tp-row--ghost';
  else if (bucket === 'notinpath') rowCls = 'tp-row--notinpath';

  let statusEl;
  if (didNotRun)             statusEl = <span className="tp-st tp-st--skip">— did not run</span>;
  else if (halted)           statusEl = <span className="tp-st tp-st--halt">✕ {event.errorCode || 'halted'}</span>;
  else if (bucket === 'success') statusEl = <span className="tp-st tp-st--ok" aria-label="Success">✓</span>;
  else                       statusEl = <span className={`tp-st tp-st--${bucket}`}>{statusLabel}</span>;

  return (
    <>
      <tr
        className={`${rowCls}${canExpand ? ' tp-row--expandable' : ''}${open ? ' tp-row--open' : ''}`}
        onClick={canExpand ? onToggle : undefined}
      >
        <td className="tp-col-num">{index + 1}</td>
        <td className="tp-col-chevron">
          {canExpand && <span className="tp-chevron" aria-hidden>{open ? '▾' : '▸'}</span>}
        </td>
        <td className="tp-col-step">{label}</td>
        <td className="tp-col-product">{product ? <PingProductChip product={product} size="xs" /> : null}</td>
        <td className="tp-col-status">{statusEl}</td>
      </tr>
      {open && canExpand && (
        <tr className="tp-row--detail">
          <td />
          <td />
          <td colSpan={3}>
            <div className="tp-detail">
              {(event.narrative || event.why) && (
                <p className="tp-detail-narrative">{event.narrative || event.why}</p>
              )}
              {hasClaims && (
                <div className="tp-claims">
                  {Object.entries(event.claims).map(([k, v]) => (
                    <div key={k} className="tp-claim-row">
                      <span className="tp-claim-k">{k}</span>
                      <span className="tp-claim-v">
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
