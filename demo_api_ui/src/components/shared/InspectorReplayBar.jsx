// demo_api_ui/src/components/shared/InspectorReplayBar.jsx
import React from 'react';
import './InspectorShell.css';

/**
 * Persistent status/nav strip between an InspectorShell's topbar and its
 * grid — step/denied/token counters plus Prev/Next/Clear. Presentational
 * only; the caller owns all counts and handlers.
 */
export default function InspectorReplayBar({
  stepCount = 0,
  deniedCount = 0,
  tokenCount = 0,
  onPrev,
  onNext,
  onClear,
  clearDisabled = false,
}) {
  return (
    <div className="inspector-shell-replay-bar">
      <span className="inspector-shell-replay-bar__item">
        Steps <strong>{stepCount}</strong>
      </span>
      <span
        className={
          deniedCount > 0
            ? 'inspector-shell-replay-bar__item inspector-shell-replay-bar__item--warn'
            : 'inspector-shell-replay-bar__item'
        }
      >
        Denied <strong>{deniedCount}</strong>
      </span>
      <span className="inspector-shell-replay-bar__item">
        Tokens minted <strong>{tokenCount}</strong>
      </span>
      <div className="inspector-shell-replay-bar__controls">
        <button type="button" className="inspector-shell-replay-bar__btn" onClick={onPrev}>
          ◀ Prev
        </button>
        <button type="button" className="inspector-shell-replay-bar__btn" onClick={onNext}>
          Next ▶
        </button>
        <button
          type="button"
          className="inspector-shell-replay-bar__btn"
          onClick={onClear}
          disabled={clearDisabled}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
