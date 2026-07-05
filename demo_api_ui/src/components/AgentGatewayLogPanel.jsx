// AgentGatewayLogPanel.jsx
//
// Live log window for the Real Agent Gateway (PingGateway / IG). Two views:
//   1. Recent decisions — parsed from the gateway's X-Gw-Audit-Trail (why a call
//      was PERMITted / DENYed, incl. real PingOne Authorize deny statements).
//   2. Raw container logs — the IG stdout (introspection, [P1AZ] REQUEST/RESPONSE/
//      DECISION, token exchange), read by the BFF over the docker socket.
//
// Backend (admin-only): GET /api/admin/agent-gateway/decisions,
//                       GET /api/admin/agent-gateway/logs?tail=&filter=
//
// Admin-only surface; reuses McpGatewayConfig.css (mgc-*) for styling.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../services/apiClient';

const TAIL_OPTIONS = [100, 200, 500, 1000];
const REFRESH_MS = 4000;

// A real PingOne Authorize statement carries a JSON string payload; pull a
// human message out of it for display, falling back to the statement name.
function statementMessage(stmt) {
  if (!stmt) return '';
  try {
    const p = typeof stmt.payload === 'string' ? JSON.parse(stmt.payload) : stmt.payload;
    return (p && (p.message || p.reason)) || stmt.name || stmt.code || '';
  } catch {
    return stmt.name || stmt.code || '';
  }
}

export default function AgentGatewayLogPanel() {
  const [logs, setLogs] = useState([]);
  const [logError, setLogError] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [filter, setFilter] = useState('');
  const [tail, setTail] = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const preRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/admin/agent-gateway/logs', {
        params: { tail, filter: filter.trim() || undefined },
      });
      if (data.ok) {
        setLogs(data.lines || []);
        setLogError(null);
      } else {
        setLogs([]);
        setLogError(data.error || 'Could not read gateway logs.');
      }
    } catch (e) {
      setLogError(e?.response?.status === 403
        ? 'Admin access required to read gateway logs.'
        : 'Failed to reach the log endpoint.');
    } finally {
      setLoading(false);
    }
  }, [tail, filter]);

  const fetchDecisions = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/admin/agent-gateway/decisions', {
        params: { limit: 20 },
      });
      setDecisions(data.decisions || []);
    } catch {
      /* decisions are best-effort; the raw log still renders */
    }
  }, []);

  const refresh = useCallback(() => { fetchLogs(); fetchDecisions(); }, [fetchLogs, fetchDecisions]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  // Keep the log window pinned to the newest line after each load.
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="mgc-section">
      <h4>Real Agent Gateway logs</h4>
      <p className="mgc-field-hint">
        Live view of the PingGateway (IG) container: recent authorize decisions and the
        raw gateway log (introspection, <code>[P1AZ]</code> decision calls, token exchange).
        Read by the BFF over the docker socket — admin only.
      </p>

      {/* Recent decisions */}
      <div className="mgc-field-label" style={{ marginTop: 6 }}>Recent decisions</div>
      {decisions.length === 0 ? (
        <p className="mgc-field-hint">No gateway decisions recorded yet. Send a tool call through the PingOne Agent Gateway.</p>
      ) : (
        <table className="mgc-env-table">
          <tbody>
            {decisions.map((d, i) => {
              const denied = d.decision !== 'PERMIT';
              const why = d.reason
                || (d.statements || []).map(statementMessage).filter(Boolean).join(' | ')
                || '';
              return (
                <tr key={`${d.ts}-${i}`}>
                  <td className="mgc-env-key" style={{ whiteSpace: 'nowrap' }}>
                    <span className={denied ? 'mgc-badge mgc-badge--error' : 'mgc-badge mgc-badge--live'}>
                      {d.decision}
                    </span>
                  </td>
                  <td className="mgc-env-val">
                    <code>{d.tool || '(none)'}</code>
                    {d.backend ? <span className="mgc-field-hint"> · {d.backend}</span> : null}
                    {why ? <div className="mgc-field-hint" style={{ marginTop: 2 }}>{why}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Raw log controls */}
      <div className="mgc-info-grid" style={{ marginTop: 12, alignItems: 'end' }}>
        <label className="mgc-field" style={{ margin: 0 }}>
          <span className="mgc-field-label">Filter</span>
          <input className="mgc-input" value={filter} spellCheck={false}
            placeholder="e.g. P1AZ, DENY, get_my_accounts"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchLogs(); }} />
        </label>
        <label className="mgc-field" style={{ margin: 0 }}>
          <span className="mgc-field-label">Lines</span>
          <select className="mgc-input" value={tail} onChange={(e) => setTail(Number(e.target.value))}>
            {TAIL_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="mgc-field" style={{ margin: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <button type="button" className="mgc-push-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto (4s)
          </label>
        </div>
      </div>

      {logError && <div className="mgc-alert mgc-alert--error" style={{ marginTop: 10 }}>{logError}</div>}

      <div className="mgc-code-block" style={{ marginTop: 10 }}>
        <pre ref={preRef} className="mgc-pre mgc-pre--code jh-dark"
          style={{ maxHeight: 360, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>
          {logs.length ? logs.join('\n') : (logError ? '' : 'No log lines.')}
        </pre>
      </div>
    </div>
  );
}
