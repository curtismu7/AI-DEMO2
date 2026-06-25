/**
 * LogViewer Component
 * Displays application and Vercel logs in a real-time table with filtering
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { toastLogStore } from '../services/toastLogStore';
import { notifyError } from '../utils/appToast';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import './LogViewer.css';

/** Stable React key + dedup across sources (id from server when present). */
function stableLogKey(log) {
  if (log.id != null && log.id !== '') return `id:${log.id}`;
  const src = log._src || '';
  const ts = log.timestamp || '';
  const lv = log.level || '';
  const msg =
    typeof log.message === 'object' ? JSON.stringify(log.message) : String(log.message || '');
  return `h:${src}|${ts}|${lv}|${msg.slice(0, 240)}`;
}

function stableTimeCompare(a, b) {
  const ta = new Date(a.timestamp).getTime();
  const tb = new Date(b.timestamp).getTime();
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return stableLogKey(a).localeCompare(stableLogKey(b));
}

/** Merge API snapshot into rolling history: dedupe by stable key, keep first-seen row (stable label/source), chronological, cap length. */
function mergeLogHistory(prev, incoming, maxRows = 2500) {
  const byKey = new Map();
  for (const row of prev) {
    byKey.set(stableLogKey(row), row);
  }
  for (const row of incoming) {
    const k = stableLogKey(row);
    if (!byKey.has(k)) byKey.set(k, row);
  }
  const merged = Array.from(byKey.values()).sort(stableTimeCompare);
  if (merged.length <= maxRows) return merged;
  return merged.slice(merged.length - maxRows);
}

