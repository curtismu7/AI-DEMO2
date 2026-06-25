import React, { useState, useEffect, useCallback, useRef } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { toastAdminSessionError } from '../utils/dashboardToast';
import { navigateToAdminOAuthLogin } from '../utils/authUi';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import AdminSubPageShell from './AdminSubPageShell';
import PageNav from './PageNav';
import ApiCallDisplay from './ApiCallDisplay';
import { useAppEventsSSE } from '../hooks/useAppEventsSSE';

/* Category icons */
const CATEGORY_ICONS = {
  oauth: '\u{1F511}',
  token_exchange: '\u{1F504}',
  session: '\u{1F4BE}',
  jwks: '\u{1F6E1}\uFE0F',
  mcp: '\u{1F916}',
  auth_lifecycle: '\u{1F510}',
  authorize: '\u{1F6AA}',
  agent_prompt: '\u{1F9E0}',
  delegation: '\u{1F91D}',
  introspection: '\u{1F52C}',
  // Phase 266 \u2014 no emoji for gateway_path per REGRESSION_PLAN \u00A70
  gateway_path: null,
};

const CATEGORY_LABELS = {
  oauth: 'OAuth',
  token_exchange: 'Token Exchange',
  session: 'Session',
  jwks: 'JWKS',
  mcp: 'MCP',
  auth_lifecycle: 'Auth Lifecycle',
  authorize: 'Authorize Gate',
  agent_prompt: 'Agent Prompt',
  delegation: 'Delegation',
  introspection: 'Introspection',
  // Phase 266 \u2014 gateway credential-path routing label (plain text, no emoji)
  gateway_path: 'Gateway Path',
};

// Phase 266 \u2014 sub-labels for gateway path events, keyed by event tag
const GATEWAY_PATH_LABELS = {
  'gateway.path.bearer':    'OAUTH BEARER PATH',
  'gateway.path.apikey':    'API-KEY PATH',
  'gateway.path.dualtoken': 'ACCESS + ID-TOKEN PATH',
};

const SEVERITY_BORDER = {
  info: '#3b82f6',
  warning: '#f59e0b',
  error: '#ef4444',
};

const relativeTime = (iso) => {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); }
  catch (_e) { return iso; }
};

const groupByFlow = (events) => {
  const grouped = [];
  const flowMap = new Map();
  for (const evt of events) {
    if (evt.flowId) {
      if (!flowMap.has(evt.flowId)) {
        const group = { flowId: evt.flowId, events: [] };
        flowMap.set(evt.flowId, group);
        grouped.push(group);
      }
      flowMap.get(evt.flowId).events.push(evt);
    } else {
      grouped.push({ flowId: null, events: [evt] });
    }
  }
  return grouped;
};

const flowLabel = (events) => {
  const cats = [...new Set(events.map(e => e.category))];
  if (cats.includes('oauth') || cats.includes('auth_lifecycle')) return 'Login Flow';
  if (cats.includes('token_exchange')) return 'Token Exchange Flow';
  if (cats.includes('mcp')) return 'MCP Tool Flow';
  if (cats.includes('session')) return 'Session Flow';
  return 'Event Flow';
};

