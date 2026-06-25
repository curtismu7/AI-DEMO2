/**
 * AdminErrorAuditLog
 * Admin panel component showing error audit trail
 * Pulls from the BFF /api/app-events endpoint (server-side event log).
 */

import React, { useState, useEffect, useCallback } from 'react';
import JsonHighlight from './shared/JsonHighlight';
import './AdminErrorAuditLog.css';

const SEVERITY_MAP = {
  error: 'critical',
  warning: 'warning',
  warn: 'warning',
  info: 'info',
};

function toFilterSeverity(s) {
  return SEVERITY_MAP[s] || 'info';
}

export default function AdminErrorAuditLog() {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const loadAuditLog = useCallback(async () => {
    try {
      const res = await fetch('/api/app-events?limit=500', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // newest first
      setEntries((data.events || []).slice().reverse());
      setFetchError(null);
    } catch (err) {
      setFetchError(err.message);
    }
  }, []);

  useEffect(() => { loadAuditLog(); }, [loadAuditLog]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadAuditLog, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, loadAuditLog]);

  const countFor = (f) => entries.filter(e =>
    f === 'all' || toFilterSeverity(e.severity) === f
  ).length;

  const filtered = entries.filter(e =>
    filter === 'all' || toFilterSeverity(e.severity) === filter
  );

  const handleRefresh = () => loadAuditLog();

  return (
    <div className="error-audit-log">
      <div className="audit-header">
        <h2>Error Audit Log</h2>
        <div className="audit-controls">
          <label className="audit-auto-refresh">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (5s)
          </label>
          <button className="btn btn-secondary" onClick={handleRefresh} type="button">🔄 Refresh</button>
        </div>
      </div>

      {fetchError && <p style={{ color: '#991b1b', padding: '8px 16px' }}>⚠ {fetchError}</p>}

      {/* Filter buttons */}
      <div className="audit-filters">
        {['all', 'critical', 'warning', 'info'].map(f => (
          <button
            key={f}
            className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setFilter(f); setExpanded(null); }}
            type="button"
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}{' '}
            <span className="badge">{countFor(f)}</span>
          </button>
        ))}
      </div>

      {/* Event entries */}
      <div className="audit-entries">
        {filtered.length === 0 ? (
          <div className="audit-empty"><p>No events recorded.</p></div>
        ) : (
          filtered.map((entry, idx) => {
            const sev = toFilterSeverity(entry.severity);
            return (
              <div key={idx} className="audit-entry">
                <div
                  className="audit-entry__header"
                  onClick={() => setExpanded(expanded === idx ? null : idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(expanded === idx ? null : idx); }}
                >
                  <span className="audit-entry__timestamp">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`audit-entry__code audit-entry__code--${sev}`}>
                    {entry.category || entry.severity}
                  </span>
                  <span className="audit-entry__message">{entry.message}</span>
                  <span className="audit-entry__toggle" aria-hidden="true">{expanded === idx ? '▼' : '▶'}</span>
                </div>

                {expanded === idx && (
                  <div className="audit-entry__details">
                    {entry.tag && <div className="detail-row"><strong>Tag:</strong><p>{entry.tag}</p></div>}
                    {entry.flowId && <div className="detail-row"><strong>Flow ID:</strong><p>{entry.flowId}</p></div>}
                    {entry.username && <div className="detail-row"><strong>User:</strong><p>{entry.username}</p></div>}
                    {entry.metadata && (
                      <div className="detail-row">
                        <strong>Metadata:</strong>
                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.75rem', marginTop: 4 }}>
                          <JsonHighlight value={entry.metadata} />
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="audit-footer">
        <small>
          Showing {filtered.length} of {entries.length} events.
          {entries.length > 0 && ` Latest: ${new Date(entries[0].timestamp).toLocaleString()}`}
        </small>
      </div>
    </div>
  );
}
