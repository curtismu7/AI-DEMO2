import React from 'react';
import { useThemeOptional } from '../../context/ThemeContext';
import './dashboard.css';

/**
 * Chrome shared by every New Relic-backed dashboard: title, window selector,
 * theme toggle, refresh, and the four load states. Children render only when
 * state is 'ready', so pages never have to guard their own body.
 */
export default function DashboardShell({
  title, subtitle, window: win, windows, onWindow, onRefresh,
  state, notConfiguredHint, children,
}) {
  const { darkMode, setDarkMode } = useThemeOptional();

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">{title}</h1>
          {subtitle ? <p className="dash-sub">{subtitle}</p> : null}
        </div>
        <span className="dash-spacer" />

        <div className="dash-seg" role="group" aria-label="Time window">
          {windows.map((w) => (
            <button key={w} type="button" onClick={() => onWindow(w)}
                    className={w === win ? 'is-on' : ''} aria-pressed={w === win}>
              {w}
            </button>
          ))}
        </div>

        <div className="dash-theme">
          <span className={darkMode ? '' : 'is-on'}>Light</span>
          <button type="button" className="dash-switch" role="switch"
                  aria-checked={darkMode} aria-label="Dark mode"
                  title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
                  onClick={() => setDarkMode(!darkMode)}>
            <span className="dash-thumb" />
          </button>
          <span className={darkMode ? 'is-on' : ''}>Dark</span>
        </div>

        <button type="button" className="dash-btn" onClick={onRefresh}>Refresh</button>
      </div>

      {state === 'loading' && (
        <div className="dash-msg" role="status">Loading…</div>
      )}

      {state === 'unconfigured' && (
        <div className="dash-msg" role="status">{notConfiguredHint}</div>
      )}

      {state === 'error' && (
        <div className="dash-msg dash-msg-err" role="alert">
          Could not load data. Check the BFF logs for the upstream reason.
        </div>
      )}

      {state === 'ready' && children}
    </div>
  );
}
