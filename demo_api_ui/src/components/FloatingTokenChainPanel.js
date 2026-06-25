// banking_api_ui/src/components/FloatingTokenChainPanel.js
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import TokenChainPanel from './education/TokenChainPanel';
import '../styles/draggablePanel.css';
import './FloatingTokenChainPanel.css';

/**
 * Floating, draggable, resizable Token Chain panel for the marketing page.
 * Shows the RFC 8693 token chain visualization in a movable overlay.
 *
 * credentialPath: each event in the chain carries a credentialPath field added in Phase 266.
 * TokenChainPanel (below) delegates to TokenChainDisplay which renders per-segment
 * colour/badge (blue/amber/teal) based on that field. No pass-through change needed here.
 */
export default function FloatingTokenChainPanel({ isOpen, onClose }) {
  const [minimized, setMinimized] = useState(false);

  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    () => ({
      x: Math.max(20, window.innerWidth - 520),
      y: Math.max(60, 80),
    }),
    { w: 480, h: 560 },
    { storageKey: 'ftcp-pos', minW: 340, minH: 240 }
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="ftcp-card"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? 'auto' : size.h,
        zIndex: 9980,
      }}
      role="dialog"
      aria-label="Token Chain Visualization"
    >
      {/* Drag handle — header */}
      <div className="ftcp-header" onPointerDown={handleDragStart} title="Drag to move">
        <span className="ftcp-title">Token Chain — RFC 8693</span>
        <div className="ftcp-controls">
          <button
            type="button"
            className="ftcp-btn"
            onClick={() => setMinimized(m => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
            aria-label={minimized ? 'Expand panel' : 'Minimize panel'}
          >
            {minimized ? '▸' : '▾'}
          </button>
          <button
            type="button"
            className="ftcp-btn ftcp-btn--close"
            onClick={onClose}
            title="Close"
            aria-label="Close token chain panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      {!minimized && (
        <div className="ftcp-body">
          <TokenChainPanel />
        </div>
      )}

      {/* Resize handles */}
      {!minimized && (
        <div className="drp-resize-handles">
          <div className="drp-resize-handle drp-resize-handle--n" onMouseDown={createResizeHandler('n')} />
          <div className="drp-resize-handle drp-resize-handle--s" onMouseDown={createResizeHandler('s')} />
          <div className="drp-resize-handle drp-resize-handle--e" onMouseDown={createResizeHandler('e')} />
          <div className="drp-resize-handle drp-resize-handle--w" onMouseDown={createResizeHandler('w')} />
          <div className="drp-resize-handle drp-resize-handle--ne" onMouseDown={createResizeHandler('ne')} />
          <div className="drp-resize-handle drp-resize-handle--nw" onMouseDown={createResizeHandler('nw')} />
          <div className="drp-resize-handle drp-resize-handle--se" onMouseDown={createResizeHandler('se')} />
          <div className="drp-resize-handle drp-resize-handle--sw" onMouseDown={createResizeHandler('sw')} />
        </div>
      )}
    </div>,
    document.body
  );
}
