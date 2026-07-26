# Custom Server Source for McpInspectorPage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the "add any MCP server" capability (profile picker + "+ Add
server") that `McpInspector.js` still has, as a 4th source in the merged
`McpInspectorPage.jsx` — the new page currently only switches between 3 fixed
sources (Banking MCP / PingOne MCP / API Calls), with no way to point it at an
arbitrary websocket/http/stdio MCP server the way the old page could.

**Architecture:** Port `McpInspector.js`'s profile-picker/add-server/
PingOne-admin-login state and handlers into a 4th `use*Source()` hook,
`useCustomServerSource`, following the exact same `{statusOn, statusText,
actions, left, middle, right}` contract the other 3 hooks already return.
This hook duplicates a large fraction of `useBankingSource`'s tool/invoke
logic (list tools, select, fill params, invoke, show output) — that
duplication is accepted, not fixed, per the same tradeoff the original design
spec already made for the other 3 sources ("presentation consolidation, not a
data-layer merge"); do not refactor `useBankingSource` to share code with this
new hook as part of this plan.

`InspectorShell` has no slot for more than one full-width notice strip below
the topbar — every source so far has worked around this by stuffing a single
banner into `middle` (Banking's `needsLogin`) or `actions` (API Calls'
`error`). This source needs up to 5 different notices/panels at once
(add-server panel, PingOne-admin error, PingOne-admin login-required, profile
error, needs-login) — cramming all of those into an existing slot would be
unreadable. Task 1 adds a small optional `banner` prop to `InspectorShell`
instead: a full-width strip rendered between the topbar and the 3-column
grid, matching what `McpInspector.js`'s own full-width notice strips already
look like. It renders nothing when omitted, so the 3 existing sources and the
2 already-merged sibling pages (`PingOneAuthorizePage.jsx`,
`AgentGatewayTester.jsx`) are unaffected.

Restoring reachability to the profile-picker also re-exposes a latent
routing bug: `routes/mcpPingOneAdminAuth.js` (the PingOne-admin-login OAuth
callback for the built-in `'built-in-pingone-mcp'` profile) hardcodes 3
redirects to `/mcp-inspector`, which — since Plan 4 — is itself a `<Navigate>`
redirect to `/pingone-mcp-inspector?source=banking`. A `<Navigate>` discards
any extra query string on its fixed target, so today the admin-login error
message (`?pingone_admin_error=...`) is silently dropped and the user always
lands on Banking MCP regardless of which profile they were trying to
configure. Task 3 fixes this by pointing all 3 redirects directly at
`/pingone-mcp-inspector?source=custom` (+ the error param where present),
skipping the extra hop entirely.

**Tech Stack:** React (hooks), Express + supertest for the backend test.

## Global Constraints

- **Worktree required.** Continue in `worktree-mcp-inspector-merge` (this
  branch's earlier work is already merged to `origin/main`; new commits on
  this branch go through the same merge-and-push cycle again). Confirm with
  `git branch --show-current` before each commit.
- **Protected UI area.** `demo_api_ui` is covered by `REGRESSION_PLAN.md` §1.
  Invoke `regression-guard` before Task 1's first edit. State what will not
  break: `McpInspector.js` is **not modified or deleted** by this plan — it
  stays exactly as-is, still embedded in `McpGatewayConfig.jsx`'s "Tool
  Calls" tab and still reachable there.
- **Emoji allowlist** (`REGRESSION_PLAN.md` §0): only
  `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` permitted. None of the copied logic uses emoji
  — don't introduce any.
- **Stage explicitly.** `git add <exact files>`, never `git add -A`.
- **No behavior change within the ported logic.** The Custom Server source's
  profile-picker, add-server flow, tool discovery, and invoke logic must
  match `McpInspector.js`'s original behavior exactly (same endpoints, same
  request/response shapes, same notice text) — this restores existing
  behavior to a new location, it does not redesign it.
- **UI build gate.** `npm run build` inside `demo_api_ui/` must succeed
  before this plan is done (final step of the last task).
- **Backend test gate.** `demo_api_server`'s Jest suite must stay green after
  Task 3's redirect-target change.

---

## File Structure

