// demo_api_ui/src/components/shared/InspectorShell.jsx
import React, { useCallback, useEffect, useState } from 'react';
import useDividerDrag from '../../hooks/useDividerDrag';
import { useThemeOptional } from '../../context/ThemeContext';
import './InspectorShell.css';

const LEFT_COLLAPSED_KEY = 'inspector-shell-left-collapsed';
const NARROW_QUERY = '(max-width: 768px)';

function loadLeftCollapsed() {
  try {
    return window.localStorage.getItem(LEFT_COLLAPSED_KEY) === 'true';
  } catch {
    // Malformed or unavailable storage (private browsing, quota) — default open.
    return false;
  }
}

// The 3-column grid's widths are set inline below (drag-to-resize), and an
// inline style always beats a stylesheet rule — a plain `@media` override on
// grid-template-columns can never win. Below NARROW_QUERY we stop setting it
// at all so InspectorShell.css's mobile block (same breakpoint) can stack the
// columns instead of clipping two of them off-screen on a phone.
function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = (e) => setIsNarrow(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isNarrow;
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
 *
 * The title is the page's h1. Pass `titleLevel={2}` when the shell is one
 * section of a page that already has its own h1.
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
  titleLevel = 1,
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
  const isNarrow = useIsNarrow();
  // The dividers are mouse-drag only, so they are not exposed as separators: a role=separator
  // that cannot take focus or answer the arrow keys is a control a keyboard user is told about
  // and cannot use.
  const dragOnly = (props) => {
    const rest = { ...props };
    delete rest.role;
    delete rest['aria-orientation'];
    return rest;
  };
  // A shell embedded under its page's own h1 passes titleLevel={2}; a second h1 breaks the heading outline.
  const TitleTag = titleLevel === 2 ? 'h2' : 'h1';

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
        <TitleTag>{title}</TitleTag>
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
              {/* One name for the control; aria-pressed carries the state (a name that flipped with it read as inverted). */}
              <span aria-hidden="true">{darkMode ? '☀️' : '🌙'}</span> Dark mode
            </button>
          )}
        </div>
      </div>
      {banner}
      <div
        className={
          (fullHeight === 'fill'
            ? 'inspector-shell-grid inspector-shell-grid--fill'
            : fullHeight
              ? 'inspector-shell-grid'
              : 'inspector-shell-grid inspector-shell-grid--embedded') +
          (isNarrow ? ' inspector-shell-grid--narrow' : '')
        }
        style={
          isNarrow
            ? undefined
            : {
                gridTemplateColumns: leftCollapsed
                  ? `0px 0px ${middleWidth}px 6px 1fr`
                  : `${leftWidth}px 6px ${middleWidth}px 6px 1fr`,
              }
        }
      >
        <div
          className={
            leftCollapsed
              ? 'inspector-shell-col-left inspector-shell-col-left--collapsed'
              : 'inspector-shell-col-left'
          }
          aria-hidden={leftCollapsed || undefined}
          // Clipped to 0px, not removed: inert keeps the collapsed rows out of the tab order.
          inert={leftCollapsed || undefined}
        >
          {left}
        </div>
        {!isNarrow && (
          <div
            className="inspector-shell-resize-handle"
            aria-hidden={leftCollapsed || undefined}
            style={leftCollapsed ? { pointerEvents: 'none' } : undefined}
            {...dragOnly(leftHandleProps)}
          />
        )}
        <div className="inspector-shell-col-middle">{middle}</div>
        {!isNarrow && (
          <div
            className="inspector-shell-resize-handle"
            {...dragOnly(middleHandleProps)}
          />
        )}
        <div className="inspector-shell-col-right">{right}</div>
      </div>
    </div>
  );
}
