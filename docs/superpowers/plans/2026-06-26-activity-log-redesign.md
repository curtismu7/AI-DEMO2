# Activity Log Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the App Events tab, group Raw Activity rows into four intent buckets, and open the page to any authenticated user (not admin-only).

**Architecture:** Three independent changes: (1) backend relaxes 6 read-only activity endpoints from `requireAdmin` to `authenticateToken`; (2) frontend route removes login guard; (3) ActivityLogs component drops App Events tab and renders rows grouped into AI Agent / Banking / Identity / Admin buckets.

**Tech Stack:** Node.js/Express (backend), React (frontend), existing `dataStore.getAllActivityLogs()` / `/api/admin/activity` endpoint unchanged in behaviour.

## Global Constraints

- Do NOT change the activityLogger middleware or how logs are written.
- `DELETE /activity/clear` and `GET /activity/export` remain `requireAdmin` — do not relax these.
- Follow existing inline-style React patterns already used in ActivityLogs.js — no CSS modules or new stylesheets.
- No new npm dependencies.
- Work in a git worktree; stage files explicitly, never `git add -A`.

---

## File Map

| File | Change |
|------|--------|
| `demo_api_server/routes/admin.js` | Swap `requireAdmin, requireScopes(['admin'])` → `authenticateToken` on 6 read-only activity routes |
| `demo_api_ui/src/routes/MonitoringRoutes.js` | Remove `user` guard on `activity-log` route |
| `demo_api_ui/src/components/ActivityLogs.js` | Full rewrite: drop App Events tab, add bucket grouping, replace AdminSubPageShell |

---

### Task 1: Relax backend auth on read-only activity endpoints

**Files:**
- Modify: `demo_api_server/routes/admin.js` (lines 204, 258, 292, 326, 344, 368)

**Interfaces:**
- Produces: `/api/admin/activity` (and variants) accessible with any valid session token, not just admin+admin-scope.

- [ ] **Step 1: Make the 6 changes in admin.js**

Each change is identical in pattern — swap `requireAdmin, requireScopes(['admin'])` to `authenticateToken`. `authenticateToken` is already imported at line 6.

Open `demo_api_server/routes/admin.js` and make these replacements (each is a distinct line, context shown for safety):

**Line 204** — `GET /activity`:
```js
// Before:
router.get('/activity', requireAdmin, requireScopes(['admin']), (req, res) => {
// After:
router.get('/activity', authenticateToken, (req, res) => {
```

**Line 258** — `GET /activity/user/:username`:
```js
// Before:
router.get('/activity/user/:username', requireAdmin, requireScopes(['admin']), (req, res) => {
// After:
router.get('/activity/user/:username', authenticateToken, (req, res) => {
```

**Line 292** — `GET /activity/userid/:userId`:
```js
// Before:
router.get('/activity/userid/:userId', requireAdmin, requireScopes(['admin']), (req, res) => {
// After:
router.get('/activity/userid/:userId', authenticateToken, (req, res) => {
```

**Line 326** — `GET /activity/recent`:
```js
// Before:
router.get('/activity/recent', requireAdmin, requireScopes(['admin']), (req, res) => {
// After:
router.get('/activity/recent', authenticateToken, (req, res) => {
```

**Line 344** — `GET /activity/summary`:
```js
// Before:
router.get('/activity/summary', requireAdmin, requireScopes(['admin']), (req, res) => {
// After:
router.get('/activity/summary', authenticateToken, (req, res) => {
```

**Line 368** — `GET /activity/users/summary`:
```js
// Before:
router.get('/activity/users/summary', requireAdmin, requireScopes(['admin']), (req, res) => {
// After:
router.get('/activity/users/summary', authenticateToken, (req, res) => {
```

- [ ] **Step 2: Verify the two destructive routes are untouched**

Run:
```bash
grep -n "activity/clear\|activity/export" demo_api_server/routes/admin.js
```
Expected output — both lines must still show `requireAdmin`:
```
402:router.delete('/activity/clear', requireAdmin, requireScopes(['admin']), (req, res) => {
430:router.get('/activity/export', requireAdmin, requireScopes(['admin']), (req, res) => {
```

- [ ] **Step 3: Smoke-test the server starts**