| File | Change |
|---|---|
| `demo_api_ui/src/components/shared/InspectorShell.jsx` | Add an optional `banner` prop: a full-width strip rendered between the topbar and the 3-column grid. |
| `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx` | Add coverage for the new `banner` prop. |
| `demo_api_ui/src/components/McpInspectorPage.jsx` | Add `useCustomServerSource()`, register `'custom'` in `SOURCES`, wire it into `current`'s switch. |
| `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx` | Add tests for the Custom Server source. |
| `demo_api_server/routes/mcpPingOneAdminAuth.js` | Fix 3 hardcoded `/mcp-inspector` redirect targets to `/pingone-mcp-inspector?source=custom` (+ preserve `pingone_admin_error` where present). |
| `demo_api_server/tests/mcpPingOneAdminAuth.redirects.test.js` | **New.** Covers the 2 easily-triggered failure-redirect paths (`invalid_state`, `missing_code`); the success-path redirect (line ~187) would need a full mocked PingOne app-provisioning + token-exchange to reach and is not worth mocking for a 1-line target-string change — verify that one by inspection instead (see Task 3 Step 1's verification note).

---

### Task 1: Add an optional `banner` prop to `InspectorShell`

**Files:**
- Modify: `demo_api_ui/src/components/shared/InspectorShell.jsx`
- Test: `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `InspectorShell` now accepts an optional `banner` prop (any React
  node), rendered between the topbar and the grid. Omitting it renders
  nothing extra — existing callers (`PingOneAuthorizePage.jsx`,
  `AgentGatewayTester.jsx`, `McpInspectorPage.jsx`'s 3 existing sources) are
  unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx`
(inside the existing `describe('InspectorShell', ...)` block, after the last
`it(...)`):

```jsx
it('renders banner content between the topbar and the grid when provided', () => {
  const { container } = render(
    <InspectorShell title="X" banner={<div data-testid="banner-content">banner</div>} />,
  );
  const topbar = container.querySelector('.inspector-shell-topbar');
  const banner = screen.getByTestId('banner-content');
  const grid = container.querySelector('.inspector-shell-grid');
  expect(topbar.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(banner.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('renders no extra element when banner is not provided', () => {
  const { container } = render(<InspectorShell title="X" />);
  expect(container.querySelector('.inspector-shell-page').children).toHaveLength(2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd demo_api_ui
npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx
```

Expected: the 2 new tests FAIL (`banner` prop doesn't exist yet); the 5
existing tests still PASS.

- [ ] **Step 3: Add the `banner` prop**

In `demo_api_ui/src/components/shared/InspectorShell.jsx`, change:

```jsx
export default function InspectorShell({
  title,
  statusOn = true,
  statusText,
  actions,
  fullHeight = true,
  left,
  middle,
  right,
}) {
  return (
    <div className="inspector-shell-page">
      <div className="inspector-shell-topbar">
```

to:

```jsx
export default function InspectorShell({
  title,
  statusOn = true,
  statusText,
  actions,
  fullHeight = true,
  banner,
  left,
  middle,
  right,
}) {
  return (
    <div className="inspector-shell-page">
      <div className="inspector-shell-topbar">
```

and change the point right after the topbar's closing `</div>` (immediately
before the grid `<div>`) from:

```jsx
      </div>
      <div
        className={
          fullHeight
            ? 'inspector-shell-grid'
            : 'inspector-shell-grid inspector-shell-grid--embedded'
        }
      >
```

to:

```jsx
      </div>
      {banner}
      <div
        className={
          fullHeight
            ? 'inspector-shell-grid'
            : 'inspector-shell-grid inspector-shell-grid--embedded'
        }
      >
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/components/shared/__tests__/InspectorShell.test.jsx
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # confirm worktree-mcp-inspector-merge
git add demo_api_ui/src/components/shared/InspectorShell.jsx \
        demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx
git commit -m "feat(inspector-shell): add optional banner slot between topbar and grid"
```

---

### Task 2: Add the Custom Server source

**Files:**
- Modify: `demo_api_ui/src/components/McpInspectorPage.jsx`
- Modify: `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`

**Interfaces:**
- Consumes: `banner` prop from Task 1; `groupBankingTools`, `bankingToolDot`,
  `bankingToolBadges`, `coerceParam`, `BANKING_STATIC_TOOLS` already defined
  earlier in this same file (Task 2 of Plan 4) — reuse them, don't redefine.
- Produces: `McpInspectorPage` now switches between 4 sources; `'custom'`
  selectable via the pill switcher or `?source=custom`.

- [ ] **Step 1: Verify `McpInspector.js` still matches this plan's quotes**

Read `demo_api_ui/src/components/McpInspector.js` in full and confirm its
profile-picker state (around line 237-254), `loadProfiles` (274-287),
`refreshTools` (289-335), `handleAddProfile` (341-388), and the topbar
`<select>`/"+ Add server" panel/notice-banner JSX (around line 495-662) still
match what Step 4 below adapts. If it has drifted, STOP and report BLOCKED
with specifics.

- [ ] **Step 2: Add the failing tests**

Append to `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`
(after the existing API Calls tests):

```jsx
const CUSTOM_TOOL = {
  name: 'brave_web_search',
  description: 'Search the web via Brave Search.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  requiredScopes: [],
};

function mockCustomServerEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/profiles') {
      return Promise.resolve({
        data: {
          profiles: [
            { id: 'default', label: 'Banking MCP', isDefault: true },
            { id: 'brave', label: 'Brave Search', isDefault: false },
          ],
          defaultProfileId: 'default',
        },
      });
    }
    if (url.startsWith('/api/mcp/inspector/tools')) {
      return Promise.resolve({ data: { tools: [CUSTOM_TOOL], _source: 'mcp_server' } });
    }
    return Promise.resolve({ data: {} });
  });
}

test('the Custom Server source loads saved profiles into the picker', async () => {
  mockCustomServerEndpoints();
  renderPage('/pingone-mcp-inspector?source=custom');
  expect(await screen.findByRole('option', { name: 'Brave Search' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Banking MCP (default)' })).toBeInTheDocument();
});

test('selecting a non-default profile requeries tools with a ?profile= param', async () => {
  mockCustomServerEndpoints();
  renderPage('/pingone-mcp-inspector?source=custom');
  await screen.findByRole('option', { name: 'Brave Search' });
  fireEvent.change(screen.getByTitle('MCP server to inspect'), { target: { value: 'brave' } });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
    expect.stringContaining('/api/mcp/inspector/tools?profile=brave'),
  ));
  expect(await screen.findByText('brave_web_search')).toBeInTheDocument();
});

test('"+ Add server" posts a new profile and selects it', async () => {
  mockCustomServerEndpoints();
  apiClient.post.mockResolvedValueOnce({ data: { profile: { id: 'new-1', label: 'New Server' } } });
  renderPage('/pingone-mcp-inspector?source=custom');
  await screen.findByRole('option', { name: 'Brave Search' });
  fireEvent.click(screen.getByRole('button', { name: '+ Add server' }));
  fireEvent.change(screen.getByPlaceholderText('Label (e.g. Brave Search)'), { target: { value: 'New Server' } });
  fireEvent.change(screen.getByPlaceholderText('Server URL'), { target: { value: 'ws://localhost:9999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/profiles',
    { label: 'New Server', transport: 'http', url: 'ws://localhost:9999' },
  ));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd demo_api_ui
npx vitest run src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: the 3 new tests FAIL (`'custom'` source not registered yet); the 8
existing tests still PASS.

- [ ] **Step 4: Add `useCustomServerSource` and register the 4th source**

In `demo_api_ui/src/components/McpInspectorPage.jsx`, add `'custom'` to
`SOURCES`:

```js
const SOURCES = [
  { key: 'banking', label: 'Banking MCP' },
  { key: 'pingone', label: 'PingOne MCP' },
  { key: 'api', label: 'API Calls' },
  { key: 'custom', label: 'Custom Server' },
];
```

Then add a `useCustomServerSource` function, directly after
`useApiCallsSource`'s closing `}`:

```js
function useCustomServerSource() {
  const [tools, setTools] = useState([]);
  const [toolsSourceInfo, setToolsSourceInfo] = useState(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [formError, setFormError] = useState(null);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outputTab, setOutputTab] = useState('response');
  const [mcpHistory, setMcpHistory] = useState(getCalls);

  const [profiles, setProfiles] = useState([]);
  const [defaultProfileId, setDefaultProfileId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileError, setProfileError] = useState(null);
  const [pingoneAdminLoginUrl, setPingoneAdminLoginUrl] = useState(null);
  const [pingoneAdminError, setPingoneAdminError] = useState(null);
  const [showAddServer, setShowAddServer] = useState(false);
  const [addProfileError, setAddProfileError] = useState(null);
  const [newProfile, setNewProfile] = useState({
    label: '',
    transport: 'http',
    url: '',
    authHeader: 'Authorization',
    authValue: '',
    command: '',
    argsText: '',
    envText: '',
  });

  useEffect(() => {
    const unsub = subscribeMcpCalls(setMcpHistory);
    return unsub;
  }, []);

  // Surface a failed PingOne admin login (routes/mcpPingOneAdminAuth.js
  // redirects back to ?source=custom&pingone_admin_error=... on state
  // mismatch / token exchange failure).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('pingone_admin_error');
    if (err) {
      setPingoneAdminError(err);
      params.delete('pingone_admin_error');
      const qs = params.toString();
      window.history.replaceState({}, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/mcp/inspector/profiles');
      setProfiles(data.profiles || []);
      setDefaultProfileId(data.defaultProfileId || '');
      setSelectedProfileId((prev) => prev || data.defaultProfileId || '');
    } catch {
      // Non-fatal: the default banking profile still works via the query-less path.
    }
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const refreshTools = useCallback(async () => {
    setLoadingTools(true);
    setProfileError(null);
    setPingoneAdminLoginUrl(null);
    const isNonDefaultProfile = selectedProfileId && selectedProfileId !== defaultProfileId;
    try {
      const qs = isNonDefaultProfile ? `?profile=${encodeURIComponent(selectedProfileId)}` : '';
      const { data } = await apiClient.get(`/api/mcp/inspector/tools${qs}`);
      setTools(data.tools || []);
      setToolsSourceInfo(
        data._source === 'local_catalog'
          ? { local: true, reason: data._localCatalogReason || '' }
          : data._source === 'mcp_server'
            ? { local: false }
            : null,
      );
      if (data._source === 'profile_error') {
        setProfileError(data.reason || 'Failed to reach this MCP server.');
      }
      if (data.pingone_admin_login_required) {
        setPingoneAdminLoginUrl(data.loginUrl || '/api/mcp/inspector/pingone-admin/login');
      }
      setSelectedTool(null);
      setLastInvoke(null);
      setLastTiming(null);
      setFormError(null);
      setNeedsLogin(false);
    } catch (e) {
      if (isNonDefaultProfile) {
        setTools([]);
        setToolsSourceInfo(null);
        setProfileError(formatAxiosError(e, 'Failed to reach this MCP server'));
      } else {
        notifyError(formatAxiosError(e, 'BFF unreachable - showing static tool catalog'));
        setTools(BANKING_STATIC_TOOLS);
        setToolsSourceInfo({ local: true, reason: 'bff_unreachable' });
      }
    } finally {
      setLoadingTools(false);
    }
  }, [selectedProfileId, defaultProfileId]);

  useEffect(() => { refreshTools(); }, [refreshTools]);

  const handleAddProfile = useCallback(async () => {
    setAddProfileError(null);
    const { label, transport, url, authHeader, authValue, command, argsText, envText } = newProfile;
    const body = { label: label.trim(), transport };
    if (transport === 'stdio') {
      if (!command.trim()) {
        setAddProfileError('Command is required.');
        return;
      }
      body.command = command.trim();
      body.args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
      if (envText.trim()) {
        body.env = {};
        for (const pair of envText.split(',')) {
          const [k, ...rest] = pair.split('=');
          if (k && k.trim()) body.env[k.trim()] = rest.join('=').trim();
        }
      }
    } else {
      if (!url.trim()) {
        setAddProfileError('Server URL is required.');
        return;
      }
      body.url = url.trim();
      if (authHeader.trim() && authValue.trim()) {
        body.authHeader = authHeader.trim();
        body.authValue = authValue.trim();
      }
    }
    try {
      const { data } = await apiClient.post('/api/mcp/inspector/profiles', body);
      await loadProfiles();
      setSelectedProfileId(data.profile.id);
      setShowAddServer(false);
      setNewProfile({
        label: '',
        transport: 'http',
        url: '',
        authHeader: 'Authorization',
        authValue: '',
        command: '',
        argsText: '',
        envText: '',
      });
    } catch (e) {
      setAddProfileError(formatAxiosError(e, 'Failed to add server'));
    }
  }, [newProfile, loadProfiles]);

  const groupedTools = useMemo(() => {
    const searchQ = toolSearch.trim().toLowerCase();
    const filtered = searchQ
      ? tools.filter((t) => (t.name || '').toLowerCase().includes(searchQ) || (t.description || '').toLowerCase().includes(searchQ))
      : tools;
    return groupBankingTools(filtered);
  }, [tools, toolSearch]);

  const selectTool = (tool) => {
    setSelectedTool(tool);
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
    setNeedsLogin(false);
    setOutputTab('response');
  };

  const handleInvoke = useCallback(async () => {
    if (!selectedTool) return;
    const props = selectedTool.inputSchema?.properties || {};
    const required = selectedTool.inputSchema?.required || [];
    const missing = required.filter((key) => !String(paramValues[key] ?? '').trim());
    if (missing.length > 0) {
      setFormError(`Required: ${missing.join(', ')}`);
      return;
    }
    setFormError(null);
    const params = {};
    for (const [key, schema] of Object.entries(props)) {
      const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }
    setBusy(true);
    const t0 = Date.now();
    try {
      const isNonDefaultProfile = selectedProfileId && selectedProfileId !== defaultProfileId;
      const { data } = await apiClient.post('/api/mcp/inspector/invoke', {
        tool: selectedTool.name,
        params,
        ...(isNonDefaultProfile ? { profile: selectedProfileId } : {}),
      });
      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, 200, ms, data.result ?? data);
      setLastInvoke(data);
      setLastTiming({ ms, error: false });
      setNeedsLogin(false);
      setOutputTab('response');
    } catch (e) {
      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, e.response?.status ?? 0, ms, null, formatAxiosError(e, 'Invoke failed'));
      setLastInvoke(e.response?.data?.frames ? e.response.data : null);
      setLastTiming({ ms, error: true, reason: formatAxiosError(e, 'Invoke failed') });
      if (e.response?.data?.error === 'pingone_admin_login_required') {
        setPingoneAdminLoginUrl(e.response.data.loginUrl || '/api/mcp/inspector/pingone-admin/login');
      } else if (e.response?.status === 401) {
        setNeedsLogin(true);
      } else {
        setNeedsLogin(false);
        notifyError(formatAxiosError(e, 'Invoke failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [selectedTool, paramValues, selectedProfileId, defaultProfileId]);

  const clearForm = () => {
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
  };

  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response') {
      if (lastInvoke?.frames?.response) return lastInvoke.frames.response;
      if (lastInvoke) return lastInvoke;
      return null;
    }
    if (outputTab === 'request') {
      if (lastInvoke?.frames?.request) return lastInvoke.frames.request;
      return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool?.name, arguments: paramValues } };
    }
    if (outputTab === 'history') return mcpHistory;
    return null;
  }, [outputTab, lastInvoke, lastTiming, selectedTool, paramValues, mcpHistory]);

  const isConnected = !toolsSourceInfo?.local;
  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  return {
    statusOn: isConnected,
    statusText: isConnected ? `Connected - ${tools.length} tools` : `Local catalog - ${tools.length} tools`,
    actions: (
      <>
        <select
          className="inspector-shell-topbar__btn"
          value={selectedProfileId}
          onChange={(e) => setSelectedProfileId(e.target.value)}
          title="MCP server to inspect"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}{p.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <button className="inspector-shell-topbar__btn" onClick={() => setShowAddServer((v) => !v)}>
          + Add server
        </button>
        <button className="inspector-shell-topbar__btn" onClick={refreshTools} disabled={loadingTools}>
          {loadingTools ? 'Loading...' : 'Refresh'}
        </button>
      </>
    ),
    banner: (
      <>
        {showAddServer && (
          <div style={{ background: '#f8fafc', padding: '12px 20px', fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderBottom: '1px solid #cbd5e1' }}>
            <input
              placeholder="Label (e.g. Brave Search)"
              value={newProfile.label}
              onChange={(e) => setNewProfile((p) => ({ ...p, label: e.target.value }))}
            />
            <select
              value={newProfile.transport}
              onChange={(e) => setNewProfile((p) => ({ ...p, transport: e.target.value }))}
            >
              <option value="http">HTTP</option>
              <option value="websocket">WebSocket</option>
              <option value="stdio">stdio (local command)</option>
            </select>
            {newProfile.transport !== 'stdio' ? (
              <>
                <input
                  placeholder="Server URL"
                  value={newProfile.url}
                  onChange={(e) => setNewProfile((p) => ({ ...p, url: e.target.value }))}
                  style={{ minWidth: 220 }}
                />
                <input
                  placeholder="Auth header (e.g. Authorization)"
                  value={newProfile.authHeader}
                  onChange={(e) => setNewProfile((p) => ({ ...p, authHeader: e.target.value }))}
                />
                <input
                  placeholder="Auth value (e.g. Bearer xxx)"
                  type="password"
                  value={newProfile.authValue}
                  onChange={(e) => setNewProfile((p) => ({ ...p, authValue: e.target.value }))}
                />
              </>
            ) : (
              <>
                <input
                  placeholder="Command (e.g. npx)"
                  value={newProfile.command}
                  onChange={(e) => setNewProfile((p) => ({ ...p, command: e.target.value }))}
                />
                <input
                  placeholder="Args (space-separated, e.g. -y @brave/brave-search-mcp-server --transport stdio)"
                  value={newProfile.argsText}
                  onChange={(e) => setNewProfile((p) => ({ ...p, argsText: e.target.value }))}
                  style={{ minWidth: 320 }}
                />
                <input
                  placeholder="Env (KEY=value, comma-separated, e.g. BRAVE_API_KEY=xxx)"
                  value={newProfile.envText}
                  onChange={(e) => setNewProfile((p) => ({ ...p, envText: e.target.value }))}
                  style={{ minWidth: 260 }}
                />
              </>
            )}
            <button className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active" onClick={handleAddProfile}>
              Save
            </button>
            {addProfileError && <span style={{ color: '#991b1b' }}>{addProfileError}</span>}
          </div>
        )}
        {pingoneAdminError && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '8px 20px', fontSize: 12 }}>
            <strong>PingOne admin sign-in failed.</strong> {pingoneAdminError}
          </div>
        )}
        {pingoneAdminLoginUrl && (
          <div style={{ background: '#eff6ff', color: '#1e40af', padding: '8px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <strong>PingOne admin sign-in required.</strong>{' '}
            This profile calls the hosted PingOne MCP server with your PingOne admin roles, not a stored secret.
            <button
              className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active"
              onClick={() => { window.location.href = pingoneAdminLoginUrl; }}
            >
              Sign in as PingOne admin
            </button>
          </div>
        )}
        {profileError && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '8px 20px', fontSize: 12 }}>
            <strong>Could not reach this MCP server.</strong> {profileError}
          </div>
        )}
        {needsLogin && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '8px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <strong>Sign in required.</strong> This tools/call needs a valid BFF session.
            <button className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active" onClick={navigateToCustomerOAuthLogin}>
              Log in
            </button>
          </div>
        )}
      </>
    ),
    left: (
      <>
        <div className="inspector-shell-tree-header"><span>Tools ({tools.length})</span></div>
        <div className="inspector-shell-tree-search">
          <input
            type="search"
            placeholder="Filter tools..."
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="inspector-shell-tree-body">
          {groupedTools.map((group) => (
            <div key={group.key}>
              <div className="inspector-shell-tree-group__label">{group.label} ({group.tools.length})</div>
              {group.tools.map((t) => (
                <InspectorListItem
                  key={t.name}
                  label={t.name}
                  active={selectedTool?.name === t.name}
                  dot={bankingToolDot(t)}
                  badges={bankingToolBadges(t)}
                  onClick={() => selectTool(t)}
                />
              ))}
            </div>
          ))}
          {groupedTools.length === 0 && (
            <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
              {tools.length === 0 ? 'No tools loaded.' : `No tools match "${toolSearch}".`}
            </div>
          )}
        </div>
        {mcpHistory.length > 0 && (
          <div className="inspector-shell-tree-footer" style={{ borderTop: '1px solid #cbd5e1', padding: '8px 12px', fontSize: 11, color: '#64748b', maxHeight: 140, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>History ({mcpHistory.length})</div>
            {mcpHistory.slice(-10).reverse().map((entry) => {
              const ok = entry.status >= 200 && entry.status < 300;
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
                  <span style={{ color: '#334155', fontFamily: 'monospace', fontSize: 11 }}>{entry.tool}</span>
                  {entry.duration != null && <span style={{ marginLeft: 'auto', color: '#64748b' }}>{entry.duration}ms</span>}
                </div>
              );
            })}
          </div>
        )}
      </>
    ),
    middle: selectedTool ? (
      <>
        <div className="inspector-shell-form-header">
          <div className="inspector-shell-form-header__name">{selectedTool.name}</div>
          {selectedTool.description && <div className="inspector-shell-form-header__desc">{selectedTool.description}</div>}
          {selectedTool.requiredScopes?.length > 0 && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, fontFamily: 'monospace' }}>
              Scopes: {selectedTool.requiredScopes.join(', ')}
            </div>
          )}
        </div>
        <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
          <button className="inspector-shell-btn-call" onClick={handleInvoke} disabled={busy}>{busy ? 'Calling...' : 'Execute'}</button>
          <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
        </div>
        <div className="inspector-shell-form-body">
          {Object.entries(schemaProps).map(([key, schema]) => (
            <div className="inspector-shell-field" key={key}>
              <label>
                {key}{requiredParams.has(key) && <span className="req"> *</span>}
                <span className="type">{schema?.type || ''}</span>
              </label>
              <input
                type="text"
                placeholder={schema?.description || schema?.type || 'value'}
                value={paramValues[key] ?? ''}
                onChange={(e) => setParamValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
          {Object.keys(schemaProps).length === 0 && (
            <div style={{ color: '#64748b', fontSize: 13 }}>No parameters required.</div>
          )}
        </div>
        <div className="inspector-shell-form-actions">
          <button className="inspector-shell-btn-call" onClick={handleInvoke} disabled={busy}>{busy ? 'Calling...' : 'Execute'}</button>
          <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
          {formError && <span className="inspector-shell-form-error">{formError}</span>}
        </div>
      </>
    ) : (
      <div className="inspector-shell-form-empty">Select a tool from the tree to inspect and invoke it.</div>
    ),
    right: (
      <>
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'request', label: 'Request JSON-RPC' },
            { key: 'history', label: `History (${mcpHistory.length})` },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code"><JsonHighlight value={outputContent} deep /></pre>
            </div>
            <div className="inspector-shell-output-footer">
              <span><strong>Status:</strong> {lastTiming?.error ? 'Error' : lastTiming ? '200 OK' : '-'}</span>
              <span><strong>Duration:</strong> {lastTiming?.ms != null ? `${lastTiming.ms}ms` : '-'}</span>
              <span><strong>Transport:</strong> WebSocket JSON-RPC</span>
            </div>
          </>
        ) : (
          <div className="inspector-shell-output-empty">
            {selectedTool ? 'Click Execute to call the tool and see the response here.' : 'Select a tool and execute it to see results.'}
          </div>
        )}
      </>
    ),
  };
}
```

Finally, change `McpInspectorPage`'s body from:

```js
  const banking = useBankingSource();
  const pingone = usePingOneSource();
  const api = useApiCallsSource();
  const current = activeSource === 'pingone' ? pingone : activeSource === 'api' ? api : banking;
