/**
 * BackendOperationIndicator — Phase 194 Plan 03
 * Shows one banking API operation that was triggered by an MCP tool call.
 * Compact: "[📡 GET /api/banking/balance] ✓ 145ms"
 * Expanded: full endpoint, status code, response summary, token used.
 *
 * @param {{
 *   operation: {
 *     id: string,
 *     name: string,
 *     endpoint: string,
 *     method: 'GET'|'POST'|'PUT'|'DELETE',
 *     status: 'pending'|'in_progress'|'success'|'error',
 *     durationMs?: number,
 *     responseStatus?: number,
 *     responseBody?: object,
 *     requestBody?: object,
 *     tokenUsed?: { tokenType: string, sub?: string },
 *     toolName?: string,
 *     error?: string,
 *   },
 * }} props
 */

import React, { useState } from 'react';

const STATUS_CONFIG = {
  pending:     { icon: '⏳', cls: 'boi-pending',     label: 'Pending'     },
  in_progress: { icon: '⟳', cls: 'boi-in-progress', label: 'In Progress', animate: true },
  success:     { icon: '✓', cls: 'boi-success',     label: 'OK'          },
  error:       { icon: '✕', cls: 'boi-error',       label: 'Error'       },
};

const METHOD_COLORS = {
  GET:    '#2563eb',
  POST:   '#16a34a',
  PUT:    '#d97706',
  DELETE: '#dc2626',
};

function summariseBody(body) {
  if (!body) return null;
  if (typeof body === 'string') return body.slice(0, 80);
  try {
    const str = JSON.stringify(body);
    return str.length > 80 ? str.slice(0, 77) + '…' : str;
  } catch { return String(body).slice(0, 80); }
}

export default function BackendOperationIndicator({ operation }) {
  const [expanded, setExpanded] = useState(false);
  if (!operation) return null;

  const sc = STATUS_CONFIG[operation.status] || STATUS_CONFIG.pending;
  const methodColor = METHOD_COLORS[operation.method] || '#6b7280';

  return (
    <div className={`boi-root ${sc.cls}`}>
      {/* Compact row */}
      <button
        type="button"
        className="boi-compact-row"
        onClick={() => setExpanded((v) => !v)}
        title={`${operation.name} — ${sc.label}`}
      >
        <span className="boi-icon">📡</span>
        <span className="boi-method" style={{ color: methodColor }}>{operation.method}</span>
        <code className="boi-endpoint">{operation.endpoint}</code>
        <span className={`boi-status-icon ${sc.animate ? 'boi-spin' : ''}`}>{sc.icon}</span>
        {operation.durationMs != null && (
          <span className="boi-duration">{operation.durationMs}ms</span>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="boi-details">
          <div className="boi-detail-row">
            <span className="boi-detail-key">Operation:</span>
            <span className="boi-detail-val">{operation.name}</span>
          </div>
          <div className="boi-detail-row">
            <span className="boi-detail-key">Endpoint:</span>
            <code className="boi-detail-val">{operation.method} {operation.endpoint}</code>
          </div>
          {operation.responseStatus && (
            <div className="boi-detail-row">
              <span className="boi-detail-key">HTTP Status:</span>
              <span className={`boi-detail-val boi-http-${Math.floor(operation.responseStatus / 100)}xx`}>
                {operation.responseStatus}
              </span>
            </div>
          )}
          {operation.durationMs != null && (
            <div className="boi-detail-row">
              <span className="boi-detail-key">Duration:</span>
              <span className="boi-detail-val">{operation.durationMs}ms</span>
            </div>
          )}
          {operation.responseBody && (
            <div className="boi-detail-row boi-detail-body">
              <span className="boi-detail-key">Response:</span>
              <code className="boi-detail-val boi-response-body">
                {summariseBody(operation.responseBody)}
              </code>
            </div>
          )}
          {operation.error && (
            <div className="boi-detail-row boi-detail-error">
              <span className="boi-detail-key">Error:</span>
              <span className="boi-detail-val">{operation.error}</span>
            </div>
          )}
          {operation.toolName && (
            <div className="boi-detail-row">
              <span className="boi-detail-key">Triggered by:</span>
              <code className="boi-detail-val">{operation.toolName}</code>
            </div>
          )}
          <button type="button" className="boi-close" onClick={() => setExpanded(false)}>×</button>
        </div>
      )}
    </div>
  );
}
