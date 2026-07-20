# McpInspectorPage Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new `McpInspectorPage.jsx` that consolidates `McpInspector.js`, `PingOneMcpInspector.js`, and `ApiExplorerPanel.js` behind one `InspectorShell` instance with a source switcher (Banking MCP / PingOne MCP / API Calls), matching the design spec's original intent. Redirect the three old routes into it and update `AdminSideNav.jsx` accordingly — the fourth and final page in this series.

**Architecture:** `McpInspectorPage.jsx` owns one `activeSource` state (`'banking' | 'pingone' | 'api'`) and renders a single `<InspectorShell>` whose `title`/`statusOn`/`statusText`/`actions`/`left`/`middle`/`right` all switch on `activeSource`. Each source's data fetching, selection state, and call logic is a straight copy of the corresponding original file's logic (state hooks, `useCallback`s, helpers) — **not** a shared abstraction across sources, since the three sources have genuinely different data shapes (a hierarchical tool tree vs. a flat captured-call list) and different capture mechanisms (client-side `mcpCallStore` vs. a poll against a server buffer vs. no history at all). A source switch resets the active item/tab to that source's defaults.

**Scope corrections found during this plan's research (before any code was touched):**

1. **`McpInspector.js` is no longer the ~635-line file this series' design spec was written against.** An unrelated, already-merged commit (`11418f6f8`, "Generic MCP Inspector — pluggable server profiles") added a generic multi-server profile picker to it: a `<select>` of server profiles (the default banking profile, a built-in `'built-in-pingone-mcp'` profile authenticated via a separate PingOne-admin OAuth login flow, and user-addable custom websocket/http/stdio servers via a "+ Add server" form), plus a `PageNav` wrapper and an "Add server" panel. This creates real overlap with this plan's own "PingOne MCP" source. **Resolved with the human:** build the original 3-way merge as designed — the "Banking MCP" source in the new page uses only `McpInspector.js`'s *default-profile* tool-tree-and-invoke logic (the part that predates the profile-picker addition); the profile-picker UI itself (`profiles`/`selectedProfileId`/`showAddServer`/`newProfile`/`pingoneAdminLoginUrl`/`pingoneAdminError` state, the profile `<select>`, the "+ Add server" panel, the `PageNav` wrapper) is **not** carried into the new page — it becomes redundant once the page has its own top-level Banking/PingOne/API-Calls switcher. `McpInspector.js` itself is untouched by this plan (see point 3) — this only affects what gets *copied* into the new page's Banking MCP source, not the original file.
2. **All three original files are still directly routed** (`/mcp-inspector`, `/pingone-mcp-inspector`, `/monitoring/api-explorer`) with intact nav entries — unlike the `AgentGatewayTester` conversion, none of their routes had already been redirected elsewhere by the time this plan was drafted.
3. **`McpInspector.js` and `ApiExplorerPanel.js` are each now** ***also*** **embedded (in addition to their own routes) in other consolidated admin pages** that this plan must not break: `McpInspector` is rendered props-less as the "Tool Calls" tab of `McpGatewayConfig.jsx` (`<div className="mgc-panel"><McpInspector /></div>`), and `ApiExplorerPanel` is rendered props-less as the "API Explorer" tab of `DevToolsDashboard.jsx`. **Because of this, this plan does not delete or modify any of the three original files.** They stay exactly as they are, fully intact, for those embeds to keep working. Only their top-level *routes* are redirected and their `AdminSideNav.jsx` entries are removed/repointed — the new page is built as new, additive code that duplicates the relevant logic rather than moving it.

Everything else about the design spec's original plan holds: `/pingone-mcp-inspector` keeps its route name and becomes the merged page (because that's where the "PingOne MCP" nav group's entry already lives), `/mcp-inspector` and `/monitoring/api-explorer` become redirects with a `?source=` query param, per the spec's original routing section.

**Tech Stack:** React 18, Vitest + `@testing-library/react` + `@testing-library/jest-dom`. Both `apiClient`-based sources (Banking MCP, PingOne MCP) use the `vi.mock('../services/apiClient', ...)` pattern; the API Calls source uses the global `fetch` (not `apiClient`) — mock it with `vi.stubGlobal('fetch', vi.fn())`.

## Global Constraints

