import React from 'react';

/**
 * Shows the list of overlay field paths currently applied to a vertical.
 * Each path has a per-field reset button (×); there's also a "Reset all" link.
 *
 * Props:
 *   paths: string[] — dot-path field names overridden on the seed
 *   onResetField: (path: string) => void
 *   onResetAll: () => void
 */
export function OverlayBadge({ paths, onResetField, onResetAll }) {
  if (!paths || paths.length === 0) {
    return <div className="overlay-badge overlay-badge--empty">No overrides</div>;
  }
  return (
    <div className="overlay-badge">
      <div className="overlay-badge__header">
        {paths.length} {paths.length === 1 ? 'override' : 'overrides'}
      </div>
      <ul className="overlay-badge__list">
        {paths.map((p) => (
          <li key={p}>
            <button
              onClick={() => onResetField(p)}
              className="overlay-badge__reset"
              aria-label={`Reset ${p}`}
              type="button"
            >×</button>
            <code>{p}</code>
          </li>
        ))}
      </ul>
      <button
        onClick={onResetAll}
        className="overlay-badge__reset-all"
        type="button"
      >Clear all overrides on this vertical</button>
    </div>
  );
}
