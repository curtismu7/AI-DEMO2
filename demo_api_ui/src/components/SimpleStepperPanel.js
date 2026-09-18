// demo_api_ui/src/components/SimpleStepperPanel.js
import React from 'react';
import DraggableModal from './DraggableModal';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { isHaltedAt, resolveStatusVisual } from './TokenChainDisplay';
import { PingProductChip } from './PingProductChip';
import { productForEvent } from '../utils/pingProducts';
import './SimpleStepperPanel.css';

/**
 * Simple Stepper's compact per-step audit table. Its shell is owned by the
 * shared DraggableModal so it has consistent drag, resize, and pop-out controls.
 */
export default function SimpleStepperPanel({ isOpen, onClose, autoPopOut = false }) {
  const ctx = useTokenChainOptional();

  // Keep the shared modal mounted only while visible. Its unmount cleanup owns
  // the child-window close lifecycle after a pop-out.
  if (!ctx || !isOpen) return null;

  const events = ctx.events ?? [];
  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Simple Stepper"
      storageKey="sstp-modal"
      noBackdrop
      footer={null}
      defaultWidth={560}
      defaultHeight={480}
      minWidth={360}
      minHeight={240}
      autoPopOut={autoPopOut}
    >
      <div className="sstp-body">
        {events.length === 0 ? (
          <div className="sstp-empty">No token events yet.</div>
        ) : (
          <table className="sstp-table">
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
        )}
      </div>
    </DraggableModal>
  );
}

/** One table row: # / Step / Product / Status. */
function StepRow({ event, index, halted, didNotRun }) {
  const { bucket, label: statusLabel } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);

  let rowClass = '';
  if (halted) rowClass = 'sstp-row--halted';
  else if (didNotRun) rowClass = 'sstp-row--ghost';
  else if (bucket === 'notinpath') rowClass = 'sstp-row--notinpath';

  let statusCell;
  if (didNotRun) {
    statusCell = <span className="sstp-st sstp-st--skip">— did not run</span>;
  } else if (halted) {
    statusCell = <span className="sstp-st sstp-st--halt">✕ {event.errorCode || 'halted'}</span>;
  } else if (bucket === 'success') {
    statusCell = <span className="sstp-st sstp-st--ok" aria-label="Success">✓</span>;
  } else {
    statusCell = <span className={`sstp-st sstp-st--${bucket}`}>{statusLabel}</span>;
  }

  return (
    <tr className={rowClass}>
      <td className="sstp-num">{index + 1}</td>
      <td className="sstp-step">{label}</td>
      <td className="sstp-product">{product ? <PingProductChip product={product} size="xs" /> : null}</td>
      <td className="sstp-status">{statusCell}</td>
    </tr>
  );
}