- **Worktree required.** All work happens in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/mcp-inspector-merge`, branch `worktree-mcp-inspector-merge`. Confirm with `git branch --show-current` before each commit.
- **Protected UI area.** `demo_api_ui` is covered by `REGRESSION_PLAN.md` §1. Invoke `regression-guard` before Task 1's first edit. State what will not break: `McpInspector.js`, `PingOneMcpInspector.js`, `ApiExplorerPanel.js` are **not modified or deleted** by this plan (see scope correction 3) — their existing embeds in `McpGatewayConfig.jsx` and `DevToolsDashboard.jsx` are unaffected. Only `App.js`, `MonitoringRoutes.js`, and `AdminSideNav.jsx` change, and only their routing for the three retired top-level paths.
- **Given how much concurrent activity has hit these exact files this session** (`McpInspector.js` grew by ~230 lines since this plan's initial scoping began), **re-verify the live file's content matches this plan's quoted "current" text immediately before editing** in every task — do not assume research from even a few hours ago is still accurate.
- **Emoji allowlist** (`REGRESSION_PLAN.md` §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` permitted. None of the copied logic uses emoji — don't introduce any.
- **Stage explicitly.** `git add <exact files>`, never `git add -A`.
- **Depends on prior plans.** `InspectorShell`, `InspectorListItem`, `InspectorTabs` (`demo_api_ui/src/components/shared/`) must exist on `main` — they do, along with two working examples of the pattern (`PingOneAuthorizePage.jsx`, `AgentGatewayTester.jsx`).
- **UI build gate.** `npm run build` inside `demo_api_ui/` must succeed before this plan is done (final step of the last task).
- **No behavior change within each source.** Each source's fetch calls, invoke/call logic, and output shape must match its original file's behavior exactly (minus the Banking MCP source's dropped profile-picker, per scope correction 1) — this is a consolidation of presentation, not a rewrite of any source's data logic.

---

## File Structure

| File | Change |
|---|---|
| `demo_api_ui/src/components/McpInspectorPage.jsx` | **New.** The consolidated page — source switcher + three sources, each built on `InspectorShell`/`InspectorTabs`/`InspectorListItem`. |
| `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx` | **New.** No existing test coverage for any of the three original files' merged behavior. |
| `demo_api_ui/src/App.js` | Swap the `/pingone-mcp-inspector` route's element to `<McpInspectorPage />`; change `/mcp-inspector` to a `<Navigate>` redirect. |
| `demo_api_ui/src/routes/MonitoringRoutes.js` | Change the `api-explorer` child route to a `<Navigate>` redirect. |
| `demo_api_ui/src/components/AdminSideNav.jsx` | Remove the "Generic MCP Inspector" entry (Banking MCP & Gateways group) and the "API Explorer" entry (Monitoring group); rename the "PingOne MCP Inspector" entry (PingOne MCP group) to "MCP Inspector" — same path, now the merged page. |

`McpInspector.js`, `PingOneMcpInspector.js`, `ApiExplorerPanel.js` are **not** in this table — none of them change.

---

### Task 1: Build `McpInspectorPage.jsx` — shell, source switcher, and the Banking MCP source

**Files:**
- Create: `demo_api_ui/src/components/McpInspectorPage.jsx`
- Create: `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`

**Interfaces:**
- Consumes: `InspectorShell({title, statusOn, statusText, actions, left, middle, right})`, `InspectorTabs({tabs, activeKey, onChange})`, `InspectorListItem({label, active, dot, badges, onClick})` from `demo_api_ui/src/components/shared/`.
- Produces: `McpInspectorPage` — default export, no props (matches how it will be routed: `<Route path="/pingone-mcp-inspector" element={<McpInspectorPage />} />`, no `user`/`onLogout` — none of the three sources actually need them once the Banking source's `PageNav` is dropped per scope correction 1; `PingOneMcpInspector`'s `user`/`onLogout` were already unused "dead props," and `ApiExplorerPanel` never received them).

- [ ] **Step 1: Invoke regression-guard**

Before any edit, invoke the `regression-guard` skill. State: this task creates one new file with no imports from any existing page — nothing currently routed is touched. `McpInspector.js` (the file this task's Banking MCP source logic is adapted from) is read-only reference material, not edited.

- [ ] **Step 2: Verify `McpInspector.js` still matches this plan's Banking-MCP-relevant quotes**

Read `demo_api_ui/src/components/McpInspector.js` in full and confirm the module-level helpers (`coerceParam`, `isWriteScope`/`isWriteTool`/`isReasoningTool`/`isSensitiveTool`, `toolDotClass`, `toolBadge`, `RESOURCE_META`/`RESOURCE_ORDER`, `toolResource`, `groupByResource`, `STATIC_LOCAL_TOOLS`) and the component's default-profile-path hooks/handlers still match what Step 4 below quotes. If it has drifted further, STOP and report BLOCKED with specifics — this file has already changed once mid-session.

- [ ] **Step 3: Write the failing tests (Banking MCP source only for this task)**

Create `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`:

```jsx
// demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import McpInspectorPage from '../McpInspectorPage';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const BANKING_TOOL = {
  name: 'get_account_balance',
  description: 'Get current balance for a specific account by ID.',
  inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
  requiredScopes: ['accounts:read'],
};

function mockBankingEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/tools') {
      return Promise.resolve({ data: { tools: [BANKING_TOOL], _source: 'mcp_server' } });
    }
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBankingEndpoints();
});

test('defaults to the Banking MCP source and renders its topbar title', async () => {
  render(<McpInspectorPage />);
  expect(screen.getByRole('heading', { name: 'MCP Inspector' })).toBeInTheDocument();
  expect(await screen.findByText('get_account_balance')).toBeInTheDocument();
});

test('the source switcher shows all three sources with Banking MCP active by default', () => {
  render(<McpInspectorPage />);
  expect(screen.getByRole('button', { name: 'Banking MCP' })).toHaveClass('src-pill--active');
  expect(screen.getByRole('button', { name: 'PingOne MCP' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'API Calls' })).toBeInTheDocument();
});

test('selecting a Banking MCP tool populates the middle form, calling Execute posts to /api/mcp/inspector/invoke without a profile field', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/tools') {
      return Promise.resolve({ data: { tools: [BANKING_TOOL], _source: 'mcp_server' } });
    }
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({ data: { balance: 4820.15 } });
  render(<McpInspectorPage />);
  fireEvent.click(await screen.findByText('get_account_balance'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/invoke',
    { tool: 'get_account_balance', params: { account_id: 'acc_1' } },
  ));
  expect(await screen.findByText(/4820.15/)).toBeInTheDocument();
});

test('does not render a profile picker or "+ Add server" control (dropped for the Banking MCP source)', async () => {
  render(<McpInspectorPage />);
  await screen.findByText('get_account_balance');
  expect(screen.queryByText('+ Add server')).toBeNull();
  expect(screen.queryByTitle('MCP server to inspect')).toBeNull();
});
```

- [ ] **Step 4: Run the tests to verify they fail**

From `demo_api_ui/`:

```bash
npx vitest run src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: FAIL — `McpInspectorPage` does not exist yet (`Failed to resolve import "../McpInspectorPage"`).

- [ ] **Step 5: Write `McpInspectorPage.jsx` — imports, source-switcher scaffold, and the Banking MCP source**

Create `demo_api_ui/src/components/McpInspectorPage.jsx`:

```jsx
// demo_api_ui/src/components/McpInspectorPage.jsx
// Consolidates McpInspector.js (Banking MCP), PingOneMcpInspector.js
// (PingOne MCP), and ApiExplorerPanel.js (API Calls) behind one
// InspectorShell instance with a source switcher. Each source's logic is
// a straight adaptation of its original file — see the design spec
// (docs/superpowers/specs/2026-07-19-inspector-shell-template-design.md)
// and this plan's own Architecture section for why these aren't unified
// into shared logic. The three original files are untouched by this page
// — McpInspector.js and ApiExplorerPanel.js are still separately embedded
// in McpGatewayConfig.jsx and DevToolsDashboard.jsx respectively.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import { getCalls, subscribe as subscribeMcpCalls, appendMcpCall } from '../services/mcpCallStore';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
import InspectorListItem from './shared/InspectorListItem';
import './shared/InspectorShell.css';

const SOURCES = [
  { key: 'banking', label: 'Banking MCP' },
  { key: 'pingone', label: 'PingOne MCP' },
  { key: 'api', label: 'API Calls' },
];

// ---------------------------------------------------------------------------
// Banking MCP source — adapted from McpInspector.js's default-profile path.
// The profile picker / "+ Add server" / PingOne-admin-login additions from
// that file are intentionally not carried over (see plan scope correction 1).
// ---------------------------------------------------------------------------

const coerceParam = (raw, type) => {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
};

const isWriteScope = (s) => /write|manage|delete/.test(String(s).toLowerCase());
const isWriteTool = (tool) => (tool.requiredScopes || []).some(isWriteScope);
const isReasoningTool = (tool) => {
  const n = (tool.name || '').toLowerCase();
  return n.includes('think') || n.includes('reason');
};
const isSensitiveTool = (tool) =>
  (tool.requiredScopes || []).some((s) => String(s).toLowerCase().includes('sensitive')) ||
  (tool.name || '').toLowerCase().includes('sensitive');

const bankingToolDot = (tool) => {
  if (isSensitiveTool(tool)) return 'sensitive';
  if (isWriteTool(tool)) return 'write';
  return 'default';
};

const bankingToolBadges = (tool) => {
  if (isSensitiveTool(tool)) return ['sensitive'];
  if (isWriteTool(tool)) return ['write'];
  return [];
};

const BANKING_RESOURCE_META = {
  accounts: { label: 'Accounts' },
  transactions: { label: 'Transactions' },
  admin: { label: 'Customer Admin' },
  directory: { label: 'Directory / Users' },
  vertical: { label: 'Vertical Demos' },
  reasoning: { label: 'Reasoning' },
  other: { label: 'Other' },
};
const BANKING_RESOURCE_ORDER = [
  'accounts', 'transactions', 'admin', 'directory', 'vertical', 'reasoning', 'other',
];

const bankingToolResource = (tool) => {
  const name = (tool.name || '').toLowerCase();
  const scopes = (tool.requiredScopes || []).map((s) => String(s).toLowerCase());
  const hasPrefix = (p) => scopes.some((s) => s.startsWith(p));
  if (isReasoningTool(tool)) return 'reasoning';
  if (hasPrefix('admin:') || hasPrefix('users:') || name.includes('customer')) return 'admin';
  if (name.includes('transaction') || /deposit|withdraw|transfer/.test(name) || hasPrefix('transactions')) {
    return 'transactions';
  }
  if (name.includes('account') || name.includes('balance') || hasPrefix('accounts')) return 'accounts';
  if (name.startsWith('show_')) return 'vertical';
  if (name.includes('user') || name.includes('email')) return 'directory';
  return 'other';
};

const groupBankingTools = (toolList) => {
  const buckets = {};
  for (const t of toolList) (buckets[bankingToolResource(t)] ||= []).push(t);
  return BANKING_RESOURCE_ORDER.filter((k) => buckets[k]?.length).map((k) => ({
    key: k,
    label: BANKING_RESOURCE_META[k].label,
    tools: buckets[k],
  }));
};

const BANKING_STATIC_TOOLS = [
  {
    name: 'get_my_accounts',
    description: 'List all bank accounts with balances and status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['accounts:read'],
  },
  {
    name: 'get_account_balance',
    description: 'Get current balance for a specific account by ID.',
    inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
    requiredScopes: ['accounts:read'],
  },
  {
    name: 'get_my_transactions',
    description: 'Retrieve transaction history for the authenticated user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['transactions:read'],
  },
];

function useBankingSource() {
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

  useEffect(() => {
    const unsub = subscribeMcpCalls(setMcpHistory);
    return unsub;
  }, []);

  const refreshTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const { data } = await apiClient.get('/api/mcp/inspector/tools');
      setTools(data.tools || []);
      setToolsSourceInfo(
        data._source === 'local_catalog'
          ? { local: true, reason: data._localCatalogReason || '' }
          : data._source === 'mcp_server'
            ? { local: false }
            : null,
      );
      setSelectedTool(null);
      setLastInvoke(null);
      setLastTiming(null);
      setFormError(null);
      setNeedsLogin(false);
    } catch (e) {
      notifyError(formatAxiosError(e, 'BFF unreachable - showing static tool catalog'));
      setTools(BANKING_STATIC_TOOLS);
      setToolsSourceInfo({ local: true, reason: 'bff_unreachable' });
    } finally {
      setLoadingTools(false);
    }
  }, []);

  useEffect(() => { refreshTools(); }, [refreshTools]);

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
      const { data } = await apiClient.post('/api/mcp/inspector/invoke', { tool: selectedTool.name, params });
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
      if (e.response?.status === 401) {
        setNeedsLogin(true);
      } else {
        setNeedsLogin(false);
        notifyError(formatAxiosError(e, 'Invoke failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [selectedTool, paramValues]);

  const clearForm = () => {
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
  };

  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response') return lastInvoke ?? null;
    if (outputTab === 'request') {
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
      <button className="inspector-shell-topbar__btn" onClick={refreshTools} disabled={loadingTools}>
        {loadingTools ? 'Loading...' : 'Refresh'}
      </button>
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
            { key: 'request', label: 'Request' },
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

export default function McpInspectorPage() {
  const [activeSource, setActiveSource] = useState('banking');
  const banking = useBankingSource();
  const current = banking; // Steps in Tasks 2-3 add pingone/api and select based on activeSource.

  return (
    <InspectorShell
      title="MCP Inspector"
      statusOn={current.statusOn}
      statusText={current.statusText}
      actions={current.actions}
      left={
        <>
          <div className="source-switcher">
            {SOURCES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`src-pill${activeSource === s.key ? ' src-pill--active' : ''}`}
                onClick={() => setActiveSource(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {current.left}
        </>
      }
      middle={current.middle}
      right={current.right}
    />
  );
}
```

Note: this step deliberately wires only the Banking MCP source's data into `current` (`const current = banking;`) — the `activeSource` state and the switcher UI already render all 3 pills, but selecting "PingOne MCP" or "API Calls" has no effect yet. Tasks 2 and 3 add those sources and make `current` actually switch. This step's own tests (Step 3) only exercise the Banking MCP source, which is why `activeSource` defaulting to `'banking'` is sufficient for them to pass.

- [ ] **Step 6: Add the source-switcher CSS**

The `.source-switcher`/`.src-pill`/`.src-pill--active` classnames referenced above don't exist yet. Add them to `demo_api_ui/src/components/shared/InspectorShell.css`, right after the existing `.inspector-shell-tree-header` rule:

```css
/* Source switcher — page-owned row above a source's own left-column
   content, for pages (like McpInspectorPage) that switch between several
   independent data sources inside one shell instance. Not part of
   InspectorShell.jsx itself — pages compose it into their own `left` slot. */
.source-switcher {
  display: flex;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid #cbd5e1;
}
.src-pill {
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  padding: 4px 10px;
  cursor: pointer;
  flex: 1;
}
.src-pill:hover { border-color: #94a3b8; }
.src-pill--active { background: rgba(37, 99, 235, 0.06); border-color: #2563eb; color: #2563eb; }
```

This is an addition to the shared stylesheet (not a change to any existing rule) — safe for the two other pages already using `InspectorShell.css` (`PingOneAuthorizePage.jsx`, `AgentGatewayTester.jsx`), since neither references `.source-switcher`/`.src-pill`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: PASS — 4 tests.

- [ ] **Step 8: Commit**

```bash
git branch --show-current   # confirm worktree-mcp-inspector-merge
git add demo_api_ui/src/components/McpInspectorPage.jsx \
        demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx \
        demo_api_ui/src/components/shared/InspectorShell.css
git commit -m "feat(mcp-inspector-page): add McpInspectorPage with Banking MCP source"
```

---

### Task 2: Add the PingOne MCP source

**Files:**
- Modify: `demo_api_ui/src/components/McpInspectorPage.jsx`
- Modify: `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`

**Interfaces:**
- Consumes: same shared components as Task 1.
- Produces: `McpInspectorPage` now switches between the Banking MCP and PingOne MCP sources; `activeSource === 'api'` still falls back to Banking MCP's data until Task 3.

- [ ] **Step 1: Verify `PingOneMcpInspector.js` still matches this plan's quotes**

Read `demo_api_ui/src/components/PingOneMcpInspector.js` in full (290 lines) and confirm it still matches what Step 3 below adapts. If it has drifted, STOP and report BLOCKED.

- [ ] **Step 2: Add the failing tests**

Append to `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx` (after the existing tests):

```jsx
const PINGONE_TOOL = { name: 'users.read', description: 'Fetch one PingOne user by id.', inputSchema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } };

function mockPingOneEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/pingone-tools') {
      return Promise.resolve({ data: { enabled: true, tools: [PINGONE_TOOL], paramDefaults: {} } });
    }
    return Promise.resolve({ data: {} });
  });
}

test('switching to the PingOne MCP source shows its tools and topbar status', async () => {
  mockPingOneEndpoints();
  render(<McpInspectorPage />);
  fireEvent.click(screen.getByRole('button', { name: 'PingOne MCP' }));
  expect(await screen.findByText('users.read')).toBeInTheDocument();
  expect(screen.getByText(/Connected — 1 tools/)).toBeInTheDocument();
});

test('calling a PingOne MCP tool posts to /api/mcp/inspector/pingone-invoke', async () => {
  mockPingOneEndpoints();
  apiClient.post.mockResolvedValueOnce({ data: { response: { id: '5e8e' }, request: {}, timingsMs: { roundTrip: 12 } } });
  render(<McpInspectorPage />);
  fireEvent.click(screen.getByRole('button', { name: 'PingOne MCP' }));
  fireEvent.click(await screen.findByText('users.read'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/pingone-invoke',
    { tool: 'users.read', params: { user_id: 'user-1' } },
  ));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: the 2 new tests FAIL (PingOne MCP source not wired yet); the 4 existing tests still PASS.

- [ ] **Step 4: Add the PingOne MCP source hook and switch `current` on `activeSource`**

In `demo_api_ui/src/components/McpInspectorPage.jsx`, add a second module-level `groupKey`/`GROUP_ORDER` pair (adapted from `PingOneMcpInspector.js`, renamed to avoid colliding with the Banking source's grouping helpers) directly after `groupBankingTools`:

```js
const isDavinciTool = (name) => name.includes('Davinci') || name.includes('davinci');

const pingoneGroupKey = (name) => {
  if (isDavinciTool(name)) return 'DaVinci';
  if (name.includes('Environment')) return 'Environments';
  if (name.includes('Application')) return 'Applications';
  if (name.includes('User')) return 'Users';
  if (name.includes('Population')) return 'Populations';
  return 'Other';
};

const PINGONE_GROUP_ORDER = ['Environments', 'Users', 'Applications', 'Populations', 'DaVinci', 'Other'];

const pingoneToolDot = (name) => {
  const lower = name.toLowerCase();
  if (lower.startsWith('create') || lower.startsWith('update') || lower.startsWith('delete') || lower.startsWith('manage')) return 'write';
  return 'default';
};
```

Then add a `usePingOneSource` function, directly after `useBankingSource`'s closing `}`:

```js
function usePingOneSource() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [calling, setCalling] = useState(false);
  const [lastCall, setLastCall] = useState(null);
  const [formError, setFormError] = useState(null);
  const [outputTab, setOutputTab] = useState('response');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/mcp/inspector/pingone-tools');
      setData(res.data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to query the PingOne MCP server'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enabled = data?.enabled;
  const tools = data?.tools || [];

  const groupedTools = useMemo(() => {
    const searchQ = toolSearch.trim().toLowerCase();
    const filtered = searchQ
      ? tools.filter((t) => t.name.toLowerCase().includes(searchQ) || (t.description || '').toLowerCase().includes(searchQ))
      : tools;
    const groups = {};
    for (const t of filtered) {
      const g = pingoneGroupKey(t.name);
      if (!groups[g]) groups[g] = [];
      groups[g].push(t);
    }
    return PINGONE_GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => ({ label: g, tools: groups[g] }));
  }, [tools, toolSearch]);

  const toggleLiveQuery = useCallback(async () => {
    setToggling(true);
    try {
      await apiClient.patch('/api/admin/feature-flags', { updates: { mcp_inspector_pingone_live: !enabled } });
      await refresh();
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to toggle live querying'));
    } finally {
      setToggling(false);
    }
  }, [enabled, refresh]);

  const selectTool = (tool) => {
    setSelectedTool(tool);
    const defaults = data?.paramDefaults || {};
    const props = tool.inputSchema?.properties || {};
    const seeded = {};
    for (const key of Object.keys(props)) { if (defaults[key]) seeded[key] = defaults[key]; }
    setParamValues(seeded);
    setFormError(null);
    setLastCall(null);
    setOutputTab('response');
  };

  const callTool = useCallback(async () => {
    if (!selectedTool) return;
    const props = selectedTool.inputSchema?.properties || {};
    const required = selectedTool.inputSchema?.required || [];
    const missing = required.filter((k) => !(paramValues[k] ?? '').trim());
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
    setCalling(true);
    try {
      const res = await apiClient.post('/api/mcp/inspector/pingone-invoke', { tool: selectedTool.name, params });
      setLastCall(res.data);
      setOutputTab('response');
    } catch (e) {
      notifyError(formatAxiosError(e, 'tools/call failed'));
      setLastCall(null);
    } finally {
      setCalling(false);
    }
  }, [selectedTool, paramValues]);

  const clearForm = () => { setParamValues({}); setFormError(null); setLastCall(null); };

  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  return {
    statusOn: !!enabled,
    statusText: enabled ? `Connected — ${tools.length} tools` : 'Disconnected',
    actions: (
      <>
        <button className="inspector-shell-topbar__btn" onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <button
          className={`inspector-shell-topbar__btn${enabled ? ' inspector-shell-topbar__btn--active' : ''}`}
          onClick={toggleLiveQuery}
          disabled={toggling}
        >
          {toggling ? 'Switching…' : enabled ? 'Live: ON' : 'Live: OFF'}
        </button>
      </>
    ),
    left: (
      <>
        <div className="inspector-shell-tree-header"><span>Tools ({tools.length})</span></div>
        <div className="inspector-shell-tree-search">
          <input
            type="search"
            placeholder="Filter tools…"
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="inspector-shell-tree-body">
          {groupedTools.map((group) => (
            <div key={group.label}>
              <div className="inspector-shell-tree-group__label">{group.label} ({group.tools.length})</div>
              {group.tools.map((t) => (
                <InspectorListItem
                  key={t.name}
                  label={t.name}
                  active={selectedTool?.name === t.name}
                  dot={pingoneToolDot(t.name)}
                  badges={pingoneToolDot(t.name) === 'write' ? ['write'] : []}
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
      </>
    ),
    middle: selectedTool ? (
      <>
        <div className="inspector-shell-form-header">
          <div className="inspector-shell-form-header__name">{selectedTool.name}</div>
          {selectedTool.description && <div className="inspector-shell-form-header__desc">{selectedTool.description}</div>}
        </div>
        <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
          <button className="inspector-shell-btn-call" onClick={callTool} disabled={calling || !enabled}>{calling ? 'Calling…' : 'Execute'}</button>
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
          <button className="inspector-shell-btn-call" onClick={callTool} disabled={calling || !enabled}>{calling ? 'Calling…' : 'Execute'}</button>
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
          tabs={[{ key: 'response', label: 'Response' }, { key: 'request', label: 'Request' }]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {lastCall ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code">
                <JsonHighlight value={outputTab === 'response' ? lastCall.response : lastCall.request} deep />
              </pre>
            </div>
            <div className="inspector-shell-output-footer">
              <span><strong>Status:</strong> {lastCall.error ? 'Error' : '200 OK'}</span>
              <span><strong>Duration:</strong> {lastCall.timingsMs?.roundTrip ?? '?'}ms</span>
              <span><strong>Transport:</strong> HTTP/SSE</span>
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
  const current = banking; // Steps in Tasks 2-3 add pingone/api and select based on activeSource.
```

to:

```js
  const banking = useBankingSource();
  const pingone = usePingOneSource();
  const current = activeSource === 'pingone' ? pingone : banking; // Task 3 adds the 'api' branch.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # confirm worktree-mcp-inspector-merge
git add demo_api_ui/src/components/McpInspectorPage.jsx \
        demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx
git commit -m "feat(mcp-inspector-page): add PingOne MCP source"
```

---

### Task 3: Add the API Calls source

**Files:**
- Modify: `demo_api_ui/src/components/McpInspectorPage.jsx`
- Modify: `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`

**Interfaces:**
- Consumes: same shared components as Tasks 1-2, plus the global `fetch` (this source uses `fetch` directly, not `apiClient` — matches `ApiExplorerPanel.js`).
- Produces: `McpInspectorPage` now fully switches between all 3 sources.

- [ ] **Step 1: Verify `ApiExplorerPanel.js` still matches this plan's quotes**

Read `demo_api_ui/src/components/ApiExplorerPanel.js` in full (267 lines) and confirm it still matches what Step 3 below adapts. If it has drifted, STOP and report BLOCKED.

- [ ] **Step 2: Add the failing tests**

Append to `demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx`:

```jsx
const CAPTURED_CALL = {
  id: 'c1', method: 'GET', url: '/api/accounts/acc_1', success: true,
  response: { status: 200, body: { balance: 100 } }, request: { headers: {} }, durationMs: 38,
};

function mockFetchForApiCalls() {
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'DELETE') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ calls: [CAPTURED_CALL], stats: { total: 1, success: 1, errors: 0 } }) });
  });
}

test('switching to the API Calls source shows captured calls', async () => {
  mockFetchForApiCalls();
  render(<McpInspectorPage />);
  fireEvent.click(screen.getByRole('button', { name: 'API Calls' }));
  expect(await screen.findByText('/api/accounts/acc_1')).toBeInTheDocument();
});

test('selecting a captured call shows its response body in read-only fields', async () => {
  mockFetchForApiCalls();
  render(<McpInspectorPage />);
  fireEvent.click(screen.getByRole('button', { name: 'API Calls' }));
  fireEvent.click(await screen.findByText('/api/accounts/acc_1'));
  expect(screen.getByDisplayValue('200')).toBeInTheDocument();
  expect(screen.getByText(/balance/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: the 2 new tests FAIL (API Calls source not wired yet); the 6 existing tests still PASS.

- [ ] **Step 4: Add the API Calls source hook and complete `current`'s switch**

In `demo_api_ui/src/components/McpInspectorPage.jsx`, add these module-level helpers directly after `pingoneToolDot`:

```js
const POLL_MS = 30000;

const apiMethodBadgeClass = (m) => `aep-method-badge aep-method-badge--${(m || 'GET').toUpperCase()}`;

const truncateUrl = (url, maxLen = 28) => {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + '…';
};
```

Then add a `useApiCallsSource` function, directly after `usePingOneSource`'s closing `}`. Its left-column rows deliberately do **not** use `InspectorListItem` (unlike the Banking MCP and PingOne MCP sources above) — a captured API call's row shows an HTTP method badge + truncated URL + status/duration, which doesn't fit `InspectorListItem`'s `dot`/`badges`/`label` shape (no dot color concept applies to an HTTP call, and the method badge is a different visual element than a write/sensitive tool badge). This matches the original design spec's own approved mock, which used a distinct "flat" row type for this source rather than forcing it through the shared tool-tree row component:

```js

```js
function useApiCallsSource() {
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
  const filteredCalls = search.trim()
    ? reversed.filter((c) => (c.url || '').toLowerCase().includes(search.trim().toLowerCase()) || (c.method || '').toLowerCase().includes(search.trim().toLowerCase()))
    : reversed;

  const selectedCall = selected;
  const status = selectedCall?.response?.status;
  const duration = selectedCall?.durationMs ?? selectedCall?.duration;

  return {
    statusOn: live,
    statusText: `${calls.length} calls ${live ? '- Live' : '- Paused'}`,
    actions: (
      <>
        <button className={`inspector-shell-topbar__btn${live ? ' inspector-shell-topbar__btn--active' : ''}`} onClick={() => setLive((v) => !v)}>{live ? 'Pause' : 'Live'}</button>
        <button className="inspector-shell-topbar__btn" onClick={handleClear}>Clear</button>
      </>
    ),
    left: (
      <>
        <div className="inspector-shell-tree-header">
          <span>Calls ({calls.length})</span>
          {stats && <span style={{ fontSize: 9, color: '#64748b' }}>{stats.success ?? stats.successful}ok / {stats.errors ?? stats.failed}err</span>}
        </div>
        <div className="inspector-shell-tree-search">
          <input type="search" placeholder="Filter calls..." value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
        </div>
        <div className="inspector-shell-tree-body">
          {filteredCalls.length === 0 ? (
            <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
              {calls.length === 0 ? 'No API calls yet. Use the AI agent or test pages to generate calls.' : `No calls match "${search}".`}
            </div>
          ) : filteredCalls.map((call) => (
            <button
              type="button"
              key={call.id}
              className={`inspector-shell-tree-item${selected?.id === call.id ? ' inspector-shell-tree-item--active' : ''}`}
              onClick={() => { setSelected((prev) => (prev?.id === call.id ? null : call)); setOutputTab('response'); }}
            >
              <span className={`inspector-shell-tree-item__dot${!call.success ? ' inspector-shell-tree-item__dot--sensitive' : ''}`} />
              <span className={apiMethodBadgeClass(call.method)}>{(call.method || 'GET').toUpperCase()}</span>
              <span style={{ fontSize: 11, color: '#475569' }}>{truncateUrl(call.url)}</span>
              {(call.durationMs ?? call.duration) != null && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#64748b' }}>{call.durationMs ?? call.duration}ms</span>}
            </button>
          ))}
        </div>
      </>
    ),
    middle: selectedCall ? (
      <>
        <div className="inspector-shell-form-header">
          <div className="inspector-shell-form-header__name">{(selectedCall.method || 'GET').toUpperCase()} Request</div>
          <div className="inspector-shell-form-header__desc">Inspect the selected API call details</div>
        </div>
        <div className="inspector-shell-form-body">
          <div className="inspector-shell-field"><label>URL</label><input type="text" value={selectedCall.url || ''} readOnly /></div>
          <div className="inspector-shell-field"><label>Method</label><input type="text" value={(selectedCall.method || 'GET').toUpperCase()} readOnly /></div>
          <div className="inspector-shell-field"><label>Status Code</label><input type="text" value={status != null ? String(status) : 'N/A'} readOnly /></div>
          <div className="inspector-shell-field"><label>Duration</label><input type="text" value={duration != null ? `${duration}ms` : 'N/A'} readOnly /></div>
        </div>
      </>
    ) : (
      <div className="inspector-shell-form-empty">Select an API call from the list to inspect its details.</div>
    ),
    right: (
      <>
        <InspectorTabs
          tabs={[{ key: 'response', label: 'Response Body' }, { key: 'request', label: 'Request Body' }, { key: 'headers', label: 'Headers' }]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {selectedCall ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code">
                {outputTab === 'response' && (selectedCall.response?.body ? <JsonHighlight value={selectedCall.response.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No response body captured</span>)}
                {outputTab === 'request' && (selectedCall.request?.body ? <JsonHighlight value={selectedCall.request.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No request body</span>)}
                {outputTab === 'headers' && (selectedCall.request?.headers && Object.keys(selectedCall.request.headers).length > 0 ? <JsonHighlight value={selectedCall.request.headers} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No headers captured</span>)}
              </pre>
            </div>
            <div className="inspector-shell-output-footer">
              <span><strong>Status:</strong> {status != null ? status : 'N/A'}</span>
              <span><strong>Duration:</strong> {duration != null ? `${duration}ms` : 'N/A'}</span>
              <span><strong>Transport:</strong> HTTP</span>
            </div>
          </>
        ) : (
          <div className="inspector-shell-output-empty">Select an API call to view its response, request body, and headers.</div>
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
  const current = activeSource === 'pingone' ? pingone : banking; // Task 3 adds the 'api' branch.
```

to:

```js
  const banking = useBankingSource();
  const pingone = usePingOneSource();
  const api = useApiCallsSource();
  const current = activeSource === 'pingone' ? pingone : activeSource === 'api' ? api : banking;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: PASS — 8 tests.

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
git commit -m "feat(mcp-inspector-page): add API Calls source, complete the merge"
```

---

### Task 4: Wire routing and nav

**Files:**
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/routes/MonitoringRoutes.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`

**Interfaces:**
- Consumes: `McpInspectorPage` (default export, no props) from Task 1-3.
- Produces: no exports — only routing/nav wiring changes.

- [ ] **Step 1: Verify the three route/nav locations still match this plan's quotes**

Re-read the relevant lines of `App.js` (the `/mcp-inspector` and `/pingone-mcp-inspector` routes), `MonitoringRoutes.js` (the `api-explorer` route), and `AdminSideNav.jsx` (the three nav entries: "Generic MCP Inspector", "PingOne MCP Inspector", "API Explorer") to confirm they still match. If any has drifted (this area of the codebase has had real routing churn this session), STOP and report BLOCKED with specifics.

- [ ] **Step 2: Swap the `/pingone-mcp-inspector` route to the new page, redirect `/mcp-inspector`**

In `demo_api_ui/src/App.js`, add an import near the other component imports:

```js
import McpInspectorPage from "./components/McpInspectorPage";
```

Change the `/pingone-mcp-inspector` route from:

```jsx
                            <Route
                              path="/pingone-mcp-inspector"
                              element={
                                <PingOneMcpInspector
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
```

to:

```jsx
                            <Route
                              path="/pingone-mcp-inspector"
                              element={<McpInspectorPage />}
                            />
```

Change the `/mcp-inspector` route from:

```jsx
                            <Route
                              path="/mcp-inspector"
                              element={
                                <McpInspector user={user} onLogout={logout} />
                              }
                            />
```

to:

```jsx
                            <Route
                              path="/mcp-inspector"
                              element={<Navigate to="/pingone-mcp-inspector" replace />}
                            />
```

Leave the `McpInspector`/`PingOneMcpInspector` import lines at the top of `App.js` in place if anything else in the file still references them — check with `grep -n "McpInspector\b\|PingOneMcpInspector\b" demo_api_ui/src/App.js` after this edit; if the only remaining reference to either is its own now-unused import line, remove that one import line (but not the component files themselves — they're still used by `McpGatewayConfig.jsx`/routed nowhere-else logic per this plan's scope, and by nothing in `App.js` once these two routes change). Do not remove the `PingOneMcpInspector`/`McpInspector` component *files* — only their now-dead imports in this one file, if genuinely unused after this step.

- [ ] **Step 3: Redirect `/monitoring/api-explorer`**

In `demo_api_ui/src/routes/MonitoringRoutes.js`, change:

```jsx
        <Route path="api-explorer" element={<ApiExplorerPanel />} />
```

to:

```jsx
        <Route path="api-explorer" element={<Navigate to="/pingone-mcp-inspector" replace />} />
```

Add `Navigate` to this file's `react-router-dom` import if it isn't already imported (check the top of the file first — `useSearchParams`-style route files in this repo typically already import `Navigate` for similar redirects elsewhere in the same file; if not, add it to the existing `import { ... } from "react-router-dom";` line). Remove the `ApiExplorerPanel` import from this file only if `grep -n "ApiExplorerPanel"` on the file shows no other reference after this change (do not touch `ApiExplorerPanel.js` itself).

- [ ] **Step 4: Update `AdminSideNav.jsx`**

Delete the "Generic MCP Inspector" entry from the "Banking MCP & Gateways" group's `children` array:

```jsx
        {
          label: "Generic MCP Inspector",
          path: "/mcp-inspector",
          icon: "dbg",
        },
```

Delete the "API Explorer" entry from the "Monitoring" group's `children` array:

```jsx
        {
          label: "API Explorer",
          path: "/monitoring/api-explorer",
          icon: "api",
        },
```

Rename the "PingOne MCP Inspector" entry in the "PingOne MCP" group's `children` array — change:

```jsx
          label: "PingOne MCP Inspector",
          path: "/pingone-mcp-inspector",
```

to:

```jsx
          label: "MCP Inspector",
          path: "/pingone-mcp-inspector",
```

(the `path` doesn't change — the route it points to now renders `McpInspectorPage` instead of `PingOneMcpInspector`, per Step 2 — only the nav label changes, since this entry now leads to the merged page, not a PingOne-only one).

Update `AUTO_EXPAND_SECTIONS` (`AdminSideNav.jsx:148-149`) so the two retired paths (`/mcp-inspector`) don't linger in a group's auto-expand list once that entry no longer exists there — change:

```js
  { id: "banking-mcp-gateways", paths: ["/pinggateway-inspector", "/pinggateway-test", "/mcp-traffic", "/token-security"] },
```

Confirm this exact line no longer lists `/mcp-inspector` (per the survey, it doesn't — this line already only has the four paths shown; if `/mcp-inspector` is present when you check, remove it as part of this step). No change needed for the `pingone-mcp` entry's `paths` array — `/pingone-mcp-inspector` stays exactly as it is (same route, same nav group).

- [ ] **Step 5: Run the full affected test suite**

```bash
npx vitest run src/components/shared/__tests__/ src/components/__tests__/PingOneAuthorizePage.test.jsx src/components/__tests__/AgentGatewayTester.test.jsx src/components/__tests__/McpInspectorPage.test.jsx
```

Expected: PASS — 42 tests total (34 from the prior two conversions + 8 new).

- [ ] **Step 6: Run the UI build gate**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # confirm worktree-mcp-inspector-merge
git add demo_api_ui/src/App.js \
        demo_api_ui/src/routes/MonitoringRoutes.js \
        demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat(mcp-inspector-page): redirect old routes, update nav"
```

---

## What this plan does not do

- Does not modify or delete `McpInspector.js`, `PingOneMcpInspector.js`, or `ApiExplorerPanel.js` — all three stay exactly as they are, still used by their existing embeds (`McpGatewayConfig.jsx`'s "Tool Calls" tab, `DevToolsDashboard.jsx`'s "API Explorer" tab) and by nothing else once their top-level routes redirect.
- Does not carry `McpInspector.js`'s server-profile picker (custom websocket/http/stdio servers, PingOne-admin-login flow, "+ Add server") into the new page's Banking MCP source — a deliberate, human-confirmed scope decision (see Architecture, scope correction 1), not an oversight. If that capability is still wanted somewhere, it remains available at `McpInspector.js`'s own still-live route/embeds — this plan doesn't remove it from the app, just doesn't duplicate it into the new page.
- Does not add a `PageNav` (Back/Home breadcrumb bar) to the new page — matches the route it's replacing (`/pingone-mcp-inspector`, which never had one) and the other two already-merged `InspectorShell` pages, neither of which has one either.
- Does not touch `McpGatewayConfig.jsx` or `DevToolsDashboard.jsx` — their embeds of the three original files are unaffected.
- This is the fourth and final plan in the InspectorShell conversion series per the design spec's migration order.