const LogViewer = ({ isOpen, onClose, standalone = false, categoryFilter = '' }) => {
  const [logs, setLogs] = useState([]);
  const [toastLogs, setToastLogs] = useState(() => toastLogStore.getAll() || []);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState({
    level: '',
    search: '',
    source: 'all', // all, console, app, vercel
    category: '', // '' | 'runtime messages' | 'toast messages'
  });
  const [stats, setStats] = useState(null);
  const logContainerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [selfOpen, setSelfOpen] = useState(false);
  const replaceLogsOnNextFetchRef = useRef(true);
  const isRuntimeMessageLog = (log) =>
    log?.category === 'runtime messages' ||
    (typeof log?.message === 'string' && log.message.toLowerCase().includes('"category":"runtime messages"'));
  const isToastMessageLog = (log) => log?.category === 'toast messages';
  const runtimeMessagesCount = logs.reduce((count, log) => (isRuntimeMessageLog(log) ? count + 1 : count), 0);

  useEffect(() => {
    return toastLogStore.subscribe((next) => {
      setToastLogs(Array.isArray(next) ? next : []);
    });
  }, []);

  useEffect(() => {
    replaceLogsOnNextFetchRef.current = true;
  }, [filter.source, filter.level, filter.search, filter.category]);

  const fetchLogs = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    try {
      if (filter.category === 'toast messages') {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);

      const params = {
        limit: 500,
        ...(filter.level && { level: filter.level }),
        ...(filter.search && { search: filter.search })
      };

      const matchesCategory = (log) => {
        if (filter.category !== 'runtime messages') return true;
        return isRuntimeMessageLog(log);
      };

      const applyMerged = (incomingRows) => {
        const shouldReplace = replaceLogsOnNextFetchRef.current;
        if (shouldReplace) replaceLogsOnNextFetchRef.current = false;
        setLogs((prev) => mergeLogHistory(shouldReplace ? [] : prev, incomingRows, 2500));
      };

      if (filter.source === 'all') {
        const sources = ['console', 'app', 'vercel', 'exchange'];
        const results = await Promise.allSettled(
          sources.map(src => axios.get(`/api/logs/${src}`, { params }))
        );
        const allRejected =
          results.length > 0 && results.every((r) => r.status === 'rejected');
        if (allRejected) {
          const rej = results.find((r) => r.status === 'rejected');
          const reason = rej?.reason;
          const msg =
            reason instanceof Error ? reason.message : String(reason || 'Network error');
          notifyError(msg);
          replaceLogsOnNextFetchRef.current = true;
          setLogs([]);
        } else {
          const merged = results
            .flatMap((r, i) =>
              r.status === 'fulfilled'
                ? (r.value.data.logs || []).map((l) => ({ ...l, _src: sources[i] }))
                : []
            )
            .filter(matchesCategory);
          applyMerged(merged);
        }
      } else {
        const response = await axios.get(`/api/logs/${filter.source}`, { params });
        const filtered = (response.data.logs || [])
          .map(l => ({ ...l, _src: filter.source }))
          .filter(matchesCategory);
        applyMerged(filtered);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
      notifyError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter]);

  /**
   * Apply search/level to in-memory toast logs (client-only).
   */
  const buildToastDisplayLogs = useCallback(() => {
    let list = [...toastLogs];
    if (filter.level) {
      list = list.filter(l => (l.level || '').toLowerCase() === filter.level.toLowerCase());
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        l =>
          (l.message || '').toLowerCase().includes(q) ||
          (l.detail || '').toLowerCase().includes(q) ||
          (l.toastType || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }, [toastLogs, filter.level, filter.search]);

  useEffect(() => {
    if (filter.category !== 'toast messages') return;
    setLogs(buildToastDisplayLogs());
  }, [filter.category, buildToastDisplayLogs]);

  const fetchStats = useCallback(async () => {
    if (filter.category === 'toast messages') {
      setStats(null);
      return;
    }
    try {
      const response = await axios.get('/api/logs/stats');
      setStats(response.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, [filter.category]);

  // In float mode (non-standalone), manage open state internally via custom events.
  // In standalone mode, use the isOpen prop passed by the parent.
  const openState = standalone ? isOpen : selfOpen;

  // Listen for 'banking-log-viewer-open' event to open as floating panel.
  useEffect(() => {
    if (standalone) return;
    const handler = () => setSelfOpen(true);
    window.addEventListener('banking-log-viewer-open', handler);
    return () => window.removeEventListener('banking-log-viewer-open', handler);
  }, [standalone]);

  // Escape key closes floating panel.
  useEffect(() => {
    if (standalone || !openState) return;
    const onKey = (e) => { if (e.key === 'Escape') { setSelfOpen(false); if (onClose) onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [standalone, openState, onClose]);

  // Draggable + resizable panel position (defaults to bottom-left, matching prior CSS).
  // eslint-disable-next-line no-unused-vars
  const { pos, size, handleDragStart, handleResizeStart: _handleResizeStart, createResizeHandler } = useDraggablePanel(
    () => ({
      x: Math.max(16, window.innerWidth - Math.min(1400, Math.round(window.innerWidth * 0.92)) - 16),
      y: Math.max(16, window.innerHeight - Math.round(window.innerHeight * 0.70) - 16),
    }),
    { w: Math.min(1400, Math.round(window.innerWidth * 0.92)), h: Math.round(window.innerHeight * 0.70) },
    { storageKey: 'log-viewer-panel', minW: 640, minH: 300 }
  );

  useEffect(() => {
    if (openState) {
      fetchLogs({ silent: false });
      fetchStats();
    }
  }, [openState, fetchLogs, fetchStats]);

  useEffect(() => {
    if (!openState || !autoRefresh) return;
    if (filter.category === 'toast messages') return;

    const interval = setInterval(() => {
      fetchLogs({ silent: true });
      fetchStats();
    }, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [openState, autoRefresh, fetchLogs, fetchStats, filter.category]);

  useEffect(() => {
    if (!autoScroll || !logContainerRef.current) return;
    const el = logContainerRef.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
  }, [logs, autoScroll]);

  // eslint-disable-next-line no-unused-vars -- available for caller use
  const clearLogs = async () => {
    if (filter.category === 'toast messages') {
      if (!window.confirm('Clear all recorded toast messages from this browser session?')) return;
      toastLogStore.clear();
      replaceLogsOnNextFetchRef.current = true;
      setLogs([]);
      return;
    }
    if (!window.confirm('Clear all console logs?')) return;

    try {
      await axios.delete('/api/logs/console');
      replaceLogsOnNextFetchRef.current = true;
      setLogs([]);
      fetchStats();
    } catch (err) {
      console.error('Error clearing logs:', err);
      notifyError(err.message);
    }
  };

  // eslint-disable-next-line no-unused-vars -- kept for keyboard shortcut use
  const downloadLogs = () => {
    const content = logs.map(log => JSON.stringify(log)).join('\n');
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLevelColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'error': return '#ef4444';
      case 'warn': return '#f59e0b';
      case 'info': return 'var(--brand-navy)';
      case 'debug': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  if (!standalone && !openState) return null;

  const inner = (
    <div className={standalone ? 'log-viewer-standalone' : 'log-viewer-float__body'}>
        <div className="log-viewer-header" onPointerDown={!standalone ? handleDragStart : undefined}>
          <h2>📊 Log Viewer</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {!standalone && (
              <button
                className="close-button"
                title="Open in new window"
                onClick={() => window.open('/logs', 'BankingLogs', 'width=1400,height=900,scrollbars=yes,resizable=yes')}
                style={{ fontSize: '16px', padding: '4px 10px' }}
              >
                ⊞
              </button>
            )}
            {!standalone && <button className="close-button" onClick={() => { setSelfOpen(false); if (onClose) onClose(); }}>✕</button>}
          </div>
        </div>

        <div className="log-viewer-controls">
          <div className="control-group runtime-chip-group">
            <button
              type="button"
              className={`runtime-chip ${filter.category === 'runtime messages' ? 'active' : ''}`}
              onClick={() =>
                setFilter((prev) => ({
                  ...prev,
                  category: prev.category === 'runtime messages' ? '' : 'runtime messages',
                }))
              }
              title="One-click filter for toast/runtime notifications"
            >
              Runtime messages
              <span className="runtime-chip-count">{runtimeMessagesCount}</span>
            </button>
            <button
              type="button"
              className={`runtime-chip ${filter.category === 'toast messages' ? 'active' : ''}`}
              onClick={() =>
                setFilter((prev) => ({
                  ...prev,
                  category: prev.category === 'toast messages' ? '' : 'toast messages',
                }))
              }
              title="In-app toasts (with optional details) — persists after the toast dismisses"
            >
              Toast messages
              <span className="runtime-chip-count">{(toastLogs || []).length}</span>
            </button>
          </div>
          {filter.category === 'toast messages' && (
            <div className="log-viewer-hint" role="status">
              Client session only — search matches message and details. Toasts stay on screen ~22s; history remains here.
            </div>
          )}
          <div className="control-group">
            <label>Source:</label>
            <select 
              value={filter.source} 
              onChange={(e) => setFilter({ ...filter, source: e.target.value })}
              disabled={filter.category === 'toast messages'}
            >
              <option value="all">All Sources</option>
              <option value="console">Console Logs</option>
              <option value="app">Application Logs</option>
              <option value="vercel">Vercel Logs</option>
              <option value="exchange">Exchange Audit</option>
            </select>
          </div>

          <div className="control-group">
            <label>Level:</label>
            <select 
              value={filter.level} 
              onChange={(e) => setFilter({ ...filter, level: e.target.value })}
            >
              <option value="">All</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>

          <div className="control-group search-group">
            <label>Search:</label>
            <input
              type="text"
              placeholder="Filter logs..."
              value={filter.search}
              onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            />
          </div>

          <div className="control-group">
            <label>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
          </div>

          <div className="control-group">
            <label>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
          </div>

        </div>

        {stats && (
          <div className="log-stats">
            <span>Total: {stats.total}</span>
            <span style={{ color: '#ef4444' }}>Errors: {stats.byLevel?.error || 0}</span>
            <span style={{ color: '#f59e0b' }}>Warnings: {stats.byLevel?.warn || 0}</span>
            <span style={{ color: 'var(--brand-navy)' }}>Info: {stats.byLevel?.info || 0}</span>
          </div>
        )}

        <div className="log-table-container" ref={logContainerRef}>
          <table className="log-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Time</th>
                <th style={{ width: '80px' }}>Level</th>
                <th style={{ width: '70px' }}>Source</th>
                <th>Message</th>
                <th style={{ minWidth: '140px' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const activeCats = categoryFilter ? categoryFilter.split(',').map(s => s.trim()).filter(Boolean) : [];
                const displayedLogs = activeCats.length === 0 ? logs : logs.filter(log => {
                  const msg = typeof log.message === 'string' ? log.message : JSON.stringify(log.message || '');
                  return activeCats.some(cat => msg.startsWith(`[${cat}]`));
                });
                return loading && displayedLogs.length === 0 && filter.category !== 'toast messages' ? (
                <tr>
                  <td colSpan="5" className="loading-cell">Loading logs...</td>
                </tr>
              ) : displayedLogs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty-cell">No logs found</td>
                </tr>
              ) : (
                displayedLogs.map((log) => (
                  <tr key={stableLogKey(log)} className={`log-row log-${log.level}`}>
                    <td className="log-time">{formatTimestamp(log.timestamp)}</td>
                    <td className="log-level">
                      <span 
                        className="level-badge" 
                        style={{ backgroundColor: getLevelColor(log.level) }}
                      >
                        {log.level?.toUpperCase() || 'INFO'}
                      </span>
                    </td>
                    <td className="log-source" style={{ fontSize: '0.7rem', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{log._src || '—'}</td>
                    <td className="log-message">
                      {isToastMessageLog(log) && log.toastType && (
                        <span className="log-toast-type" title="react-toastify type">
                          [{String(log.toastType)}]{' '}
                        </span>
                      )}
                      {typeof log.message === 'object' 
                        ? JSON.stringify(log.message, null, 2)
                        : log.message}
                      {log.correlationId && (
                        <span className="correlation-id">
                          🔗 {log.correlationId}
                        </span>
                      )}
                    </td>
                    <td className="log-details-cell">
                      {log.detail ? (
                        <pre className="log-details-pre">{log.detail}</pre>
                      ) : (
                        <span className="log-details-empty">—</span>
                      )}
                    </td>
                  </tr>
                ))
              );
              })()}
            </tbody>
          </table>
        </div>

        <div className="log-viewer-footer">
          <span>{logs.length} logs displayed</span>
          {autoRefresh && <span className="refresh-indicator">● Live</span>}
        </div>
      </div>
  );

  if (standalone) return inner;

  return createPortal(
    <div
      className="log-viewer-float"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      role="dialog"
      aria-modal="false"
      aria-label="Log Viewer"
    >
      {inner}
      
      {/* 8-direction resize handles */}
      <div className="drp-resize-handles">
        {/* Corner handles */}
        <div className="drp-resize-handle drp-resize-handle--nw" onMouseDown={createResizeHandler('nw')} aria-hidden title="Resize from top-left" />
        <div className="drp-resize-handle drp-resize-handle--ne" onMouseDown={createResizeHandler('ne')} aria-hidden title="Resize from top-right" />
        <div className="drp-resize-handle drp-resize-handle--sw" onMouseDown={createResizeHandler('sw')} aria-hidden title="Resize from bottom-left" />
        <div className="drp-resize-handle drp-resize-handle--se" onMouseDown={createResizeHandler('se')} aria-hidden title="Resize from bottom-right" />
        
        {/* Edge handles */}
        <div className="drp-resize-handle drp-resize-handle--n" onMouseDown={createResizeHandler('n')} aria-hidden title="Resize from top" />
        <div className="drp-resize-handle drp-resize-handle--s" onMouseDown={createResizeHandler('s')} aria-hidden title="Resize from bottom" />
        <div className="drp-resize-handle drp-resize-handle--e" onMouseDown={createResizeHandler('e')} aria-hidden title="Resize from right" />
        <div className="drp-resize-handle drp-resize-handle--w" onMouseDown={createResizeHandler('w')} aria-hidden title="Resize from left" />
      </div>
    </div>,
    document.body
  );
};

export default LogViewer;
