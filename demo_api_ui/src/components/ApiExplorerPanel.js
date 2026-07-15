// banking_api_ui/src/components/ApiExplorerPanel.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import JsonHighlight from './shared/JsonHighlight';
import './ApiExplorerPanel.css';

const POLL_MS = 30000;

function methodCls(m) { return `aep-method aep-method--${(m || 'GET').toUpperCase()}`; }
function statusCls(s) { return `aep-status ${s >= 200 && s < 300 ? 'aep-status--ok' : 'aep-status--err'}`; }

function CallRow({ call, isSelected, onClick }) {
  const status = call.response?.status;
  const isErr = !call.success;
  return (
    <div
      className={`aep-call-row${isSelected ? ' aep-call-row--selected' : ''}${isErr ? ' aep-call-row--err' : ''}`}
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <div className="aep-call-meta">
        <span className={methodCls(call.method)}>{call.method}</span>
        {status != null && <span className={statusCls(status)}>{status}</span>}
        {(call.durationMs ?? call.duration) != null && <span className="aep-dur">{call.durationMs ?? call.duration}ms</span>}
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#374151' }}>{isSelected ? '◀' : '▶'}</span>
      </div>
      <div className="aep-url" title={call.url}>{call.url}</div>
    </div>
  );
}

function DetailPanel({ call, onClose }) {
  const [tab, setTab] = useState('response');

  if (!call) return (
    <div className="aep-detail aep-detail--empty">
      <div style={{ fontSize: '2rem', marginBottom: '10px' }}>→</div>
      <div>Click any call on the left to inspect its response &amp; request</div>
    </div>
  );

  const status = call.response?.status;
  const tabs = [
    { id: 'response', label: 'Response Body' },
    { id: 'request',  label: 'Request Body' },
    { id: 'headers',  label: 'Headers' },
  ];

  return (
    <div className="aep-detail">
      <div className="aep-detail-header">
        <span className={methodCls(call.method)}>{call.method}</span>
        {status != null && <span className={statusCls(status)}>{status}</span>}
        {call.durationMs != null && <span style={{ fontSize: '0.72rem', color: '#374151' }}>{call.durationMs}ms</span>}
        <button type="button" className="aep-close-btn" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="aep-url-full" title={call.url}>{call.url}</div>

      <div className="aep-detail-tabs">
        {tabs.map(t => (
          <button key={t.id} type="button"
            className={`aep-detail-tab${tab === t.id ? ' aep-detail-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <div className="aep-detail-body">
        {tab === 'response' && (
          call.response?.body
            ? <pre className="aep-json jh-dark"><JsonHighlight value={call.response.body} /></pre>
            : <pre className="aep-json aep-json--none">No response body captured</pre>
        )}
        {tab === 'request' && (
          call.request?.body
            ? <pre className="aep-json jh-dark"><JsonHighlight value={call.request.body} /></pre>
            : <pre className="aep-json aep-json--none">No request body</pre>
        )}
        {tab === 'headers' && (
          call.request?.headers && Object.keys(call.request.headers).length > 0
            ? <pre className="aep-json jh-dark"><JsonHighlight value={call.request.headers} /></pre>
            : <pre className="aep-json aep-json--none">No headers captured</pre>
        )}
      </div>
    </div>
  );
}

export default function ApiExplorerPanel() {
  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  const fetchCalls = useCallback(async () => {
    if (!liveRef.current) return;
    try {
      // Shared global buffer — includes agent/Bearer calls that lack a browser session cookie
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

  const reversed = [...calls].reverse();

  return (
    <div className="aep-root">
      <div className="aep-toolbar">
        <span className="aep-title">API Explorer</span>
        <span className="aep-count">{calls.length} calls</span>
        {error && <span style={{ fontSize: '0.78rem', color: '#991b1b' }}>⚠️ {error}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="aep-btn" onClick={() => setLive(v => !v)}>{live ? 'Pause' : 'Live'}</button>
          <button className="aep-btn" onClick={() => {
            fetch('/api/api-calls', { method: 'DELETE', credentials: 'include' })
              .then(() => { setCalls([]); setSelected(null); });
          }}>Clear</button>
        </div>
      </div>

      {stats && (
        <div className="aep-stats-row">
          <div className="aep-stat"><span>Total:</span><strong>{stats.total}</strong></div>
          <div className="aep-stat"><span>Success:</span><strong style={{ color: '#15803d' }}>{stats.success ?? stats.successful}</strong></div>
          <div className="aep-stat"><span>Errors:</span><strong style={{ color: (stats.errors ?? stats.failed) > 0 ? '#991b1b' : '#64748b' }}>{stats.errors ?? stats.failed}</strong></div>
          {(stats.avgDurationMs ?? stats.averageDuration) != null && (
            <div className="aep-stat"><span>Avg:</span><strong>{Math.round(stats.avgDurationMs ?? stats.averageDuration)}ms</strong></div>
          )}
        </div>
      )}

      <div className="aep-body">
        <div className="aep-list">
          {reversed.length === 0 ? (
            <div className="aep-list-empty">No API calls yet.<br />Use the AI agent or test pages to generate calls.</div>
          ) : reversed.map(call => (
            <CallRow
              key={call.id}
              call={call}
              isSelected={selected?.id === call.id}
              onClick={() => setSelected(prev => prev?.id === call.id ? null : call)}
            />
          ))}
        </div>
        <DetailPanel call={selected} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}
