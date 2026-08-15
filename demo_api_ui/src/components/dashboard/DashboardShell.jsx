import React, { useEffect, useRef, useState } from 'react';
import { useThemeOptional } from '../../context/ThemeContext';
import './dashboard.css';

// No lodash — this is the entire debounce. Typing resets the timer; only the
// value left standing SEARCH_DEBOUNCE_MS after the last keystroke is sent up.
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Chrome shared by every New Relic-backed dashboard: title, window selector,
 * search, theme toggle, refresh, and the four load states. Children render
 * only when state is 'ready', so pages never have to guard their own body.
 *
 * Search is opt-in: pass `onSearch` to show the input. The shell owns the
 * keystroke-to-debounced-value plumbing; the caller only ever sees the
 * settled term, the same way it only ever sees a clicked `window` value.
 */
export default function DashboardShell({
  title, subtitle, window: win, windows, onWindow, onRefresh,
  state, notConfiguredHint, children,
  search, onSearch, searchPlaceholder,
}) {
  const { darkMode, setDarkMode } = useThemeOptional();
  const [inputValue, setInputValue] = useState(search || '');
  const debounceRef = useRef(null);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(val.trim()), SEARCH_DEBOUNCE_MS);
  };

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setInputValue('');
    onSearch('');
  };

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

        {onSearch ? (
          <div className={`dash-search${inputValue ? ' is-active' : ''}`}>
            <input
              type="search"
              className="dash-search-input"
              value={inputValue}
              onChange={handleSearchChange}
              placeholder={searchPlaceholder || 'Search events…'}
              aria-label="Search events"
            />
            {inputValue ? (
              <button type="button" className="dash-search-clear"
                      onClick={clearSearch} aria-label="Clear search">
                ✕
              </button>
            ) : null}
          </div>
        ) : null}

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
