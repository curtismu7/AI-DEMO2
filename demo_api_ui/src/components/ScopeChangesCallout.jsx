/**
 * ScopeChangesCallout Component
 *
 * Displays a yellow warning callout highlighting scope narrowing across the token chain:
 * User Token → Agent Token → MCP Token
 *
 * Shows how scopes narrow at each step, with "read" highlighted in orange.
 */
import React from 'react';
import './ScopeChangesCallout.css';

export default function ScopeChangesCallout() {
  return (
    <div className="scope-changes-callout">
      <div className="scope-changes-content">
        <div className="scope-changes-icon">⚡</div>
        <div className="scope-changes-text">
          <span className="scope-changes-label">Scope Narrowing:</span>
          <span className="scope-changes-progression">
            User Token: read write → Agent Token: read write → MCP Token:{' '}
            <span className="scope-highlight">read</span> (narrowed)
          </span>
        </div>
      </div>
    </div>
  );
}