```

to:

```js
  const banking = useBankingSource();
  const pingone = usePingOneSource();
  const api = useApiCallsSource();
  const custom = useCustomServerSource();
  const current =
    activeSource === 'pingone' ? pingone
      : activeSource === 'api' ? api
      : activeSource === 'custom' ? custom
      : banking;
```

and pass `current.banner` into `InspectorShell`'s new `banner` prop (add it
next to the existing `actions={current.actions}` line):

```jsx
      actions={current.actions}
      banner={current.banner}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: PASS — 11 tests.

- [ ] **Step 6: Run the UI build gate**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # confirm worktree-mcp-inspector-merge
git add demo_api_ui/src/components/McpInspectorPage.jsx \
        demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx
git commit -m "feat(mcp-inspector-page): add Custom Server source (profile picker + add server)"
```

---

### Task 3: Fix the PingOne-admin-login redirect targets

**Files:**
- Modify: `demo_api_server/routes/mcpPingOneAdminAuth.js`
- Test: `demo_api_server/tests/mcpPingOneAdminAuth.redirects.test.js` (new)

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: no exports — only redirect-target strings change.

- [ ] **Step 1: Verify the 3 redirect targets still match this plan's quotes**

Read `demo_api_server/routes/mcpPingOneAdminAuth.js` in full (197 lines) and
confirm the 3 `res.redirect(...)` calls at (approximately) lines 148, 159,
and 187 still target `/mcp-inspector` as quoted below. If it has drifted,
STOP and report BLOCKED with specifics.

(Verification note for the file's own note above: the success-path redirect
at line 187 has no test in this task, since reaching it requires a fully
mocked PingOne app-provisioning + token-exchange round trip — disproportionate
for a 1-line target-string change. After Step 2's edit, manually confirm by
reading the edited line that it now reads
`res.redirect('/pingone-mcp-inspector?source=custom');`.)

- [ ] **Step 2: Write the failing tests**

Create `demo_api_server/tests/mcpPingOneAdminAuth.redirects.test.js`:

```js
const request = require('supertest');
const express = require('express');

