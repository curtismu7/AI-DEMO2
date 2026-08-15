// banking_api_ui/src/components/FloatingTokenChainPanel.js
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { PopOutPortal } from './DraggableModal';
import TokenChainTraceRail from './TokenChainTraceRail';
import StepsTabContent from './StepsTabContent';
import DetailedStepsTabContent from './DetailedStepsTabContent';
import TokenExchangeDiagram from './TokenExchangeDiagram';
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
  const [activeTab, setActiveTab] = useState('chain');
  const [popoutWin, setPopoutWin] = useState(null);
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

  const isPoppedOut = Boolean(popoutWin && !popoutWin.closed);

  // Same window/root bookkeeping as DraggableModal's pop-out — a real browser
  // window with the app's stylesheets copied in, rendered via a second React
  // root (PopOutPortal) so the SAME live context/store subscriptions the card
  // already reads from continue to drive it. No cross-window data bridging.
  const handlePopOut = useCallback(() => {
    if (isPoppedOut) {
      popoutWin.focus();
      return;
    }
    const w = size.w + 40;
    const h = size.h + 60;
    const left = window.screenX + pos.x;
    const top = window.screenY + pos.y;
    const win = window.open(
      '',
      `ftcp_${Date.now()}`,
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (!win) return;

    const styleLinks = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]'),
    )
      .map((el) => `<link rel="stylesheet" href="${el.href}">`)
      .join('\n');
    const inlineStyles = Array.from(document.querySelectorAll('style'))
      .map((el) => `<style>${el.textContent}</style>`)
      .join('\n');

    win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Token Chain — RFC 8693</title>
${styleLinks}
${inlineStyles}
<style>
html,body{margin:0;padding:0;height:100%}
#ftcp-popout-root{display:flex;flex-direction:column;height:100%;overflow:hidden}
</style>
</head><body><div id="ftcp-popout-root"></div></body></html>`);
    win.document.close();
    win.addEventListener('beforeunload', () => setPopoutWin(null));
    setPopoutWin(win);
  }, [isPoppedOut, popoutWin, size, pos]);

  // Close the popup window if the panel itself unmounts/closes.
  useEffect(
    () => () => {
      if (popoutWin && !popoutWin.closed) popoutWin.close();
    },
    [popoutWin],
  );

  if (!isOpen) return null;

  const controls = (
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
      {!isPoppedOut && (
        <button
          type="button"
          className="ftcp-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handlePopOut}
          title="Open in a separate window"
          aria-label="Open Token Chain in a separate window"
        >
          🪟
        </button>
      )}
      {!isPoppedOut && (
        <button
          type="button"
          className="ftcp-btn"
          onClick={() => setMinimized(m => !m)}
          title={minimized ? 'Expand' : 'Minimize'}
          aria-label={minimized ? 'Expand panel' : 'Minimize panel'}
        >
          {minimized ? '▸' : '▾'}
        </button>
      )}
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
  );

  const tabsBar = (
    <div className="ftcp-tabs">
      <button
        type="button"
        className={`ftcp-tab ${activeTab === 'chain' ? 'ftcp-tab--active' : ''}`}
        onClick={() => setActiveTab('chain')}
      >
        Full Chain
      </button>
      <button
        type="button"
        className={`ftcp-tab ${activeTab === 'simple' ? 'ftcp-tab--active' : ''}`}
        onClick={() => setActiveTab('simple')}
      >
        Simple ({tokenChain?.events?.length || 0})
      </button>
      <button
        type="button"
        className={`ftcp-tab ${activeTab === 'detailed' ? 'ftcp-tab--active' : ''}`}
        onClick={() => setActiveTab('detailed')}
      >
        Detailed
      </button>
      <button
        type="button"
        className={`ftcp-tab ${activeTab === 'diagram' ? 'ftcp-tab--active' : ''}`}
        onClick={() => setActiveTab('diagram')}
      >
        Diagram
      </button>
    </div>
  );

  const bodyContent = (
    <div className="ftcp-body">
      {activeTab === 'chain' && <TokenChainTraceRail />}
      {activeTab === 'simple' && <StepsTabContent />}
      {activeTab === 'detailed' && <DetailedStepsTabContent />}
      {activeTab === 'diagram' && <TokenExchangeDiagram />}
    </div>
  );

  if (isPoppedOut) {
    const popoutContent = (
      <div className="ftcp-popout-layout">
        <div className="ftcp-header ftcp-header--static">
          <span className="ftcp-title">Token Chain — RFC 8693</span>
          {controls}
        </div>
        {tabsBar}
        {bodyContent}
      </div>
    );
    return createPortal(
      <>
        <PopOutPortal win={popoutWin} rootId="ftcp-popout-root">{popoutContent}</PopOutPortal>
        <div
          className="ftcp-popout-placeholder"
          style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9980 }}
        >
          <span>🪟 Token Chain — open in separate window</span>
          <button
            type="button"
            className="ftcp-placeholder-btn"
            onClick={() => popoutWin.focus()}
          >
            Focus
          </button>
          <button
            type="button"
            className="ftcp-placeholder-btn"
            onClick={() => popoutWin.close()}
          >
            Close
          </button>
        </div>
      </>,
      document.body,
    );
  }

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
        {controls}
      </div>

      {/* Tab bar */}
      {!minimized && tabsBar}

      {/* Scrollable body */}
      {!minimized && bodyContent}

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
