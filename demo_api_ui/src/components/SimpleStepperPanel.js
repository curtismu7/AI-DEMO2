// demo_api_ui/src/components/SimpleStepperPanel.js
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { isHaltedAt, resolveStatusVisual } from './TokenChainDisplay';
import { PingProductChip } from './PingProductChip';
import { productForEvent } from '../utils/pingProducts';
import '../styles/draggablePanel.css';
import './SimpleStepperPanel.css';

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/**
 * Floating, draggable, resizable Simple Stepper panel — one table row per
 * token-chain step. Distinct from the full Token Chain panel
 * (FloatingTokenChainPanel): this is the compact per-step audit table popped
 * out from SimpleStepperBar.
 *
 * Dragging uses pointer capture (useDraggablePanel) so the panel can be
 * dragged fully off-screen, e.g. onto a second monitor.
 */
export default function SimpleStepperPanel({ isOpen, onClose }) {
  const ctx = useTokenChainOptional();
  const [minimized, setMinimized] = useState(false);

  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    () => ({
      x: Math.max(20, window.innerWidth - 620),
      y: Math.max(60, 90),
    }),
    { w: 560, h: 480 },
    { storageKey: 'ssp-pos', minW: 360, minH: 240 }
  );

  if (!ctx || !isOpen) return null;

  const events = ctx.events ?? [];
  const haltedIdx = events.findIndex((ev, i) => isHaltedAt(events, i));

  return createPortal(
    <div
      className="ssp-card"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? 'auto' : size.h,
        zIndex: 9980,
      }}
      role="dialog"
      aria-label="Simple Stepper"
    >
      <div className="ssp-header" onPointerDown={handleDragStart} title="Drag to move">
        <span className="ssp-title">Simple Stepper</span>
        {events.length > 0 && <span className="ssp-count">{events.length}</span>}
        <div className="ssp-controls">
          <button
            type="button"
            className="ssp-btn"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
            aria-label={minimized ? 'Expand panel' : 'Minimize panel'}
          >
            {minimized ? '▸' : '▾'}
          </button>
          <button
            type="button"
            className="ssp-btn ssp-btn--close"
            onClick={onClose}
            title="Close"
            aria-label="Close Simple Stepper"
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="ssp-body">
          {events.length === 0 ? (
            <div className="ssp-empty">No token events yet.</div>
          ) : (
            <table className="ssp-table">
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
      )}

      {!minimized && (
        <div className="drp-resize-handles">
          {RESIZE_DIRS.map((dir) => (
            <div
              key={dir}
              className={`drp-resize-handle drp-resize-handle--${dir}`}
              onMouseDown={createResizeHandler(dir)}
            />
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

/** One table row: # / Step / Product / Status. */
function StepRow({ event, index, halted, didNotRun }) {
  const { bucket, label: statusLabel } = resolveStatusVisual(event.status);
  const label = event.label || event.id || 'Step';
  const product = productForEvent(event);

  let rowClass = '';
  if (halted) rowClass = 'ssp-row--halted';
  else if (didNotRun) rowClass = 'ssp-row--ghost';

  let statusCell;
  if (didNotRun) {
    statusCell = <span className="ssp-st ssp-st--skip">— did not run</span>;
  } else if (halted) {
    statusCell = <span className="ssp-st ssp-st--halt">✕ {event.errorCode || 'halted'}</span>;
  } else if (bucket === 'success') {
    statusCell = <span className="ssp-st ssp-st--ok" aria-label="Success">✓</span>;
  } else {
    statusCell = <span className={`ssp-st ssp-st--${bucket}`}>{statusLabel}</span>;
  }

  return (
    <tr className={rowClass}>
      <td className="ssp-num">{index + 1}</td>
      <td className="ssp-step">{label}</td>
      <td className="ssp-product">{product ? <PingProductChip product={product} size="xs" /> : null}</td>
      <td className="ssp-status">{statusCell}</td>
    </tr>
  );
}
