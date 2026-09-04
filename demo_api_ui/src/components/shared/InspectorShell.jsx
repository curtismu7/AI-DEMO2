// demo_api_ui/src/components/shared/InspectorShell.jsx
import React, { useCallback, useState } from 'react';
import useDividerDrag from '../../hooks/useDividerDrag';
import { useThemeOptional } from '../../context/ThemeContext';
import './InspectorShell.css';

const LEFT_COLLAPSED_KEY = 'inspector-shell-left-collapsed';

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
 *
 * Renders a light/dark toggle in the topbar by default. Pass
 * `hideThemeToggle` when the page already has its own page-level toggle
 * covering this shell too (e.g. a tabbed page where this shell renders
 * inside only one tab) — otherwise that tab would show two.
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
  hideThemeToggle = false,
}) {
  // Widths moved from one combined JSON key to per-column keys when the drag
  // logic converged on useDividerDrag — a stored pre-migration width resets
  // once to the defaults.
  const { size: leftWidth, handleProps: leftHandleProps } = useDividerDrag({
    min: 160,
    max: 480,
    initial: 240,
    storageKey: 'inspector-shell-left-width',
  });
  const { size: middleWidth, handleProps: middleHandleProps } = useDividerDrag({
    min: 260,
    max: 640,
    initial: 380,
    storageKey: 'inspector-shell-middle-width',
  });
  const [leftCollapsed, setLeftCollapsed] = useState(loadLeftCollapsed);
  const { darkMode, toggleDarkMode } = useThemeOptional();

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
        <div className="inspector-shell-topbar__right">
          {actions}
          {!hideThemeToggle && (
            <button
              type="button"
              onClick={toggleDarkMode}
              className="inspector-shell-topbar__theme-toggle"
              title="Switch this page between light and dark"
              aria-pressed={darkMode}
            >
              {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
            </button>
          )}
        </div>
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
            ? `0px 0px ${middleWidth}px 6px 1fr`
            : `${leftWidth}px 6px ${middleWidth}px 6px 1fr`,
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
          aria-label="Resize tool list column"
          aria-hidden={leftCollapsed || undefined}
          style={leftCollapsed ? { pointerEvents: 'none' } : undefined}
          {...leftHandleProps}
        />
        <div className="inspector-shell-col-middle">{middle}</div>
        <div
          className="inspector-shell-resize-handle"
          aria-label="Resize form column"
          {...middleHandleProps}
        />
        <div className="inspector-shell-col-right">{right}</div>
      </div>
    </div>
  );
}
