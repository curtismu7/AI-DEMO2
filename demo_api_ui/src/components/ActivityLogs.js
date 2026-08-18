import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import PageNav from './PageNav';
import SignInPrompt from './SignInPrompt';
import ApiCallDisplay from './ApiCallDisplay';

const BUCKET_ORDER = ['AI Agent', 'Banking', 'Identity', 'Admin'];

const ACTION_BUCKET = {
  // AI Agent
  agent_prompt: 'AI Agent', mcp: 'AI Agent', token_exchange: 'AI Agent',
  delegation: 'AI Agent', introspection: 'AI Agent', gateway_path: 'AI Agent',
  // Banking
  CHECK_BALANCE: 'Banking', TRANSFER_MONEY: 'Banking', GET_TRANSACTIONS: 'Banking',
  CREATE_TRANSACTION: 'Banking', UPDATE_TRANSACTION: 'Banking', DELETE_TRANSACTION: 'Banking',
  GET_ACCOUNTS: 'Banking', CREATE_ACCOUNT: 'Banking', UPDATE_ACCOUNT: 'Banking',
  DELETE_ACCOUNT: 'Banking',
  // Identity
  LOGIN: 'Identity', REGISTER: 'Identity', GET_CURRENT_USER: 'Identity',
  auth_lifecycle: 'Identity', oauth: 'Identity', session: 'Identity',
  authorize: 'Identity', jwks: 'Identity',
  // Admin (also catch-all)
  ADMIN_ACCESS: 'Admin', VIEW_ACTIVITY_LOGS: 'Admin', CREATE_USER: 'Admin',
  UPDATE_USER: 'Admin', DELETE_USER: 'Admin', GET_USERS: 'Admin', API_ROOT: 'Admin',
};

const bucketLogs = (logs) => {
  const buckets = Object.fromEntries(BUCKET_ORDER.map(b => [b, []]));
  for (const log of logs) {
    const bucket = ACTION_BUCKET[log.action] || 'Admin';
    buckets[bucket].push(log);
  }
  return buckets;
};

const getActionColor = (action) => {
  const colors = {
    LOGIN: '#10b981', REGISTER: 'var(--brand-navy)', TRANSFER_MONEY: '#f59e0b',
    CHECK_BALANCE: '#8b5cf6', GET_TRANSACTIONS: '#06b6d4', CREATE_USER: '#84cc16',
    UPDATE_USER: '#f97316', DELETE_USER: '#ef4444', ADMIN_ACCESS: '#6366f1',
    VIEW_ACTIVITY_LOGS: '#ec4899', API_ROOT: '#8b5cf6', GET_CURRENT_USER: '#06b6d4',
  };
  return colors[action] || '#6b7280';
};

const BUCKET_ICONS = {
  'AI Agent': 'AI',
  Banking: 'Bk',
  Identity: '🔑',
  Admin: 'Ad',
};

const formatLogTimestamp = (timestamp) => {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return format(d, 'MMM dd, yyyy HH:mm:ss');
  } catch {
    return '—';
  }
};

