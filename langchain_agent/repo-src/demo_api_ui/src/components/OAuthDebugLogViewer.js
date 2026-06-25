// banking_api_ui/src/components/OAuthDebugLogViewer.js
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { notifyError, notifySuccess } from '../utils/appToast';
import AdminSubPageShell from './AdminSubPageShell';
import PageNav from './PageNav';

/**
 * Admin-only viewer for OAuth verbose log lines (file / KV / memory on the API server).
 */
export default function OAuthDebugLogViewer({ user, onLogout }) {
  const dashboardPath = user?.role === 'admin' ? '/admin' : '/dashboard';
  const [lines, setLines] = useState([]);
  const [backend, setBackend] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchLog = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/admin/oauth-debug-log?limit=300');
      setLines(data.lines || []);
      setBackend(data.backend || '');
      setHint(data.hint || '');
    } catch (e) {
      notifyError(e.response?.data?.message || e.message || 'Failed to load log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(fetchLog, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchLog]);

  const handleClear = async () => {
    if (!window.confirm('Clear all stored OAuth verbose log lines on the server?')) return;
    try {
      await apiClient.delete('/api/admin/oauth-debug-log');
      notifySuccess('Log cleared.');
      fetchLog();
    } catch (e) {
      notifyError(e.response?.data?.message || e.message);
    }
  };

  return (
    <AdminSubPageShell
      title="OAuth debug log"
      lead={(
        <>
          Lines appear when <strong>Debug OAuth logging</strong> is <strong>On</strong> in{' '}
          <Link to="/config">Configuration</Link> and the API processes OAuth traffic. Storage:{' '}
          <code style={{ fontSize: '0.8rem' }}>{backend || '—'}</code>
        </>
      )}
    >
      <PageNav user={user} onLogout={onLogout} title="OAuth Debug Log" />
      <div className="app-page-toolbar app-page-toolbar--start" style={{ flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <Link to={dashboardPath} className="app-page-toolbar-btn app-page-toolbar-btn--accent">
          ← Dashboard
        </Link>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#475569' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh 5s
        </label>
        <button type="button" className="btn btn-primary" onClick={() => fetchLog()}>
          Refresh
        </button>
        <button type="button" className="btn btn-danger" onClick={handleClear}>
          Clear log
        </button>
      </div>
      <div className="alert alert-info" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
        Verbose mode can include token claims (e.g. subject, email). Only use for troubleshooting; restrict admin access.
        {hint ? <> {hint}</> : null}
      </div>
      {loading ? (
        <p style={{ color: '#374151' }}>Loading…</p>
      ) : (
        <pre
          style={{
            background: '#0f172a',
            color: '#e2e8f0',
            padding: '1rem',
            borderRadius: '8px',
            overflow: 'auto',
            maxHeight: '70vh',
            fontSize: '0.75rem',
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {lines.length
            ? lines.join('\n')
            : '(No lines yet — turn on verbose logging in Config, save, then sign in or call an API so the server emits debug lines.)'}
        </pre>
      )}
    </AdminSubPageShell>
  );
}
