// demo_api_ui/src/components/shared/InspectorShell.jsx
import React from 'react';
import './InspectorShell.css';

/**
 * Shared topbar + 3-column grid for tool/list-detail inspector pages.
 * Presentational only — owns no state, no data shape. Callers supply
 * left/middle/right column content and manage their own selection,
 * form, and tab state.
 */
export default function InspectorShell({
  title,
  statusOn = true,
  statusText,
  actions,
  fullHeight = true,
  left,
  middle,
  right,
}) {
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
        {statusText && <span className="inspector-shell-topbar__status">{statusText}</span>}
        {actions && <div className="inspector-shell-topbar__right">{actions}</div>}
      </div>
      <div
        className={
          fullHeight === 'fill'
            ? 'inspector-shell-grid inspector-shell-grid--fill'
            : fullHeight
              ? 'inspector-shell-grid'
              : 'inspector-shell-grid inspector-shell-grid--embedded'
        }
      >
        <div className="inspector-shell-col-left">{left}</div>
        <div className="inspector-shell-col-middle">{middle}</div>
        <div className="inspector-shell-col-right">{right}</div>
      </div>
    </div>
  );
}
