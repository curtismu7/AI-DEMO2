// demo_api_ui/src/components/ApiExplorerPanel.js
// Redesign: Dark IDE three-column layout (Mock B)
import React, { useState, useEffect, useRef, useCallback } from 'react';
import JsonHighlight from './shared/JsonHighlight';
import './PingOneMcpInspector.css';
import './ApiExplorerPanel.css';

const POLL_MS = 30000;

/** Color-coded method badge class */
const methodBadgeClass = (m) => {
  const method = (m || 'GET').toUpperCase();
  return `aep-method-badge aep-method-badge--${method}`;
};

/** Status dot class for call success/failure */
const statusDotClass = (call) => {
  if (!call.success) return 'p1mcp-tree-item__dot p1mcp-tree-item__dot--sensitive';
  return 'p1mcp-tree-item__dot';
};

/** Truncate a URL for tree display */
const truncateUrl = (url, maxLen = 28) => {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + '\u2026';
};

export default function ApiExplorerPanel() {
  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState(null);
  const [outputTab, setOutputTab] = useState('response');
  const [search, setSearch] = useState('');
  const liveRef = useRef(live);
  liveRef.current = live;

  const fetchCalls = useCallback(async () => {
    if (!liveRef.current) return;
    try {
      const res = await fetch('/api/api-calls?limit=100', { credentials: 'include' });
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      const data = await res.json();
      setCalls(data.calls || []);
      setStats(data.stats || null);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchCalls();
    const id = setInterval(fetchCalls, POLL_MS);
    return () => clearInterval(id);
  }, [fetchCalls]);

  const handleClear = () => {
    fetch('/api/api-calls', { method: 'DELETE', credentials: 'include' })
      .then(() => { setCalls([]); setSelected(null); setStats(null); });
  };

  const reversed = [...calls].reverse();

  // Filter calls by search
  const filteredCalls = search.trim()
    ? reversed.filter(c =>
        (c.url || '').toLowerCase().includes(search.trim().toLowerCase()) ||
        (c.method || '').toLowerCase().includes(search.trim().toLowerCase())
      )
    : reversed;

  const selectedCall = selected;
  const status = selectedCall?.response?.status;
  const duration = selectedCall?.durationMs ?? selectedCall?.duration;

  return (
    <div className="p1mcp-page">
      {/* Top bar */}
      <div className="p1mcp-topbar">
        <span className={`p1mcp-topbar__dot ${live ? '' : 'p1mcp-topbar__dot--off'}`} />
        <h1>API Explorer</h1>
        <span className="p1mcp-topbar__status">
          {calls.length} calls {live ? '- Live' : '- Paused'}
        </span>
        {error && <span className="aep-topbar-error">{error}</span>}
        <div className="p1mcp-topbar__right">
          <button
            className={`p1mcp-topbar__btn ${live ? 'p1mcp-topbar__btn--active' : ''}`}
            onClick={() => setLive(v => !v)}
          >
            {live ? 'Pause' : 'Live'}
          </button>
          <button className="p1mcp-topbar__btn" onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>

      {/* Three-column grid */}
      <div className="p1mcp-grid">
        {/* Column 1: Call list (tree) */}
        <div className="p1mcp-col-tree">
          <div className="p1mcp-tree-header">
            <span>Calls ({calls.length})</span>
            {stats && (
              <span className="aep-stats-compact">
                {stats.success ?? stats.successful}ok / {stats.errors ?? stats.failed}err
              </span>
            )}
          </div>
          <div className="p1mcp-tree-search">
            <input
              type="search"
              placeholder="Filter calls..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="p1mcp-tree-body">
            {filteredCalls.length === 0 ? (
              <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
                {calls.length === 0
                  ? 'No API calls yet. Use the AI agent or test pages to generate calls.'
                  : `No calls match "${search}".`}
              </div>
            ) : filteredCalls.map(call => (
              <div
                key={call.id}
                className={`p1mcp-tree-item ${selected?.id === call.id ? 'p1mcp-tree-item--active' : ''}`}
                onClick={() => {
                  setSelected(prev => prev?.id === call.id ? null : call);
                  setOutputTab('response');
                }}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setSelected(prev => prev?.id === call.id ? null : call)}
              >
                <span className={statusDotClass(call)} />
                <span className={methodBadgeClass(call.method)}>{(call.method || 'GET').toUpperCase()}</span>
                <span className="aep-tree-url">{truncateUrl(call.url)}</span>
                {call.response?.status != null && (
                  <span className={`aep-tree-status ${call.response.status >= 200 && call.response.status < 300 ? 'aep-tree-status--ok' : 'aep-tree-status--err'}`}>
                    {call.response.status}
                  </span>
                )}
                {(call.durationMs ?? call.duration) != null && (
                  <span className="aep-tree-dur">{call.durationMs ?? call.duration}ms</span>
                )}
              </div>
            ))}
          </div>
          {/* Stats footer */}
          {stats && (
            <div className="aep-tree-footer">
              <div className="aep-tree-footer__stat">Total: <strong>{stats.total}</strong></div>
              <div className="aep-tree-footer__stat">Success: <strong className="aep-tree-footer__ok">{stats.success ?? stats.successful}</strong></div>
              <div className="aep-tree-footer__stat">Errors: <strong className="aep-tree-footer__err">{stats.errors ?? stats.failed}</strong></div>
              {(stats.avgDurationMs ?? stats.averageDuration) != null && (
                <div className="aep-tree-footer__stat">Avg: <strong>{Math.round(stats.avgDurationMs ?? stats.averageDuration)}ms</strong></div>
              )}
            </div>
          )}
        </div>

        {/* Column 2: Call metadata (form-like detail) */}
        <div className="p1mcp-col-form">
          {selectedCall ? (
            <>
              <div className="p1mcp-form-header">
                <div className="p1mcp-form-header__name">{(selectedCall.method || 'GET').toUpperCase()} Request</div>
                <div className="p1mcp-form-header__desc">Inspect the selected API call details</div>
              </div>
              <div className="p1mcp-form-body">
                <div className="p1mcp-field">
                  <label>URL</label>
                  <input type="text" value={selectedCall.url || ''} readOnly />
                </div>
                <div className="p1mcp-field">
                  <label>Method</label>
                  <input type="text" value={(selectedCall.method || 'GET').toUpperCase()} readOnly />
                </div>
                <div className="p1mcp-field">
                  <label>Status Code</label>
                  <input type="text" value={status != null ? String(status) : 'N/A'} readOnly />
                </div>
                <div className="p1mcp-field">
                  <label>Duration</label>
                  <input type="text" value={duration != null ? `${duration}ms` : 'N/A'} readOnly />
                </div>
                {selectedCall.request?.body && (
                  <div className="p1mcp-field">
                    <label>Request Body</label>
                    <textarea
                      rows={6}
                      readOnly
                      value={typeof selectedCall.request.body === 'string'
                        ? selectedCall.request.body
                        : JSON.stringify(selectedCall.request.body, null, 2)}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p1mcp-form-empty">
              Select an API call from the list to inspect its details.
            </div>
          )}
        </div>

        {/* Column 3: Output (tabbed) */}
        <div className="p1mcp-col-output">
          <div className="p1mcp-output-tabs">
            <button
              className={`p1mcp-output-tab ${outputTab === 'response' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('response')}
            >Response Body</button>
            <button
              className={`p1mcp-output-tab ${outputTab === 'request' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('request')}
            >Request Body</button>
            <button
              className={`p1mcp-output-tab ${outputTab === 'headers' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('headers')}
            >Headers</button>
          </div>
          {selectedCall ? (
            <>
              <div className="p1mcp-output-body">
                <pre className="p1mcp-output-code">
                  {outputTab === 'response' && (
                    selectedCall.response?.body
                      ? <JsonHighlight value={selectedCall.response.body} />
                      : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No response body captured</span>
                  )}
                  {outputTab === 'request' && (
                    selectedCall.request?.body
                      ? <JsonHighlight value={selectedCall.request.body} />
                      : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No request body</span>
                  )}
                  {outputTab === 'headers' && (
                    selectedCall.request?.headers && Object.keys(selectedCall.request.headers).length > 0
                      ? <JsonHighlight value={selectedCall.request.headers} />
                      : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No headers captured</span>
                  )}
                </pre>
              </div>
              <div className="p1mcp-output-footer">
                <span><strong>Status:</strong> {status != null ? status : 'N/A'}</span>
                <span><strong>Duration:</strong> {duration != null ? `${duration}ms` : 'N/A'}</span>
                <span><strong>Transport:</strong> HTTP</span>
              </div>
            </>
          ) : (
            <div className="p1mcp-output-empty">
              Select an API call to view its response, request body, and headers.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
