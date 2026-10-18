// AgentGatewayLogPanel.jsx
//
// Raw container log window for the Real Agent Gateway: the Agent Gateway stdout
// (introspection, [P1AZ] REQUEST/RESPONSE/DECISION, token exchange), read by the
// BFF over the docker socket. Decisions live on the Agent Gateway Inspector.
//
// Backend: GET /api/admin/agent-gateway/logs?tail=&filter=
//
// Reuses McpGatewayConfig.css (mgc-*) for styling.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../services/apiClient';
// Its only former host (McpGatewayConfig) is no longer routed, so the panel
// brings its own mgc-* styles to wherever it is mounted.
import './McpGatewayConfig.css';

const TAIL_OPTIONS = [100, 200, 500, 1000];
const REFRESH_MS = 4000;

export default function AgentGatewayLogPanel() {
  const [logs, setLogs] = useState([]);
  const [logError, setLogError] = useState(null);
  const [filter, setFilter] = useState('');
  const [tail, setTail] = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const preRef = useRef(null);
  // Monotonic request ids so an older, slower fetch (a previous filter, or a
  // stale autoRefresh tick) can't overwrite a newer one that resolved first.
  const logsReqIdRef = useRef(0);

  const fetchLogs = useCallback(async () => {
    const reqId = ++logsReqIdRef.current;
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/admin/agent-gateway/logs', {
        params: { tail, filter: filter.trim() || undefined },
      });
      if (reqId !== logsReqIdRef.current) return;
      if (data.ok) {
        setLogs(data.lines || []);
        setLogError(null);
      } else {
        setLogs([]);
        setLogError(data.error || 'Could not read gateway logs.');
      }
    } catch (e) {
      if (reqId !== logsReqIdRef.current) return;
      setLogError(e?.response?.status === 403
        ? 'Admin access required to read gateway logs.'
        : 'Failed to reach the log endpoint.');
    } finally {
      if (reqId === logsReqIdRef.current) setLoading(false);
    }
  }, [tail, filter]);

  const refresh = fetchLogs;

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
      <details className="insp-card insp-log">
        <summary><strong>Gateway log</strong> · Last {tail} lines. Tokens are redacted.</summary>
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
      </details>
    </div>
  );
}