describe('GET /api/mcp/inspector/pingone-admin/callback redirects', () => {
  let app;
  beforeEach(() => {
    app = express();
    app.use((req, _res, next) => { req.session = {}; next(); });
    app.use('/api/mcp/inspector/pingone-admin', require('../routes/mcpPingOneAdminAuth'));
  });

  test('invalid_state redirects to /pingone-mcp-inspector?source=custom with the error', async () => {
    const res = await request(app)
      .get('/api/mcp/inspector/pingone-admin/callback')
      .query({ code: 'abc', state: 'wrong' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pingone-mcp-inspector?source=custom&pingone_admin_error=invalid_state');
  });

  test('missing_code redirects to /pingone-mcp-inspector?source=custom with the error', async () => {
    app = express();
    app.use((req, _res, next) => {
      req.session = { pingoneMcpAdminOAuth: { state: 'xyz', codeVerifier: 'v', redirectUri: 'http://x/cb' } };
      next();
    });
    app.use('/api/mcp/inspector/pingone-admin', require('../routes/mcpPingOneAdminAuth'));
    const res = await request(app)
      .get('/api/mcp/inspector/pingone-admin/callback')
      .query({ state: 'xyz' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pingone-mcp-inspector?source=custom&pingone_admin_error=missing_code');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd demo_api_server
npx jest tests/mcpPingOneAdminAuth.redirects.test.js
```

Expected: both tests FAIL (redirect still targets `/mcp-inspector`).

- [ ] **Step 4: Fix the 3 redirect targets**

In `demo_api_server/routes/mcpPingOneAdminAuth.js`, change:

```js
    console.error('[mcpPingOneAdminAuth] /login error:', err.message);
    res.redirect(`/mcp-inspector?pingone_admin_error=${encodeURIComponent(err.message)}`);
```

to:

```js
    console.error('[mcpPingOneAdminAuth] /login error:', err.message);
    res.redirect(`/pingone-mcp-inspector?source=custom&pingone_admin_error=${encodeURIComponent(err.message)}`);
```

Change:

```js
  const failAndRedirect = (message) => {
    delete req.session.pingoneMcpAdminOAuth;
    res.redirect(`/mcp-inspector?pingone_admin_error=${encodeURIComponent(message)}`);
  };
```

to:

```js
  const failAndRedirect = (message) => {
    delete req.session.pingoneMcpAdminOAuth;
    res.redirect(`/pingone-mcp-inspector?source=custom&pingone_admin_error=${encodeURIComponent(message)}`);
  };
```

Change:

```js
      if (err) console.error('[mcpPingOneAdminAuth] session save error (post-token):', err.message);
      res.redirect('/mcp-inspector');
```

to:

```js
      if (err) console.error('[mcpPingOneAdminAuth] session save error (post-token):', err.message);
      res.redirect('/pingone-mcp-inspector?source=custom');
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest tests/mcpPingOneAdminAuth.redirects.test.js
```

Expected: PASS — 2 tests.

- [ ] **Step 6: Run the full backend test suite**

```bash
CI=true npx jest --maxWorkers=2
```

Expected: no new failures (this route module has no other consumers).

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # confirm worktree-mcp-inspector-merge
git add demo_api_server/routes/mcpPingOneAdminAuth.js \
        demo_api_server/tests/mcpPingOneAdminAuth.redirects.test.js
git commit -m "fix(mcp-pingone-admin-auth): redirect to /pingone-mcp-inspector?source=custom, not the retired /mcp-inspector route"
```

---

## What this plan does not do

- Does not modify or delete `McpInspector.js` — it stays exactly as-is,
  still embedded in `McpGatewayConfig.jsx`'s "Tool Calls" tab.
- Does not add a delete-profile control — `McpInspector.js` itself never
  exposed one in its UI (only add), even though the backend supports
  `DELETE /api/mcp/inspector/profiles/:id`. Out of scope; this plan restores
  existing behavior, it doesn't add new capability beyond what
  `McpInspector.js` already had.
- Does not refactor `useBankingSource`/`useCustomServerSource` to share code,
  despite substantial overlap — an accepted, plan-acknowledged tradeoff (see
  Architecture).
- Does not redesign the Custom Server source's tool-grouping — it reuses
  `groupBankingTools`'s banking-domain heuristics (accounts/transactions/
  admin/etc.) exactly as `McpInspector.js`'s own `groupByResource` did, even
  though those categories don't really fit an arbitrary third-party MCP
  server's tools (most will land in "Other"). This is a pre-existing
  characteristic of the ported behavior, not something this plan introduces.
