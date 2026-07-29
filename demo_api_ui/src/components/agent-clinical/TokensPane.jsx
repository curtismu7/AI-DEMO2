import { useState } from 'react';
import { PingProductChip } from '../PingProductChip';
import { isHaltedAt, resolveStatusVisual } from '../TokenChainDisplay';
import { useTokenChainOptional } from '../../context/TokenChainContext';
import { productForEvent } from '../../utils/pingProducts';
import './TokensPane.css';

/**
 * TokensPane — full token chain inspector under the Tokens tab.
 *
 * Two sub-tabs:
 * - Simple: compact table of token chain steps
 * - Detailed: expanded 20-step view with token details
 *
 * Both mount TokenChainTraceRail or expanded stepper views
 * embedded in the clinical agent context.
 */
export default function TokensPane() {
  const [subTab, setSubTab] = useState('simple');
  const ctx = useTokenChainOptional();

  return (
    <div className="ac-tokens">
      <header className="ac-tokens-head">
        <div className="ac-eyebrow ac-eyebrow--small">Tokens · chain</div>
        <h1 className="ac-tokens-h1">
          Every token, <i>traced</i>
        </h1>
        <p className="ac-tokens-sub">
          The full RFC 8693 exchange chain for this session — request flow,
          steps, and token details.
        </p>
      </header>

      <div className="ac-tokens-tabs">
        <button
          className={`ac-tokens-tab ${subTab === 'simple' ? 'ac-tokens-tab--active' : ''}`}
          onClick={() => setSubTab('simple')}
          type="button"
        >
          Simple
        </button>
        <button
          className={`ac-tokens-tab ${subTab === 'detailed' ? 'ac-tokens-tab--active' : ''}`}
          onClick={() => setSubTab('detailed')}
          type="button"
        >
          Detailed
        </button>
      </div>

      <div className="ac-tokens-body">
        {subTab === 'simple' && <SimpleStepper events={ctx?.events ?? []} />}
        {subTab === 'detailed' && <DetailedStepper events={ctx?.events ?? []} />}
      </div>
    </div>
  );
}

function SimpleStepper({ events }) {
  if (!events.length) {
    return <div className="ac-tokens-empty">No token events yet.</div>;
  }

  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return (
    <table className="ac-tokens-table">
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
          <SimpleStepRow
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

function SimpleStepRow({ event, index, halted, didNotRun }) {
  const { bucket, label: statusLabel } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);

  let rowClass = '';
  if (halted) rowClass = 'ac-tokens-row--halted';
  else if (didNotRun) rowClass = 'ac-tokens-row--ghost';
  else if (bucket === 'notinpath') rowClass = 'ac-tokens-row--notinpath';

  let statusCell;
  if (didNotRun) {
    statusCell = <span className="ac-tokens-st ac-tokens-st--skip">— did not run</span>;
  } else if (halted) {
    statusCell = <span className="ac-tokens-st ac-tokens-st--halt">✕ {event.errorCode || 'halted'}</span>;
  } else if (bucket === 'success') {
    statusCell = <span className="ac-tokens-st ac-tokens-st--ok" aria-label="Success">✓</span>;
  } else {
    statusCell = <span className={`ac-tokens-st ac-tokens-st--${bucket}`}>{statusLabel}</span>;
  }

  return (
    <tr className={rowClass}>
      <td className="ac-tokens-num">{index + 1}</td>
      <td className="ac-tokens-step">{label}</td>
      <td className="ac-tokens-product">{product ? <PingProductChip product={product} size="xs" /> : null}</td>
      <td className="ac-tokens-status">{statusCell}</td>
    </tr>
  );
}

function DetailedStepper({ events }) {
  if (!events.length) {
    return <div className="ac-tokens-empty">No token events yet.</div>;
  }

  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return (
    <div className="ac-tokens-detailed">
      {events.map((ev, i) => (
        <DetailedStepCard
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

function DetailedStepCard({ event, index, halted, didNotRun }) {
  const { bucket, label: statusLabel } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);

  let statusClass = '';
  if (halted) statusClass = 'ac-tokens-card--halted';
  else if (didNotRun) statusClass = 'ac-tokens-card--ghost';
  else if (bucket === 'notinpath') statusClass = 'ac-tokens-card--notinpath';
  else if (bucket === 'success') statusClass = 'ac-tokens-card--ok';

  let statusDisplay;
  if (didNotRun) {
    statusDisplay = '— did not run';
  } else if (halted) {
    statusDisplay = `✕ ${event.errorCode || 'halted'}`;
  } else if (bucket === 'success') {
    statusDisplay = '✓ Success';
  } else {
    statusDisplay = statusLabel;
  }

  return (
    <div className={`ac-tokens-card ${statusClass}`}>
      <div className="ac-tokens-card-header">
        <span className="ac-tokens-card-num">Step {index + 1}</span>
        <h3 className="ac-tokens-card-title">{label}</h3>
        {product && <PingProductChip product={product} size="sm" />}
      </div>
      <div className="ac-tokens-card-status">{statusDisplay}</div>
      {event.details && (
        <div className="ac-tokens-card-details">
          <pre>{JSON.stringify(event.details, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
