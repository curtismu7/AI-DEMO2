// demo_api_ui/src/components/StepsTabContent.js
import React from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { isHaltedAt, resolveStatusVisual } from './TokenChainDisplay';
import { PingProductChip } from './PingProductChip';
import { productForEvent } from '../utils/pingProducts';
import './StepsTabContent.css';

export default function StepsTabContent() {
  const ctx = useTokenChainOptional();

  if (!ctx) return null;

  const events = ctx.events ?? [];
  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  if (events.length === 0) {
    return <div className="stc-empty">No token events yet.</div>;
  }

  return (
    <table className="stc-table">
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
          <StepRow
            key={ev.id ? `${ev.id}-${i}` : `no-id-${i}`}
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

function StepRow({ event, index, halted, didNotRun }) {
  const { bucket, label: statusLabel } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);

  let rowClass = '';
  if (halted) rowClass = 'stc-row--halted';
  else if (didNotRun) rowClass = 'stc-row--ghost';
  else if (bucket === 'notinpath') rowClass = 'stc-row--notinpath';

  let statusCell;
  if (didNotRun) {
    statusCell = <span className="stc-st stc-st--skip">— did not run</span>;
  } else if (halted) {
    statusCell = <span className="stc-st stc-st--halt">✕ {event.errorCode || 'halted'}</span>;
  } else if (bucket === 'success') {
    statusCell = <span className="stc-st stc-st--ok" aria-label="Success">✓</span>;
  } else {
    statusCell = <span className={`stc-st stc-st--${bucket}`}>{statusLabel}</span>;
  }

  return (
    <tr className={rowClass}>
      <td className="stc-num">{index + 1}</td>
      <td className="stc-step">{label}</td>
      <td className="stc-product">{product ? <PingProductChip product={product} size="xs" /> : null}</td>
      <td className="stc-status">{statusCell}</td>
    </tr>
  );
}
