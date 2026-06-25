// demo_api_ui/src/components/EventStreamPanel.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEventStream } from '../context/EventStreamContext';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import EventCard from './EventCard';
import './EventStreamPanel.css';

const MODES = ['embedded', 'float', 'bottom'];

const MODE_LABELS = {
  embedded: 'Embedded',
  float: 'Floating',
  bottom: 'Bottom sheet',
};

const DEFAULT_FLOAT_POS  = { x: 24, y: 80 };
const DEFAULT_FLOAT_SIZE = { w: 420, h: 480 };
const STORAGE_KEY = 'esp-float-panel';

/**
 * Groups consecutive events that share the same requestId into labeled sections.
 * Events without a requestId (or whose requestId is the same as the previous group)
 * remain ungrouped.
 *
 * Returns an array of { dividerLabel, events } objects.
 */
function groupByRequest(events) {
  const groups = [];
  let lastRequestId = null;
  let currentGroup = null;

  for (const evt of events) {
    const rid = evt.requestId ?? null;
    if (rid !== null && rid !== lastRequestId) {
      // New request — push current group and start a fresh one
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { dividerLabel: `Request ${rid}`, events: [evt] };
      lastRequestId = rid;
    } else {
      if (!currentGroup) currentGroup = { dividerLabel: null, events: [] };
      currentGroup.events.push(evt);
    }
  }
  if (currentGroup) groups.push(currentGroup);
  return groups;
}

/**
 * Main event-stream panel.
 *
 * Modes:
 *   embedded  — normal document flow, fixed layout (default)
 *   float     — draggable/resizable floating window via useDraggablePanel
 *   bottom    — fixed bottom-sheet
 *
 * Props:
 *   onClose {function}  — optional close handler (shown as × button)
 */
export default function EventStreamPanel({ onClose }) {
  const {
    events,
    mode,
    autoScrollEnabled,
    clearHistory,
    setMode,
    pauseAutoScroll,
    resumeAutoScroll,
  } = useEventStream();

  // ── Draggable hook (only applies in float mode) ──────────────
  const { pos, size, handleDragStart } = useDraggablePanel(
    DEFAULT_FLOAT_POS,
    DEFAULT_FLOAT_SIZE,
    { storageKey: STORAGE_KEY, minW: 300, minH: 200 }
  );

  // ── Auto-scroll ──────────────────────────────────────────────
  const bodyRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (autoScrollEnabled) {
      scrollToBottom();
    }
  }, [events, autoScrollEnabled, scrollToBottom]);

  // Pause auto-scroll when the user manually scrolls up
  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (atBottom && !autoScrollEnabled) {
      resumeAutoScroll();
    } else if (!atBottom && autoScrollEnabled) {
      pauseAutoScroll();
    }
  }, [autoScrollEnabled, pauseAutoScroll, resumeAutoScroll]);

  // ── Mode change ──────────────────────────────────────────────
  const handleModeChange = useCallback((e) => {
    setMode(e.target.value);
  }, [setMode]);

  // ── Grouped events ───────────────────────────────────────────
  const groups = groupByRequest(events);

  // ── Float-mode inline styles ─────────────────────────────────
  const floatStyle = mode === 'float'
    ? { top: pos.y, left: pos.x, width: size.w, height: size.h }
    : undefined;

  const [isDragging, setIsDragging] = useState(false);

  const onTitlebarPointerDown = useCallback((e) => {
    if (mode !== 'float') return;
    setIsDragging(true);
    handleDragStart(e);
    const cleanup = () => setIsDragging(false);
    document.addEventListener('pointerup', cleanup, { once: true });
    document.addEventListener('pointercancel', cleanup, { once: true });
  }, [mode, handleDragStart]);

  return (
    <div
      className={`esp-panel panel-mode-${mode}${isDragging ? ' esp-dragging' : ''}`}
      style={floatStyle}
      data-testid="esp-panel"
    >
      {/* ── Title bar ────────────────────────────────── */}
      <div
        className="esp-titlebar"
        onPointerDown={onTitlebarPointerDown}
      >
        <span className="esp-title">What's Happening</span>
        <div className="esp-controls">
          <select
            className="esp-mode-select"
            value={mode}
            onChange={handleModeChange}
            aria-label="Panel mode"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
          </select>

          <button
            type="button"
            className="esp-btn"
            onClick={clearHistory}
            title="Clear events"
            aria-label="Clear events"
          >
            ✕
          </button>

          {onClose && (
            <button
              type="button"
              className="esp-btn"
              onClick={onClose}
              title="Close panel"
              aria-label="Close panel"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── Event list ───────────────────────────────── */}
      <div
        ref={bodyRef}
        className="esp-body"
        onScroll={handleScroll}
        data-testid="esp-body"
      >
        {events.length === 0 ? (
          <div className="esp-empty">
            <span className="esp-empty-icon">📡</span>
            <span className="esp-empty-text">No events yet. Agent activity will appear here.</span>
          </div>
        ) : (
          groups.map((group, gi) => (
            <React.Fragment key={gi}>
              {group.dividerLabel && (
                <div className="esp-divider">{group.dividerLabel}</div>
              )}
              {group.events.map((evt) => (
                <EventCard key={evt.id} event={evt} />
              ))}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}
