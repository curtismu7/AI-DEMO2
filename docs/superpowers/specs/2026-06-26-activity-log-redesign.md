# Activity Log Redesign

**Date:** 2026-06-26  
**Status:** Approved

## Problem

The `/monitoring/activity-log` page has two issues:

1. **Empty logs** — the backend endpoint requires `requireAdmin + requireScopes(['admin'])`, so any non-admin user gets a 403 and sees nothing.
2. **Cluttered UI** — two tabs (App Events + Raw Activity) where App Events shows mostly token-fetch noise; Raw Activity is what users actually want but is buried behind a tab.

## Goals

- Remove the App Events tab entirely — Raw Activity only.
- Group rows into four intent buckets so users can immediately find what they care about.
- Make the page accessible to any authenticated user (not admin-only).
- Keep the route ungated at the frontend level (matches how other monitoring pages work).

## Out of Scope

- Destructive actions (clear old logs, export CSV) remain admin-only on the backend — no change.
- No new data sources; Raw Activity continues to read from `dataStore.activityLogs` via `/api/admin/activity`.
- No changes to how logs are written (activityLogger middleware unchanged).

---

## Backend Changes

**File:** `demo_api_server/routes/admin.js`

Change the read-only activity endpoints from `requireAdmin + requireScopes(['admin'])` to `authenticateToken` only:

- `GET /activity` (line 204)
- `GET /activity/user/:username` (line 258)
- `GET /activity/userid/:userId` (line 292)
- `GET /activity/recent` (line 326)
- `GET /activity/summary` (line 344)
- `GET /activity/users/summary` (line 368)

These stay `requireAdmin`:
- `DELETE /activity/clear` (line 402)
- `GET /activity/export` (line 430)

---

## Frontend Changes

### 1. Route auth (`demo_api_ui/src/routes/MonitoringRoutes.js`)

Remove the `user` guard on the `activity-log` route — match the pattern used by `token-chain`, `flow-inspector`, etc.:

```js
// Before
<Route path="activity-log" element={
  user
    ? <ActivityLogs user={user} onLogout={logout} />
    : <Navigate to="/" replace />
} />

// After
<Route path="activity-log" element={<ActivityLogs user={user} onLogout={logout} />} />
```

### 2. Component (`demo_api_ui/src/components/ActivityLogs.js`)

**Remove entirely:**
- `activeTab` state and tab toggle UI
- `appEvents`, `appEventsLoading`, `eventCategories`, `eventFilter`, `expandedFlowIds`, `expandedEventIds`, `expandedMetaKeys` state
- `fetchAppEvents`, `toggleFlow`, `toggleEvent`, `toggleMetaKey` functions
- `useAppEventsSSE` hook usage
- `renderAppEventsTab`, `renderFlowGroup`, `renderEventRow` functions
- All CATEGORY_ICONS, CATEGORY_LABELS, GATEWAY_PATH_LABELS, SEVERITY_BORDER constants
- `pollRef`
- The tab bar render block
- Conditional `appEvents` loading spinner

**Keep:**
- `logs`, `pagination`, `loading`, `selectedLog`, `showModal`, `filters` state
- `fetchLogs`, `handleFilterChange`, `handlePageChange`, `exportLogs`, `clearOldLogs`, `handleRowClick`, `closeModal`, `copyAsCurl` functions
- Filters card (username, action, date, limit, clear)
- Row click modal with request details + Copy as cURL
- Export CSV + Clear Old Logs toolbar buttons
- `ApiCallDisplay` section at bottom

**Add:**
- Bucket grouping logic (pure function, no API calls):

```js
const BUCKET_ORDER = ['AI Agent', 'Banking', 'Identity', 'Admin'];

const ACTION_BUCKET = {
  // AI Agent
  agent_prompt: 'AI Agent', mcp: 'AI Agent', token_exchange: 'AI Agent',
  delegation: 'AI Agent', introspection: 'AI Agent', gateway_path: 'AI Agent',
  // Banking
  CHECK_BALANCE: 'Banking', TRANSFER_MONEY: 'Banking', GET_TRANSACTIONS: 'Banking',
  CREATE_TRANSACTION: 'Banking', UPDATE_TRANSACTION: 'Banking', DELETE_TRANSACTION: 'Banking',
  GET_ACCOUNTS: 'Banking', CREATE_ACCOUNT: 'Banking', UPDATE_ACCOUNT: 'Banking', DELETE_ACCOUNT: 'Banking',
  // Identity
  LOGIN: 'Identity', REGISTER: 'Identity', GET_CURRENT_USER: 'Identity',
  auth_lifecycle: 'Identity', oauth: 'Identity', session: 'Identity',
  authorize: 'Identity', jwks: 'Identity',
  // Admin (catch-all)
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
```

- `expandedBuckets` state (Set), defaulting to all four buckets expanded
- Four collapsible bucket cards rendered in `BUCKET_ORDER` sequence
- Each bucket card: header with bucket name + count badge, chevron toggle, table inside (same columns as current: Timestamp, User, Action, Endpoint, IP, Status, Duration)
- Empty bucket: show nothing (hide the card entirely when count is 0 after filtering)

**Shell:** Replace `AdminSubPageShell` with a plain `div` wrapper using the same page-level padding/layout. Title: "Activity Logs". Lead: "API activity grouped by intent."

---

## Bucket Definitions

| Bucket | Mapped Actions |
|--------|---------------|
| AI Agent | agent_prompt, mcp, token_exchange, delegation, introspection, gateway_path |
| Banking | CHECK_BALANCE, TRANSFER_MONEY, GET_TRANSACTIONS, CREATE_TRANSACTION, UPDATE_TRANSACTION, DELETE_TRANSACTION, GET_ACCOUNTS, CREATE_ACCOUNT, UPDATE_ACCOUNT, DELETE_ACCOUNT |
| Identity | LOGIN, REGISTER, GET_CURRENT_USER, auth_lifecycle, oauth, session, authorize, jwks |
| Admin | ADMIN_ACCESS, VIEW_ACTIVITY_LOGS, CREATE_USER, UPDATE_USER, DELETE_USER, GET_USERS, API_ROOT, (unknown) |

---

## Success Criteria

1. Navigating to `/monitoring/activity-log` without being logged in renders the page (no redirect).
2. A non-admin logged-in user sees activity log rows (not an empty table / 403 error).
3. The App Events tab is gone — no tab bar visible.
4. Rows are grouped into four collapsible buckets in order: AI Agent, Banking, Identity, Admin.
5. Buckets with zero matching rows after filtering are hidden.
6. Clicking a row opens the existing detail modal with Copy as cURL.
7. Filters still work — narrowing by username/action/date updates all buckets simultaneously.
8. Export CSV and Clear Old Logs buttons are still present.
