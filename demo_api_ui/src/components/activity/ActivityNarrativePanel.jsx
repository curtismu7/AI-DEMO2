import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../../hooks/useDraggablePanel';
import { useActivityNarrativeOptional } from '../../context/ActivityNarrativeContext';
import '../../styles/draggablePanel.css';
import './ActivityNarrativePanel.css';

const GLYPH = { running: '⟳', done: '✓', failed: '✕' }; // ⟳ ✓ ✕

function StepRow({ step }) {
  return (
    <div className={`anp-step anp-step--${step.tone}`}>
      <span className={`anp-glyph anp-glyph--${step.status}`} aria-hidden="true">{GLYPH[step.status]}</span>
      <span className="anp-step-text">{step.text}</span>
    </div>
  );
}

function RequestGroup({ request }) {
  const summary = `${request.steps.length} steps · ${request.status}`;
  return (
    <div className="anp-request">
      <div className="anp-request-head">You asked: {request.prompt}</div>
      {request.collapsed
        ? <div className="anp-summary">{summary}</div>
        : request.steps.map((s) => <StepRow key={s.key} step={s} />)}
    </div>
  );
}

export default function ActivityNarrativePanel({ isOpen }) {
  const ctx = useActivityNarrativeOptional();
  const endRef = useRef(null);
  // Keep the newest step in view as the story grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [ctx?.requests]);
  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    () => ({ x: Math.max(20, window.innerWidth - 540), y: Math.max(60, 80) }),
    { w: 360, h: 480 },
    { storageKey: 'anp-pos', minW: 280, minH: 200 },
  );

  if (!isOpen || !ctx) return null;

  return createPortal(
    <div
      className="anp-card"
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 9979 }}
      role="dialog"
      aria-label="What's happening"
    >
      <div className="anp-header" onPointerDown={handleDragStart} title="Drag to move">
        <span className="anp-title">What's happening</span>
      </div>
      <div className="anp-body">
        {ctx.requests.length === 0
          ? (
            <div className="anp-empty">
              <div className="anp-empty-pulse" aria-hidden="true">
                <span /><span /><span />
              </div>
              <div className="anp-empty-title">Ready and listening</div>
              <div className="anp-empty-text">
                Ask the assistant anything. The story of each request — identity,
                delegation, and every step it takes — will appear here as it works.
              </div>
              <div className="anp-empty-status" role="status">
                <span className="anp-empty-dot" aria-hidden="true" />
                Waiting for your first request
              </div>
            </div>
          )
          : ctx.requests.map((r) => <RequestGroup key={r.id} request={r} />)}
        <div ref={endRef} />
      </div>
      <div className="drp-resize-handles">
        <div className="drp-resize-handle drp-resize-handle--se" onMouseDown={createResizeHandler('se')} />
      </div>
    </div>,
    document.body,
  );
}
