// demo_api_ui/src/components/shared/InspectorShell.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './InspectorShell.css';

const WIDTHS_KEY = 'inspector-shell-panel-widths';
const LEFT_COLLAPSED_KEY = 'inspector-shell-left-collapsed';
const MIN_LEFT = 160;
const MAX_LEFT = 480;
const MIN_MIDDLE = 260;
const MAX_MIDDLE = 640;
const DEFAULT_WIDTHS = { left: 240, middle: 380 };

function loadWidths() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(WIDTHS_KEY));
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.middle)) return saved;
  } catch {
    // Malformed or unavailable storage (private browsing, quota) — use defaults.
  }
  return DEFAULT_WIDTHS;
}

function loadLeftCollapsed() {
  try {
    return window.localStorage.getItem(LEFT_COLLAPSED_KEY) === 'true';
  } catch {
    // Malformed or unavailable storage (private browsing, quota) — default open.
    return false;
  }
}

/**
 * Shared topbar + 3-column grid for tool/list-detail inspector pages.
 * Owns only the left/middle column widths (drag-to-resize, persisted to
 * localStorage) — everything else is presentational. Callers supply
 * left/middle/right column content and manage their own selection,
 * form, and tab state.
 */
export default function InspectorShell({
  title,
  statusOn = true,
  statusText,
  actions,
  fullHeight = true,
  banner,
  left,
  middle,
  right,
}) {
  const [widths, setWidths] = useState(loadWidths);
  const [leftCollapsed, setLeftCollapsed] = useState(loadLeftCollapsed);
  const dragRef = useRef(null);

  const toggleLeftCollapsed = useCallback(() => {
    setLeftCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(LEFT_COLLAPSED_KEY, String(next));
      } catch {
        // Ignore write failures (private browsing, quota).
      }
      return next;
    });
  }, []);

  const onDragMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    if (drag.which === 'left') {
      const next = Math.min(Math.max(drag.startWidth + delta, MIN_LEFT), MAX_LEFT);
      setWidths((w) => ({ ...w, left: next }));
    } else {
      const next = Math.min(Math.max(drag.startWidth + delta, MIN_MIDDLE), MAX_MIDDLE);
      setWidths((w) => ({ ...w, middle: next }));
    }
  }, []);

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    setWidths((w) => {
      try {
        window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(w));
      } catch {
        // Ignore write failures (private browsing, quota).
      }
      return w;
    });
  }, [onDragMove]);

  const onDragStart = useCallback(
    (which) => (e) => {
      dragRef.current = { which, startX: e.clientX, startWidth: widths[which] };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    },
    [widths, onDragMove, onDragEnd],
  );

  // If the component unmounts mid-drag (e.g. a route change while the mouse
  // button is still held), remove the listeners added in onDragStart so they
  // don't linger on `document` for the rest of the SPA session.
  useEffect(() => () => {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }, [onDragMove, onDragEnd]);

  return (
    <div className="inspector-shell-page">
      <div className="inspector-shell-topbar">
        <span
          className={
            statusOn
              ? 'inspector-shell-topbar__dot'
              : 'inspector-shell-topbar__dot inspector-shell-topbar__dot--off'
          }
        />
        <h1>{title}</h1>
        {left != null && (
          <button
            type="button"
            className="inspector-shell-topbar__btn"
            onClick={toggleLeftCollapsed}
            aria-expanded={!leftCollapsed}
            aria-label={leftCollapsed ? 'Show tools' : 'Hide tools'}
          >
            {leftCollapsed ? 'Show tools' : 'Hide tools'}
          </button>
        )}
        {statusText && <span className="inspector-shell-topbar__status">{statusText}</span>}
        {actions && <div className="inspector-shell-topbar__right">{actions}</div>}
      </div>
      {banner}
      <div
        className={
          fullHeight === 'fill'
            ? 'inspector-shell-grid inspector-shell-grid--fill'
            : fullHeight
              ? 'inspector-shell-grid'
              : 'inspector-shell-grid inspector-shell-grid--embedded'
        }
        style={{
          gridTemplateColumns: leftCollapsed
            ? `0px 0px ${widths.middle}px 6px 1fr`
            : `${widths.left}px 6px ${widths.middle}px 6px 1fr`,
        }}
      >
        <div
          className={
            leftCollapsed
              ? 'inspector-shell-col-left inspector-shell-col-left--collapsed'
              : 'inspector-shell-col-left'
          }
          aria-hidden={leftCollapsed || undefined}
        >
          {left}
        </div>
        <div
          className="inspector-shell-resize-handle"
          onMouseDown={onDragStart('left')}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize tool list column"
          aria-hidden={leftCollapsed || undefined}
          style={leftCollapsed ? { pointerEvents: 'none' } : undefined}
        />
        <div className="inspector-shell-col-middle">{middle}</div>
        <div
          className="inspector-shell-resize-handle"
          onMouseDown={onDragStart('middle')}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize form column"
        />
        <div className="inspector-shell-col-right">{right}</div>
      </div>
    </div>
  );
}