```bash
cd demo_api_server && node -e "require('./routes/admin')" 2>&1 | head -5
```
Expected: no output (no syntax errors; module loads cleanly).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/routes/admin.js
git commit -m "feat: relax activity log read endpoints to authenticateToken"
```

---

### Task 2: Ungate the activity-log frontend route

**Files:**
- Modify: `demo_api_ui/src/routes/MonitoringRoutes.js` (lines 38-42)

**Interfaces:**
- Produces: `/monitoring/activity-log` renders for unauthenticated visitors (passes `user={null}` to `ActivityLogs`).

- [ ] **Step 1: Remove the user guard**

In `demo_api_ui/src/routes/MonitoringRoutes.js`, replace the guarded route:

```jsx
// Before (lines 38-42):
<Route path="activity-log" element={
  user
    ? <ActivityLogs user={user} onLogout={logout} />
    : <Navigate to="/" replace />
} />

// After:
<Route path="activity-log" element={<ActivityLogs user={user} onLogout={logout} />} />
```

- [ ] **Step 2: Verify no other activity-log route guards remain**

```bash
grep -n "activity-log" demo_api_ui/src/routes/MonitoringRoutes.js
```
Expected: one line, no `Navigate` reference on the same line.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/routes/MonitoringRoutes.js
git commit -m "feat: ungate activity-log route for unauthenticated visitors"
```

---

### Task 3: Rewrite ActivityLogs component with bucket grouping

**Files:**
- Modify: `demo_api_ui/src/components/ActivityLogs.js`

**Interfaces:**
- Consumes: `GET /api/admin/activity?page=&limit=&username=&action=&startDate=&endDate=` — returns `{ logs: [...], pagination: { totalLogs, totalPages, currentPage } }`
- Each log object has: `id`, `timestamp`, `username`, `action`, `endpoint`, `ipAddress`, `responseStatus`, `duration`, `userAgent`, `requestBody`, `responseBody`, `authorization`
- Produces: page visible at `/monitoring/activity-log`

- [ ] **Step 1: Write the new ActivityLogs.js**

Replace the entire file with the following. This removes all App Events code and adds bucket grouping:

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import PageNav from './PageNav';
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
  'AI Agent': '🤖',
  Banking: '🏦',
  Identity: '🔑',
  Admin: '⚙️',
};

const ActivityLogs = ({ user, onLogout }) => {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({
    page: 1, limit: 50, username: '', action: '', startDate: '', endDate: '',
  });
  const [expandedBuckets, setExpandedBuckets] = useState(new Set(BUCKET_ORDER));

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.append(key, value); });
      const response = await apiClient.get(`/api/admin/activity?${params}`);
      setLogs(response.data.logs);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Activity logs error:', error);
      if (error.response?.status === 403) {
        notifyError('You do not have permission to view activity logs.');
      } else if (error.response?.status !== 401) {
        notifyError('Failed to load activity logs');
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

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
                          <td>{format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm:ss')}</td>
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
              <h3>No activity logs found</h3>
              <p style={{ color: '#64748b' }}>No activity logs match the current filters.</p>
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
                    <div className="detail-item"><label>Timestamp:</label><span>{format(new Date(selectedLog.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span></div>
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
```

- [ ] **Step 2: Verify removed imports are not needed elsewhere in this file**

The new file does NOT import: `useAppEventsSSE`, `AdminSubPageShell`, `useEducationUI`, `EDU`. Confirm these are not referenced anywhere in the new content by scanning the code block above — none appear.

- [ ] **Step 3: Check the app builds**

```bash
cd demo_api_ui && npx react-scripts build 2>&1 | tail -20
```
Expected: `Successfully compiled.` (or warnings, but no errors).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/ActivityLogs.js
git commit -m "feat: rewrite ActivityLogs — drop App Events tab, add intent bucket grouping"
```

---

## Verification Checklist

After all three tasks are committed, manually verify:

- [ ] Navigate to `/monitoring/activity-log` without logging in — page renders (no redirect to `/`)
- [ ] Log in as a non-admin user — rows appear in buckets (no empty table / 403 toast)
- [ ] No "App Events" tab visible anywhere on the page
- [ ] Four bucket cards appear in order: AI Agent, Banking, Identity, Admin
- [ ] Buckets with 0 rows are hidden
- [ ] Clicking a row opens the detail modal; Copy as cURL works
- [ ] Username/action/date filters narrow rows across all buckets
- [ ] Clicking a bucket header collapses/expands it
- [ ] Export CSV button present (may 403 for non-admins — that's expected)