const ActivityLogs = ({ user, onLogout }) => {
  const { open } = useEducationUI();
  const [activeTab, setActiveTab] = useState('appEvents');
  const [appEvents, setAppEvents] = useState([]);
  const [appEventsLoading, setAppEventsLoading] = useState(false);
  const [eventCategories, setEventCategories] = useState({});
  const [eventFilter, setEventFilter] = useState({ category: '', severity: '' });
  const [expandedFlowIds, setExpandedFlowIds] = useState(new Set());
  const [expandedEventIds, setExpandedEventIds] = useState(new Set());
  const [expandedMetaKeys, setExpandedMetaKeys] = useState(new Set());
  const toggleMetaKey = (key) => {
    setExpandedMetaKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const pollRef = useRef(null);

  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({
    page: 1, limit: 50, username: '', action: '', startDate: '', endDate: ''
  });

  useEffect(() => { fetchLogs(); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.append(key, value); });
      const response = await apiClient.get(`/api/admin/activity?${params}`);
      setLogs(response.data.logs);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Activity logs error:', error);
      if (error.response?.status === 401) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
      } else if (error.response?.status === 403) {
        notifyError('You do not have permission to view activity logs.');
      } else {
        notifyError('Failed to load activity logs');
      }
    } finally { setLoading(false); }
  };

  const fetchAppEvents = useCallback(async () => {
    try {
      setAppEventsLoading(true);
      const params = new URLSearchParams();
      if (eventFilter.category) params.append('category', eventFilter.category);
      if (eventFilter.severity) params.append('severity', eventFilter.severity);
      params.append('limit', '200');
      const response = await apiClient.get(`/api/app-events?${params}`);
      setAppEvents(response.data.events || []);
      setEventCategories(response.data.categories || {});
    } catch (error) {
      console.error('App events fetch error:', error);
    } finally { setAppEventsLoading(false); }
  }, [eventFilter]);

  useEffect(() => {
    if (activeTab === 'appEvents') {
      fetchAppEvents();
    }
    const poll = pollRef.current;
    return () => { if (poll) clearInterval(poll); };
  }, [activeTab, fetchAppEvents]);

  // SSE: prepend new events in real-time while on the appEvents tab
  useAppEventsSSE(
    (event) => {
      const cat = eventFilter.category;
      const sev = eventFilter.severity;
      if (cat && event.category !== cat) return;
      if (sev && event.severity !== sev) return;
      setAppEvents(prev => [event, ...prev].slice(0, 200));
    },
    { enabled: activeTab === 'appEvents' },
  );

  const toggleFlow = (flowId) => {
    setExpandedFlowIds(prev => { const n = new Set(prev); n.has(flowId) ? n.delete(flowId) : n.add(flowId); return n; });
  };
  const toggleEvent = (eventId) => {
    setExpandedEventIds(prev => { const n = new Set(prev); n.has(eventId) ? n.delete(eventId) : n.add(eventId); return n; });
  };

  const handleFilterChange = (key, value) => { setFilters(prev => ({ ...prev, [key]: value, page: 1 })); };
  const handlePageChange = (page) => { setFilters(prev => ({ ...prev, page })); };

  const exportLogs = async () => {
    try {
      const response = await apiClient.get('/api/admin/activity/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `activity_logs_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) { console.error('Export error:', error); }
  };

  const clearOldLogs = async () => {
    if (window.confirm('Are you sure you want to clear logs older than 30 days?')) {
      try { await apiClient.delete('/api/admin/activity/clear?days=30'); fetchLogs(); }
      catch (error) { console.error('Clear logs error:', error); }
    }
  };

  const handleRowClick = (log) => { setSelectedLog(log); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setSelectedLog(null); };

  const copyAsCurl = () => {
    if (!selectedLog) return;
    const [method, endpoint] = selectedLog.endpoint.split(' ');
    let actualEndpoint = endpoint;
    if (endpoint === '/activity') actualEndpoint = '/admin/activity';
    else if (endpoint === '/login') actualEndpoint = '/auth/login';
    else if (endpoint === '/me') actualEndpoint = '/auth/me';
    else if (endpoint === '/register') actualEndpoint = '/auth/register';
    else if (endpoint === '/change-password') actualEndpoint = '/auth/change-password';
    else if (endpoint === '/transfer') actualEndpoint = '/transactions/transfer';
    else if (endpoint === '/balance') actualEndpoint = '/accounts/balance';
    else if (endpoint === '/') actualEndpoint = '/';
    const apiUrl = process.env.REACT_APP_API_URL || window.location.origin;
    const fullUrl = `${apiUrl}/api${actualEndpoint}`;
    let curlCommand = `curl -X ${method} "${fullUrl}"`;
    curlCommand += ` \\\n  -H "Content-Type: application/json"`;
    if (selectedLog.authorization) curlCommand += ` \\\n  -H "Authorization: ${selectedLog.authorization}"`;
    if (selectedLog.userAgent) curlCommand += ` \\\n  -H "User-Agent: ${selectedLog.userAgent}"`;
    if (selectedLog.requestBody && Object.keys(selectedLog.requestBody).length > 0) {
      const bodyJson = JSON.stringify(selectedLog.requestBody, null, 2);
      const escapedBody = bodyJson.replace(/'/g, "'\"'\"'");
      curlCommand += ` \\\n  -d '${escapedBody}'`;
    }
    navigator.clipboard.writeText(curlCommand).then(() => {
      const button = document.getElementById('copy-curl-btn');
      if (button) {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        button.style.backgroundColor = '#10b981';
        setTimeout(() => { button.textContent = originalText; button.style.backgroundColor = ''; }, 2000);
      }
    }).catch(err => { console.error('Failed to copy to clipboard:', err); notifyError('Copy failed.'); });
  };

  const renderAppEventsTab = () => {
    const groups = groupByFlow(appEvents);
    const totalEvents = Object.values(eventCategories).reduce((s, c) => s + c, 0);
    return (
      <>
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 className="card-title" style={{ margin: 0 }}>App Events</h2>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="filter-input" style={{ minWidth: '160px' }} value={eventFilter.category} onChange={(e) => setEventFilter(prev => ({ ...prev, category: e.target.value }))}>
                <option value="">All Categories</option>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{CATEGORY_ICONS[key]} {label} ({eventCategories[key] || 0})</option>
                ))}
              </select>
              <select className="filter-input" style={{ minWidth: '120px' }} value={eventFilter.severity} onChange={(e) => setEventFilter(prev => ({ ...prev, severity: e.target.value }))}>
                <option value="">All Severities</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
              <span style={{ color: '#374151', fontSize: '0.8rem' }}>
                {appEvents.length} shown / {totalEvents} total
                {appEventsLoading && ' \u00b7 refreshing\u2026'}
              </span>
            </div>
          </div>
        </div>
        {appEvents.length === 0 ? (
          <div className="card">
            <div className="empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>No app events yet</h3>
              <p style={{ color: '#374151' }}>Events appear when OAuth, token exchange, session, or JWKS activity occurs. Try logging in as a user.</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {groups.map((group, gi) => {
              if (group.flowId && group.events.length > 1) return renderFlowGroup(group, gi);
              return group.events.map((evt) => renderEventRow(evt, false));
            })}
          </div>
        )}
      </>
    );
  };

  const renderFlowGroup = (group, gi) => {
    const isExpanded = expandedFlowIds.has(group.flowId);
    const first = group.events[0];
    const last = group.events[group.events.length - 1];
    const label = flowLabel(group.events);
    const cats = [...new Set(group.events.map(e => e.category))];
    const icons = cats.map(c => CATEGORY_ICONS[c] || '\uD83D\uDCCC').join(' ');
    return (
      <div key={group.flowId || gi} className="card" style={{ marginBottom: '0.25rem', overflow: 'hidden' }}>
        <div onClick={() => toggleFlow(group.flowId)} style={{ padding: '0.6rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--card-bg, #f8fafc)', borderBottom: isExpanded ? '1px solid var(--border-color, #e2e8f0)' : 'none', userSelect: 'none' }}>
          <span style={{ transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>{'\u25B6'}</span>
          <span>{icons}</span>
          <strong style={{ fontSize: '0.85rem' }}>{label}</strong>
          <span style={{ color: '#374151', fontSize: '0.8rem', marginLeft: 'auto' }}>
            {group.events.length} events \u00b7 {relativeTime(first.timestamp)}
            {first.timestamp !== last.timestamp && (' \u2192 ' + relativeTime(last.timestamp))}
          </span>
        </div>
        {isExpanded && (
          <div style={{ paddingLeft: '1rem' }}>
            {group.events.map((evt) => renderEventRow(evt, true))}
          </div>
        )}
      </div>
    );
  };

  const renderEventRow = (evt, nested) => {
    const isExpanded = expandedEventIds.has(evt.id);
    const borderColor = SEVERITY_BORDER[evt.severity] || SEVERITY_BORDER.info;
    const icon = CATEGORY_ICONS[evt.category] || '\uD83D\uDCCC';
    return (
      <div key={evt.id} style={{ borderLeft: '3px solid ' + borderColor, padding: '0.5rem 0.75rem', backgroundColor: nested ? 'transparent' : 'var(--card-bg, #fff)', borderRadius: nested ? 0 : '0.25rem', marginBottom: nested ? 0 : '0.25rem' }}>
        <div onClick={() => toggleEvent(evt.id)} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}>
          <span style={{ flexShrink: 0 }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: '0.85rem' }}>{evt.message}</span>
            {evt.username && <span style={{ marginLeft: '0.5rem', color: '#374151', fontSize: '0.75rem' }}>({evt.username})</span>}
          </div>
          <span title={evt.timestamp} style={{ flexShrink: 0, color: '#374151', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{relativeTime(evt.timestamp)}</span>
          <span style={{ transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', fontSize: '0.7rem', color: '#374151' }}>{'\u25B6'}</span>
        </div>
        {isExpanded && (
          <div style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', fontSize: '0.8rem', color: '#374151' }}>
            <div style={{ marginBottom: '0.25rem' }}><strong>Time:</strong> {evt.timestamp}</div>
            <div style={{ marginBottom: '0.25rem' }}>
              <strong>Category:</strong> {CATEGORY_LABELS[evt.category] || evt.category}{' \u00b7 '}<strong>Severity:</strong>{' '}
              <span style={{ color: SEVERITY_BORDER[evt.severity] }}>{evt.severity}</span>
            </div>
            {evt.tag && (
              <div style={{ marginBottom: '0.25rem' }}>
                <strong>Tag:</strong>{' '}<code style={{ backgroundColor: 'var(--code-bg, #f1f5f9)', padding: '0.1rem 0.3rem', borderRadius: '0.2rem', fontSize: '0.75rem' }}>{evt.tag}</code>
              </div>
            )}
            {/* Phase 266 — gateway path sub-label (plain text per REGRESSION_PLAN §0) */}
            {evt.category === 'gateway_path' && evt.tag && GATEWAY_PATH_LABELS[evt.tag] && (
              <div style={{ marginBottom: '0.25rem' }}>
                <strong>Path:</strong>{' '}
                <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.75rem', padding: '1px 6px', borderRadius: '2px', background: evt.tag === 'gateway.path.apikey' ? '#ca8a04' : evt.tag === 'gateway.path.dualtoken' ? '#0d9488' : '#004687', color: '#fff' }}>
                  {GATEWAY_PATH_LABELS[evt.tag]}
                </span>
              </div>
            )}
            {/* Phase 266 — INTROSPECTION-category act-chain: visible delegation audit trail */}
            {evt.category === 'introspection' && evt.metadata?.act && (
              <div style={{ marginTop: '0.35rem', marginBottom: '0.25rem', fontFamily: 'monospace', fontSize: '0.75rem', padding: '6px 10px', background: 'var(--code-bg, #f1f5f9)', borderRadius: '4px', borderLeft: '3px solid #6366f1' }}>
                <strong style={{ fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>Identity chain (delegation audit trail):</strong>
                <span style={{ color: '#1d4ed8' }}>user (sub={String(evt.metadata.sub || '').slice(0, 16)}{String(evt.metadata.sub || '').length > 16 ? '…' : ''})</span>
                {' → '}
                <span style={{ color: '#7c3aed' }}>via {evt.metadata.act?.client_id || evt.metadata.act?.sub || '?'}</span>
                {' → '}
                <span style={{ color: '#0d9488' }}>banking_resource_server (aud={String(evt.metadata.aud || '').split('/').pop()})</span>
              </div>
            )}
            {evt.flowId && (
              <div style={{ marginBottom: '0.25rem' }}>
                <strong>Flow ID:</strong>{' '}<code style={{ backgroundColor: 'var(--code-bg, #f1f5f9)', padding: '0.1rem 0.3rem', borderRadius: '0.2rem', fontSize: '0.75rem' }}>{evt.flowId}</code>
              </div>
            )}
            {evt.metadata && Object.keys(evt.metadata).length > 0 && (
              <div style={{ marginTop: '0.35rem' }}>
                <strong>Metadata:</strong>
                <div style={{ marginTop: '0.25rem', padding: '0.5rem', backgroundColor: 'var(--code-bg, #f1f5f9)', borderRadius: '0.25rem', fontFamily: 'inherit', fontSize: '0.75rem' }}>
                  {Object.entries(evt.metadata).map(([k, v]) => {
                    const isObj = v !== null && typeof v === 'object';
                    const metaKey = evt.id + ':' + k;
                    const isMetaExpanded = expandedMetaKeys.has(metaKey);
                    return (
                      <div key={k} style={{ marginBottom: '0.25rem' }}>
                        <div
                          onClick={isObj ? (e) => { e.stopPropagation(); toggleMetaKey(metaKey); } : undefined}
                          style={{ cursor: isObj ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          {isObj && (
                            <span style={{ fontSize: '0.65rem', transition: 'transform 0.1s', transform: isMetaExpanded ? 'rotate(90deg)' : 'rotate(0)', color: '#374151' }}>{'▶'}</span>
                          )}
                          <span style={{ color: '#6366f1' }}>{k}:</span>{' '}
                          {isObj
                            ? <span style={{ color: '#374151' }}>{isMetaExpanded ? '(expanded below)' : '{' + Object.keys(v).join(', ') + '}'}</span>
                            : <span>{String(v)}</span>
                          }
                        </div>
                        {isObj && isMetaExpanded && (
                          <pre style={{ marginTop: '0.25rem', marginLeft: '1rem', padding: '0.4rem', backgroundColor: 'var(--code-bg-dark, #e2e8f0)', borderRadius: '0.2rem', overflowX: 'auto', maxHeight: '300px', fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(v, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading && logs.length === 0 && activeTab === 'rawActivity') {
    return (
      <AdminSubPageShell title="Activity Logs" lead="View and filter audit trail of API activity.">
        <div className="loading"><div>Loading activity logs...</div></div>
      </AdminSubPageShell>
    );
  }

  const tabStyle = (tab) => ({
    padding: '0.5rem 1rem',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid var(--brand-blue, #0060f0)' : '2px solid transparent',
    backgroundColor: 'transparent',
    color: activeTab === tab ? 'var(--brand-blue, #0060f0)' : '#64748b',
    fontWeight: activeTab === tab ? '600' : '400',
    cursor: 'pointer',
    fontSize: '0.9rem',
  });

  return (
    <AdminSubPageShell
      title="Activity Logs"
      lead="View and filter audit trail of API activity."
    >
      <PageNav user={user} onLogout={onLogout} title="Activity Logs" />

      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border-color, #e2e8f0)', marginBottom: '1rem' }}>
        <button type="button" style={tabStyle('appEvents')} onClick={() => setActiveTab('appEvents')}>App Events</button>
        <button type="button" style={tabStyle('rawActivity')} onClick={() => setActiveTab('rawActivity')}>Raw Activity</button>
      </div>

      {activeTab === 'rawActivity' && (
        <div className="app-page-toolbar app-page-toolbar--start">
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => open(EDU.INTROSPECTION, 'why')}>How are audit logs created?</button>
          <button type="button" onClick={exportLogs} className="btn btn-secondary">Export CSV</button>
          <button type="button" onClick={clearOldLogs} className="btn btn-danger">Clear Old Logs</button>
        </div>
      )}

      {activeTab === 'appEvents' && renderAppEventsTab()}

      {activeTab === 'rawActivity' && (
        <>
          <div className="card">
            <div className="card-header"><h2 className="card-title">Filters</h2></div>
            <div className="filters">
              <div className="filter-group">
                <label className="filter-label">Username</label>
                <input type="text" className="filter-input" value={filters.username} onChange={(e) => handleFilterChange('username', e.target.value)} placeholder="Filter by username" />
              </div>
              <div className="filter-group">
                <label className="filter-label">Action</label>
                <select className="filter-input" value={filters.action} onChange={(e) => handleFilterChange('action', e.target.value)}>
                  <option value="">All Actions</option>
                  <option value="LOGIN">Login</option>
                  <option value="REGISTER">Register</option>
                  <option value="TRANSFER_MONEY">Transfer Money</option>
                  <option value="CHECK_BALANCE">Check Balance</option>
                  <option value="GET_TRANSACTIONS">Get Transactions</option>
                  <option value="CREATE_USER">Create User</option>
                  <option value="UPDATE_USER">Update User</option>
                  <option value="DELETE_USER">Delete User</option>
                  <option value="ADMIN_ACCESS">Admin Access</option>
                  <option value="VIEW_ACTIVITY_LOGS">View Activity Logs</option>
                  <option value="API_ROOT">API Root</option>
                  <option value="GET_CURRENT_USER">Get Current User</option>
                  <option value="CREATE_ACCOUNT">Create Account</option>
                  <option value="UPDATE_ACCOUNT">Update Account</option>
                  <option value="DELETE_ACCOUNT">Delete Account</option>
                  <option value="CREATE_TRANSACTION">Create Transaction</option>
                  <option value="UPDATE_TRANSACTION">Update Transaction</option>
                  <option value="DELETE_TRANSACTION">Delete Transaction</option>
                  <option value="GET_USERS">Get Users</option>
                  <option value="GET_ACCOUNTS">Get Accounts</option>
                </select>
              </div>
              <div className="filter-group">
                <label className="filter-label">Start Date</label>
                <input type="date" className="filter-input" value={filters.startDate} onChange={(e) => handleFilterChange('startDate', e.target.value)} />
              </div>
              <div className="filter-group">
                <label className="filter-label">End Date</label>
                <input type="date" className="filter-input" value={filters.endDate} onChange={(e) => handleFilterChange('endDate', e.target.value)} />
              </div>
              <div className="filter-group">
                <label className="filter-label">Limit</label>
                <select className="filter-input" value={filters.limit} onChange={(e) => handleFilterChange('limit', e.target.value)}>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
              <div className="filter-actions">
                <button className="btn btn-secondary" onClick={() => setFilters({ page: 1, limit: 50, username: '', action: '', startDate: '', endDate: '' })}>Clear Filters</button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Activity Logs</h2>
              <span style={{ color: '#374151', fontSize: '0.875rem' }}>Showing {logs.length} of {pagination.totalLogs} logs</span>
            </div>
            {logs.length > 0 ? (
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Endpoint</th><th>IP Address</th><th>Status</th><th>Duration</th></tr></thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} onClick={() => handleRowClick(log)} className="clickable">
                        <td>{format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm:ss')}</td>
                        <td>{log.username || 'Unknown'}</td>
                        <td><span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: '500', backgroundColor: getActionColor(log.action), color: 'white' }}>{log.action}</span></td>
                        <td style={{ fontFamily: 'inherit', fontSize: '0.875rem' }}>{log.endpoint}</td>
                        <td>{log.ipAddress || 'N/A'}</td>
                        <td><span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: '500', backgroundColor: log.responseStatus >= 400 ? '#ef4444' : '#10b981', color: 'white' }}>{log.responseStatus}</span></td>
                        <td>{log.duration}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><h3>No activity logs found</h3><p>No activity logs match the current filters.</p></div>
            )}
            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button className="pagination-btn" onClick={() => handlePageChange(pagination.currentPage - 1)} disabled={pagination.currentPage === 1}>Previous</button>
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
                  <button key={page} className={'pagination-btn' + (page === pagination.currentPage ? ' active' : '')} onClick={() => handlePageChange(page)}>{page}</button>
                ))}
                <button className="pagination-btn" onClick={() => handlePageChange(pagination.currentPage + 1)} disabled={pagination.currentPage === pagination.totalPages}>Next</button>
              </div>
            )}
          </div>

          {showModal && selectedLog && (
            <div className="modal-overlay" onClick={closeModal}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Request Details</h2>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button id="copy-curl-btn" className="btn btn-secondary" onClick={copyAsCurl} style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>Copy as cURL</button>
                    <button className="modal-close" onClick={closeModal}>{'\u00D7'}</button>
                  </div>
                </div>
                <div className="modal-body">
                  <div className="detail-section">
                    <h3>Basic Information</h3>
                    <div className="detail-grid">
                      <div className="detail-item"><label>Timestamp:</label><span>{format(new Date(selectedLog.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span></div>
                      <div className="detail-item"><label>User:</label><span>{selectedLog.username || 'Unknown'}</span></div>
                      <div className="detail-item"><label>Action:</label><span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: '500', backgroundColor: getActionColor(selectedLog.action), color: 'white' }}>{selectedLog.action}</span></div>
                      <div className="detail-item"><label>Endpoint:</label><span style={{ fontFamily: 'inherit' }}>{selectedLog.endpoint}</span></div>
                      <div className="detail-item"><label>IP Address:</label><span>{selectedLog.ipAddress || 'N/A'}</span></div>
                      <div className="detail-item"><label>Status:</label><span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: '500', backgroundColor: selectedLog.responseStatus >= 400 ? '#ef4444' : '#10b981', color: 'white' }}>{selectedLog.responseStatus}</span></div>
                      <div className="detail-item"><label>Duration:</label><span>{selectedLog.duration}ms</span></div>
                    </div>
                  </div>
                  <div className="detail-section">
                    <h3>Request Headers</h3>
                    <div className="code-block"><pre>{JSON.stringify({ 'User-Agent': selectedLog.userAgent, 'Content-Type': 'application/json', 'Authorization': selectedLog.username ? 'Bearer [TOKEN]' : 'None' }, null, 2)}</pre></div>
                  </div>
                  {selectedLog.requestBody && (<div className="detail-section"><h3>Request Body</h3><div className="code-block"><pre>{JSON.stringify(selectedLog.requestBody, null, 2)}</pre></div></div>)}
                  <div className="detail-section">
                    <h3>Response Information</h3>
                    <div className="detail-grid">
                      <div className="detail-item"><label>Status Code:</label><span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: '500', backgroundColor: selectedLog.responseStatus >= 400 ? '#ef4444' : '#10b981', color: 'white' }}>{selectedLog.responseStatus}</span></div>
                      <div className="detail-item"><label>Response Time:</label><span>{selectedLog.duration}ms</span></div>
                    </div>
                  </div>
                  {selectedLog.responseBody && (<div className="detail-section"><h3>Response Body</h3><div className="code-block"><pre>{JSON.stringify(selectedLog.responseBody, null, 2)}</pre></div></div>)}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <section style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>API Calls</h3>
        <ApiCallDisplay sessionId="activity-logs" />
      </section>
    </AdminSubPageShell>
  );
};

const getActionColor = (action) => {
  const colors = {
    'LOGIN': '#10b981', 'REGISTER': 'var(--brand-navy)', 'TRANSFER_MONEY': '#f59e0b',
    'CHECK_BALANCE': '#8b5cf6', 'GET_TRANSACTIONS': '#06b6d4', 'CREATE_USER': '#84cc16',
    'UPDATE_USER': '#f97316', 'DELETE_USER': '#ef4444', 'ADMIN_ACCESS': '#6366f1',
    'VIEW_ACTIVITY_LOGS': '#ec4899', 'API_ROOT': '#8b5cf6', 'GET_CURRENT_USER': '#06b6d4'
  };
  return colors[action] || '#6b7280';
};

export default ActivityLogs;
