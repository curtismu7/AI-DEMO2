// banking_api_ui/src/components/FloatingTokenChainPanel.js
import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import TokenChainTraceRail from './TokenChainTraceRail';
import '../styles/draggablePanel.css';
import './FloatingTokenChainPanel.css';

/**
 * Floating, draggable, resizable Token Chain panel — opened app-wide from the
 * VerifiedBanner's expand button. Renders TokenChainTraceRail (same live
 * per-step trace + claim-diff detail as TokenChainModal on the agent chat
 * page) instead of the old illustrative-only education/TokenChainPanel.
 */
export default function FloatingTokenChainPanel({ isOpen, onClose }) {
  const [minimized, setMinimized] = useState(false);
  const tokenChain = useTokenChainOptional();

  /** Clear TraceRail + live events so presenters can reset between demo runs. */
  const handleClear = useCallback(() => {
    tokenChainTraceStore.reset();
    tokenChain?.clearEvents?.();
  }, [tokenChain]);

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
            className="ftcp-btn ftcp-btn--clear"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleClear}
            title="Clear token chain for the next demo run"
            aria-label="Clear token chain"
          >
            Clear
          </button>
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
          <TokenChainTraceRail />
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