const ActivityLogs = ({ user, onLogout }) => {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({
    page: 1, limit: 50, username: '', action: '', startDate: '', endDate: '',
  });
  const [expandedBuckets, setExpandedBuckets] = useState(new Set(BUCKET_ORDER));

  const fetchLogs = useCallback(async () => {
    if (!user) {
      setLogs([]);
      setPagination({});
      setAuthRequired(true);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setAuthRequired(false);
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.append(key, value); });
      const response = await apiClient.get(`/api/admin/activity?${params}`);
      setLogs(Array.isArray(response.data?.logs) ? response.data.logs : []);
      setPagination(response.data?.pagination || {});
    } catch (error) {
      console.error('Activity logs error:', error);
      setLogs([]);
      setPagination({});
      if (error.response?.status === 401) {
        setAuthRequired(true);
      } else if (error.response?.status === 403) {
        notifyError('You do not have permission to view activity logs.');
      } else {
        notifyError('Failed to load activity logs');
      }
    } finally {
      setLoading(false);
    }
  }, [filters, user]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleFilterChange = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
  const handlePageChange = (page) => setFilters(prev => ({ ...prev, page }));
  const handleRowClick = (log) => { setSelectedLog(log); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setSelectedLog(null); };

  const toggleBucket = (bucket) => {
    setExpandedBuckets(prev => {
      const n = new Set(prev);
      n.has(bucket) ? n.delete(bucket) : n.add(bucket);
      return n;
    });
  };

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
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  const clearOldLogs = async () => {
    if (window.confirm('Are you sure you want to clear logs older than 30 days?')) {
      try {
        await apiClient.delete('/api/admin/activity/clear?days=30');
        fetchLogs();
      } catch (error) {
        console.error('Clear logs error:', error);
      }
    }
  };

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
        const orig = button.textContent;
        button.textContent = 'Copied!';
        button.style.backgroundColor = '#10b981';
        setTimeout(() => { button.textContent = orig; button.style.backgroundColor = ''; }, 2000);
      }
    }).catch(() => notifyError('Copy failed.'));
  };

  const buckets = bucketLogs(logs);

  if (loading && logs.length === 0) {
    return (
      <div className="app-page-shell">
        <div style={{ padding: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Activity Logs</h1>
          <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>API activity grouped by intent.</p>
          <div className="loading"><div>Loading activity logs...</div></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page-shell">
      <div style={{ padding: '2rem' }}>
        <PageNav user={user} onLogout={onLogout} title="Activity Logs" />

        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Activity Logs</h1>
        <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>API activity grouped by intent.</p>

        <div className="app-page-toolbar app-page-toolbar--start" style={{ marginBottom: '1rem' }}>
          <button type="button" onClick={exportLogs} className="btn btn-secondary">Export CSV</button>
          <button type="button" onClick={clearOldLogs} className="btn btn-danger">Clear Old Logs</button>
        </div>

        {/* Filters */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header"><h2 className="card-title">Filters</h2></div>
          <div className="filters">
            <div className="filter-group">
              <label className="filter-label">Username</label>
              <input type="text" className="filter-input" value={filters.username}
                onChange={(e) => handleFilterChange('username', e.target.value)}
                placeholder="Filter by username" />
            </div>
            <div className="filter-group">
              <label className="filter-label">Action</label>
              <select className="filter-input" value={filters.action}
                onChange={(e) => handleFilterChange('action', e.target.value)}>
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
              <input type="date" className="filter-input" value={filters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)} />
            </div>
            <div className="filter-group">
              <label className="filter-label">End Date</label>
              <input type="date" className="filter-input" value={filters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)} />
            </div>
            <div className="filter-group">
              <label className="filter-label">Limit</label>
              <select className="filter-input" value={filters.limit}
                onChange={(e) => handleFilterChange('limit', e.target.value)}>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div className="filter-actions">
              <button className="btn btn-secondary"
                onClick={() => setFilters({ page: 1, limit: 50, username: '', action: '', startDate: '', endDate: '' })}>
                Clear Filters
              </button>
            </div>
          </div>
        </div>

        {/* Bucket groups */}
        {BUCKET_ORDER.map(bucket => {
          const rows = buckets[bucket];
          if (rows.length === 0) return null;
          const isExpanded = expandedBuckets.has(bucket);
          return (
            <div key={bucket} className="card" style={{ marginBottom: '1rem' }}>
              <div
                className="card-header"
                onClick={() => toggleBucket(bucket)}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', userSelect: 'none' }}
              >
                <span style={{ fontSize: '0.75rem', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                <span>{BUCKET_ICONS[bucket]}</span>
                <h2 className="card-title" style={{ margin: 0 }}>{bucket}</h2>
                <span style={{
                  marginLeft: '0.5rem',
                  background: 'var(--brand-blue, #0060f0)',
                  color: '#fff',
                  borderRadius: '999px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  padding: '1px 8px',
                  lineHeight: '1.6',
                }}>{rows.length}</span>
                <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '0.8rem' }}>
                  {isExpanded ? 'collapse' : 'expand'}
                </span>
              </div>
              {isExpanded && (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>User</th>
                        <th>Action</th>
                        <th>Endpoint</th>
                        <th>IP Address</th>
                        <th>Status</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(log => (
                        <tr key={log.id} onClick={() => handleRowClick(log)} className="clickable">
                          <td>{formatLogTimestamp(log.timestamp)}</td>
                          <td>{log.username || 'Unknown'}</td>
                          <td>
                            <span style={{
                              padding: '0.25rem 0.5rem', borderRadius: '0.25rem',
                              fontSize: '0.75rem', fontWeight: 500,
                              backgroundColor: getActionColor(log.action), color: 'white',
                            }}>{log.action}</span>
                          </td>
                          <td style={{ fontFamily: 'inherit', fontSize: '0.875rem' }}>{log.endpoint}</td>
                          <td>{log.ipAddress || 'N/A'}</td>
                          <td>
                            <span style={{
                              padding: '0.25rem 0.5rem', borderRadius: '0.25rem',
                              fontSize: '0.75rem', fontWeight: 500,
                              backgroundColor: log.responseStatus >= 400 ? '#ef4444' : '#10b981',
                              color: 'white',
                            }}>{log.responseStatus}</span>
                          </td>
                          <td>{log.duration}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {logs.length === 0 && !loading && (
          <div className="card">
            <div className="empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
              {authRequired || !user ? (
                <SignInPrompt message="HTTP activity logs require an authenticated session. For the live oauth / mcp / HITL event stream, open Activity Log under Monitoring." />
              ) : (
                <>
                  <h3>No activity logs found</h3>
                  <p style={{ color: '#64748b' }}>No activity logs match the current filters.</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="pagination" style={{ marginTop: '1rem' }}>
            <button className="pagination-btn"
              onClick={() => handlePageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1}>Previous</button>
            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(page => (
              <button key={page}
                className={'pagination-btn' + (page === pagination.currentPage ? ' active' : '')}
                onClick={() => handlePageChange(page)}>{page}</button>
            ))}
            <button className="pagination-btn"
              onClick={() => handlePageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage === pagination.totalPages}>Next</button>
          </div>
        )}

        {/* Row detail modal */}
        {showModal && selectedLog && (
          <div className="modal-overlay" onClick={closeModal}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Request Details</h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button id="copy-curl-btn" className="btn btn-secondary"
                    onClick={copyAsCurl} style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>
                    Copy as cURL
                  </button>
                  <button className="modal-close" onClick={closeModal}>×</button>
                </div>
              </div>
              <div className="modal-body">
                <div className="detail-section">
                  <h3>Basic Information</h3>
                  <div className="detail-grid">
                    <div className="detail-item"><label>Timestamp:</label><span>{formatLogTimestamp(selectedLog.timestamp)}</span></div>
                    <div className="detail-item"><label>User:</label><span>{selectedLog.username || 'Unknown'}</span></div>
                    <div className="detail-item"><label>Action:</label>
                      <span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 500, backgroundColor: getActionColor(selectedLog.action), color: 'white' }}>{selectedLog.action}</span>
                    </div>
                    <div className="detail-item"><label>Endpoint:</label><span style={{ fontFamily: 'inherit' }}>{selectedLog.endpoint}</span></div>
                    <div className="detail-item"><label>IP Address:</label><span>{selectedLog.ipAddress || 'N/A'}</span></div>
                    <div className="detail-item"><label>Status:</label>
                      <span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 500, backgroundColor: selectedLog.responseStatus >= 400 ? '#ef4444' : '#10b981', color: 'white' }}>{selectedLog.responseStatus}</span>
                    </div>
                    <div className="detail-item"><label>Duration:</label><span>{selectedLog.duration}ms</span></div>
                  </div>
                </div>
                <div className="detail-section">
                  <h3>Request Headers</h3>
                  <div className="code-block">
                    <pre>{JSON.stringify({ 'User-Agent': selectedLog.userAgent, 'Content-Type': 'application/json', Authorization: selectedLog.username ? 'Bearer [TOKEN]' : 'None' }, null, 2)}</pre>
                  </div>
                </div>
                {selectedLog.requestBody && (
                  <div className="detail-section">
                    <h3>Request Body</h3>
                    <div className="code-block"><pre>{JSON.stringify(selectedLog.requestBody, null, 2)}</pre></div>
                  </div>
                )}
                <div className="detail-section">
                  <h3>Response Information</h3>
                  <div className="detail-grid">
                    <div className="detail-item"><label>Status Code:</label>
                      <span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 500, backgroundColor: selectedLog.responseStatus >= 400 ? '#ef4444' : '#10b981', color: 'white' }}>{selectedLog.responseStatus}</span>
                    </div>
                    <div className="detail-item"><label>Response Time:</label><span>{selectedLog.duration}ms</span></div>
                  </div>
                </div>
                {selectedLog.responseBody && (
                  <div className="detail-section">
                    <h3>Response Body</h3>
                    <div className="code-block"><pre>{JSON.stringify(selectedLog.responseBody, null, 2)}</pre></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <section style={{ marginTop: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>API Calls</h3>
          <ApiCallDisplay sessionId="activity-logs" />
        </section>
      </div>
    </div>
  );
};

export default ActivityLogs;
