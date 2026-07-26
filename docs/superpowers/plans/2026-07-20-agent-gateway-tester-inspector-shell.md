# AgentGatewayTester → InspectorShell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `demo_api_ui/src/components/AgentGatewayTester.jsx` from its hand-rolled `p1mcp-*` topbar+grid markup onto the shared `InspectorShell` component (built and merged in an earlier plan), matching the same pattern already applied to `PingOneAuthorizePage.jsx`.

**Architecture:** This is a straight classname-and-structure conversion, not a restructuring — `AgentGatewayTester` already has exactly the topbar + 3-column shape `InspectorShell` was built for (tool tree left, param form middle, tabbed output right), unlike `PingOneAuthorizePage` which needed real content reshuffling. Every `p1mcp-*` classname becomes its `inspector-shell-*` equivalent (already defined in `InspectorShell.css`, a straight rename with no new CSS needed), the hand-rolled topbar+grid `<div>`s become `<InspectorShell>`'s `actions`/`left`/`middle`/`right` slots, and the hand-rolled output-tab button loop becomes `<InspectorTabs>`. All state, all data fetching, all handlers stay exactly as they are — this task touches only the return statement's structure and classnames, plus one helper function's return strings.

**Scope correction found during this plan's research (before any code was touched):** the original design spec assumed this component was reached via its own dedicated route (`/pinggateway-test`) with its own `AdminSideNav` entry ("PingGateway Test"). Neither exists anymore — an unrelated, already-merged commit from a different session redirected `/pinggateway-test` to `/pinggateway-inspector?subtab=tester` and folded this component in as one of 10 tabs inside a new consolidated `McpGatewayConfig.jsx` admin page (`<div className="mgc-panel"><AgentGatewayTester /></div>`, tab label "Gateway Tester"). Net effect: **this plan needs zero routing or nav changes** — there is nothing left to touch there. It does mean `AgentGatewayTester` now renders embedded mid-page (inside `.mgc-panel`, which has no fixed height — `display:flex; flex-direction:column; gap:24px`) rather than as a full-page route, so — same as the `PingOneAuthorizePage` conversion — it needs `fullHeight={false}` on its `<InspectorShell>` call, not the default `true`.

**Tech Stack:** React 18, Vitest + `@testing-library/react` + `@testing-library/jest-dom`, `vi.mock('../services/apiClient', ...)` per this repo's established pattern (see `demo_api_ui/src/components/AuthzTestPage.sections.test.jsx`) — this file uses `apiClient`, not `bffAxios` (the service the two prior InspectorShell conversions used).

## Global Constraints

- **Worktree required.** All work happens in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/agent-gateway-tester-inspector-shell`, branch `worktree-agent-gateway-tester-inspector-shell`. Confirm with `git branch --show-current` before each commit.
- **Protected UI area.** `demo_api_ui` is covered by `REGRESSION_PLAN.md` §1. Invoke `regression-guard` before the first edit. State what will not break: `AgentGatewayTester.jsx` has exactly one consumer, `McpGatewayConfig.jsx`'s "tester" tab (verified via `grep -rln AgentGatewayTester demo_api_ui/src` — only `AgentGatewayTester.jsx` itself and `McpGatewayConfig.jsx` reference it; no route imports it directly anymore). This task changes neither `McpGatewayConfig.jsx` nor any route/nav file.
- **Given how much concurrent activity has hit this exact area of the codebase this session** (the `/pinggateway-test` → `McpGatewayConfig` consolidation happened between this plan's initial scoping and its drafting), **re-verify the live file's content matches this plan's quoted "current" text immediately before editing** — do not assume the research above is still accurate by the time implementation starts.
- **Emoji allowlist** (`REGRESSION_PLAN.md` §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` permitted. The current file contains none — don't introduce any.
- **Stage explicitly.** `git add <exact files>`, never `git add -A`.
- **Depends on the InspectorShell plan.** `InspectorShell`, `InspectorTabs` (`demo_api_ui/src/components/shared/InspectorShell.jsx`, `InspectorTabs.jsx`) must exist on `main` — they do, merged and further extended (the `fullHeight` prop, needed by this plan) in the `PingOneAuthorizePage` conversion plan.
- **UI build gate.** `npm run build` inside `demo_api_ui/` must succeed before this plan is done (final step of Task 1).
- **No behavior change.** Every handler, every fetch call, every piece of state stays byte-identical — only classnames and JSX structure change. `toolDotClass`'s two non-empty return strings change from `p1mcp-*` to `inspector-shell-*` (they're used directly as classNames), which is itself just the same rename applied inside a helper function, not a behavior change.

---

## File Structure

| File | Change |
|---|---|
| `demo_api_ui/src/components/AgentGatewayTester.jsx` | Imports, `toolDotClass`'s return strings, and the entire return statement rewritten onto `InspectorShell`/`InspectorTabs`. No state, handlers, or data-fetching logic touched. |
| `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx` | **New.** Component had zero test coverage before this plan. |

No other file is modified.

---

### Task 1: Convert `AgentGatewayTester` onto `InspectorShell`

**Files:**
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx`
- Create: `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`

**Interfaces:**
- Consumes: `InspectorShell({title, statusOn, statusText, actions, fullHeight, left, middle, right})` and `InspectorTabs({tabs, activeKey, onChange})` from `demo_api_ui/src/components/shared/InspectorShell.jsx` / `InspectorTabs.jsx` (already on `main`).
- Produces: no new exports — `AgentGatewayTester`'s default export and its rendered output are what change. `McpGatewayConfig.jsx` (the sole consumer) renders `<AgentGatewayTester />` with no props today and will continue to — this task does not add or require any new props on the component itself.

- [ ] **Step 1: Invoke regression-guard**

Before any edit, invoke the `regression-guard` skill. State: this task's blast radius is `AgentGatewayTester.jsx`'s own rendering only, reached solely through `McpGatewayConfig.jsx`'s "tester" tab — no route, nav, or sibling-component change.

- [ ] **Step 2: Verify the live file still matches this plan**

Read `demo_api_ui/src/components/AgentGatewayTester.jsx` in full (773 lines) and confirm it still matches what this plan quotes below — in particular the exact line ranges for imports (1-9), `toolDotClass` (99-104), and the full return statement (328-773). If it has drifted, STOP and report BLOCKED with specifics rather than adapting on the fly — this exact kind of drift has happened twice already this session on a sibling conversion.

- [ ] **Step 3: Write the failing tests**

Create `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`:

```jsx
// demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import AgentGatewayTester from '../AgentGatewayTester';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const ACTIVE_GATEWAY = { name: 'Demo Agent Gateway', authzBackend: 'simulated', usePingGateway: false, simulated: true, url: 'http://gateway.local' };

function mockDefaultEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp-gateway/rate-limit-status') return Promise.resolve({ data: { aligned: false, rateLimitLayer: 'off', bffFlag: false } });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({ data: { tools: [], _source: 'static' } });
    if (url === '/api/authorize/rules') return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDefaultEndpoints();
});

test('renders the topbar title and status text once the gateway loads', async () => {
  render(<AgentGatewayTester />);
  expect(screen.getByRole('heading', { name: 'Agent Gateway Tester' })).toBeInTheDocument();
  expect(await screen.findByText('Demo Agent Gateway | Authz: simulated')).toBeInTheDocument();
});

test('toggles between Tools and Config sub-tabs in the left column', async () => {
  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  // The Config section is conditionally rendered (not just CSS-hidden) until
  // clicked — queryByText/toBeNull, not getByText/not.toBeVisible.
  expect(screen.queryByText('Demo Presets')).toBeNull();
  // "Config" is only reachable once the tools list has rendered at least once.
  fireEvent.click(screen.getByText('Config'));
  expect(screen.getByText('Demo Presets')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Tools'));
  expect(screen.queryByText('Demo Presets')).toBeNull();
});

test('selecting a tool populates the middle form with its name and an argument template', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: { tools: [{ name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } }], _source: 'live' },
    });
    return Promise.resolve({ data: {} });
  });
  render(<AgentGatewayTester />);
  const toolRow = await screen.findByText('get_account_balance');
  fireEvent.click(toolRow);
  expect(screen.getByText('Get balance.')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: '' }, null, 2));
});

test('shows the empty-state message before any tool is selected or executed', async () => {
  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  expect(screen.getByText('Select a tool from the tree to send through the Agent Gateway.')).toBeInTheDocument();
  expect(screen.getByText('Select a tool, then execute it to see results.')).toBeInTheDocument();
});

test('clicking Execute posts to /api/mcp-gateway/test with the tool name and parsed args, shows the result', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: { tools: [{ name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } }], _source: 'live' },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({ data: { ok: true, result: { accounts: [] }, durationMs: 42 } });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  // Two "Execute" buttons exist (top and bottom action bars, pre-existing —
  // both call the same send handler) — getAllByRole, click either.
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp-gateway/test',
    { tool: 'get_my_accounts', args: {} },
  ));
  expect(await screen.findByText('200 OK')).toBeInTheDocument();
});

test('clicking Refresh in the topbar actions re-fetches gateway state', async () => {
  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  const callsBefore = apiClient.get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(apiClient.get.mock.calls.length).toBeGreaterThan(callsBefore));
  expect(apiClient.get).toHaveBeenCalledWith('/api/mcp-gateway/active');
});
```

- [ ] **Step 4: Run the tests to verify they fail**

From `demo_api_ui/`:

```bash
npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx
```

Expected: FAIL — the component still renders `p1mcp-*`-classed markup, but more fundamentally these tests are asserting against post-conversion text/structure that doesn't exist as such yet (e.g. the component renders fine today, so some assertions may pass already — that's fine, this is a refactor not new-feature TDD; what matters is Step 6 below leaves all 6 green). If every test already passes before any edit, that's a signal the test file doesn't actually exercise anything conversion-specific — re-check before proceeding rather than treating it as a shortcut.

- [ ] **Step 5: Update imports and `toolDotClass`**

In `demo_api_ui/src/components/AgentGatewayTester.jsx`, change the import block (lines 1-9) from:

```js
// AgentGatewayTester.jsx
// Dark IDE three-column layout (Mock B) - sends MCP tool calls through the
// active gateway and shows response, authorize decision, audit trail.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import JsonHighlight from './shared/JsonHighlight';
import './PingOneMcpInspector.css';
```

to:

```js
// AgentGatewayTester.jsx
// InspectorShell three-column layout - sends MCP tool calls through the
// active gateway and shows response, authorize decision, audit trail.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
```

Change `toolDotClass` (lines 99-104) from:

```js
const toolDotClass = (name) => {
  const lower = name.toLowerCase();
  if (lower.includes('sensitive')) return 'p1mcp-tree-item__dot--sensitive';
  if (lower.startsWith('create') || lower.includes('transfer')) return 'p1mcp-tree-item__dot--write';
  return '';
};
```

to:

```js
const toolDotClass = (name) => {
  const lower = name.toLowerCase();
  if (lower.includes('sensitive')) return 'inspector-shell-tree-item__dot--sensitive';
  if (lower.startsWith('create') || lower.includes('transfer')) return 'inspector-shell-tree-item__dot--write';
  return '';
};
```

- [ ] **Step 6: Replace the return statement**

Replace the entire `return (...)` block (from `return (\n    <div className="p1mcp-page">` through the matching closing `\n  );\n}` that ends the component) with:

```jsx
  return (
    <InspectorShell
      title="Agent Gateway Tester"
      statusOn={!!active}
      statusText={active ? `${active.name} | Authz: ${active.authzBackend}` : 'Loading...'}
      fullHeight={false}
      actions={
        <>
          <button
            className="inspector-shell-topbar__btn"
            onClick={() => { fetchActive(); fetchTools(); fetchRules(); fetchRateStatus(); }}
          >
            Refresh
          </button>
          <button
            className="inspector-shell-topbar__btn"
            disabled={toggling === GATEWAY_FLAG || !active}
            onClick={() => toggleFlag(GATEWAY_FLAG, usePing)}
          >
            {toggling === GATEWAY_FLAG ? 'Switching...' : `Switch to ${usePing ? 'Demo' : 'PingOne'} GW`}
          </button>
          <button
            className="inspector-shell-topbar__btn"
            disabled={toggling === AUTHZ_FLAG || !active}
            onClick={() => toggleFlag(AUTHZ_FLAG, simulated)}
          >
            {toggling === AUTHZ_FLAG ? 'Switching...' : `Authz: ${simulated ? 'simulated' : 'real'}`}
          </button>
        </>
      }
      left={
        <>
          <div className="inspector-shell-tree-header">
            <span>
              <button
                className={`inspector-shell-topbar__btn ${treeSection === 'tools' ? 'inspector-shell-topbar__btn--active' : ''}`}
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={() => setTreeSection('tools')}
              >Tools</button>
              {' '}
              <button
                className={`inspector-shell-topbar__btn ${treeSection === 'config' ? 'inspector-shell-topbar__btn--active' : ''}`}
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={() => setTreeSection('config')}
              >Config</button>
            </span>
          </div>
          {treeSection === 'tools' && (
            <>
              <div className="inspector-shell-tree-search">
                <input
                  type="search"
                  placeholder="Filter tools..."
                  value={toolSearch}
                  onChange={e => setToolSearch(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="inspector-shell-tree-body">
                {groupedTools.map(group => (
                  <div className="inspector-shell-tree-group" key={group.label}>
                    <div className="inspector-shell-tree-group__label">{group.label} ({group.tools.length})</div>
                    {group.tools.map(t => (
                      <div
                        key={t.name}
                        className={`inspector-shell-tree-item ${selectedTool?.name === t.name ? 'inspector-shell-tree-item--active' : ''}`}
                        onClick={() => selectTool(t)}
                      >
                        <span className={`inspector-shell-tree-item__dot ${toolDotClass(t.name)}`} />
                        <span>{t.name}</span>
                        {toolDotClass(t.name).includes('write') && (
                          <span className="inspector-shell-tree-item__badge inspector-shell-tree-item__badge--write">W</span>
                        )}
                        {toolDotClass(t.name).includes('sensitive') && (
                          <span className="inspector-shell-tree-item__badge inspector-shell-tree-item__badge--sensitive">S</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {groupedTools.length === 0 && (
                  <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
                    {tools.length === 0 ? 'No tools loaded.' : `No tools match "${toolSearch}".`}
                  </div>
                )}
                <div style={{ padding: '8px 16px', fontSize: 10, color: '#475569' }}>
                  Source: {toolsSource}
                </div>
              </div>
            </>
          )}
          {treeSection === 'config' && (
            <div className="inspector-shell-tree-body">
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">Gateway</div>
                <div className="inspector-shell-tree-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, cursor: 'default' }}>
                  <span style={{ fontSize: 11, color: '#475569' }}>Active: {active?.name || '...'}</span>
                  {active?.url && <code style={{ fontSize: 10, color: '#64748b' }}>{active.url}</code>}
                </div>
              </div>
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">Rate Limiting (UC18)</div>
                {rateStatus && (
                  <>
                    <div className="inspector-shell-tree-item" style={{ cursor: 'default', fontSize: 11 }}>
                      <span className="inspector-shell-tree-item__dot" style={{ background: rateStatus.aligned ? '#22c55e' : '#ef4444' }} />
                      <span>Layer: {rateStatus.rateLimitLayer || 'off'}</span>
                    </div>
                    <div className="inspector-shell-tree-item" style={{ cursor: 'default', fontSize: 11 }}>
                      <span className="inspector-shell-tree-item__dot" style={{ background: rateStatus.bffFlag ? '#22c55e' : '#64748b' }} />
                      <span>BFF flag: {rateStatus.bffFlag ? 'ON' : 'OFF'}</span>
                    </div>
                    <div className="inspector-shell-tree-item" style={{ cursor: 'default', fontSize: 11 }}>
                      <span className="inspector-shell-tree-item__dot" style={{ background: rateStatus.aligned ? '#22c55e' : '#f59e0b' }} />
                      <span>Aligned: {rateStatus.aligned ? 'YES' : 'NO'}</span>
                    </div>
                  </>
                )}
                <div
                  className="inspector-shell-tree-item"
                  onClick={toggleUc18Demo}
                  style={{ color: uc18Busy ? '#475569' : '#3b82f6', fontSize: 11 }}
                >
                  <span className="inspector-shell-tree-item__dot" style={{ background: '#3b82f6' }} />
                  <span>{uc18Busy ? 'Updating...' : (rateStatus?.aligned ? 'Disable UC18' : 'Enable UC18')}</span>
                </div>
                <div
                  className="inspector-shell-tree-item"
                  onClick={() => !bursting && selectedTool && rateStatus?.aligned && runBurst()}
                  style={{ color: (!selectedTool || !rateStatus?.aligned || bursting) ? '#475569' : '#3b82f6', fontSize: 11 }}
                >
                  <span className="inspector-shell-tree-item__dot" style={{ background: '#f59e0b' }} />
                  <span>{bursting ? 'Running...' : 'Burst test (5 calls)'}</span>
                </div>
              </div>
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">Demo Presets</div>
                {PRESETS.map(p => (
                  <div
                    key={p.id}
                    className="inspector-shell-tree-item"
                    onClick={() => !presetBusy && runPreset(p.id)}
                    style={{ color: presetBusy ? '#475569' : '#3b82f6', fontSize: 11 }}
                  >
                    <span className="inspector-shell-tree-item__dot" style={{ background: '#8b5cf6' }} />
                    <span>{presetBusy === p.id ? 'Applying...' : p.label}</span>
                  </div>
                ))}
              </div>
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">RFC 9728 Metadata</div>
                <div
                  className="inspector-shell-tree-item"
                  onClick={() => !metadataLoading && fetchMetadata()}
                  style={{ color: metadataLoading ? '#475569' : '#3b82f6', fontSize: 11 }}
                >
                  <span className="inspector-shell-tree-item__dot" style={{ background: '#06b6d4' }} />
                  <span>{metadataLoading ? 'Fetching...' : 'Fetch live metadata'}</span>
                </div>
                {metadata && Object.entries(metadata).map(([key, data]) => (
                  <div key={key} className="inspector-shell-tree-item" style={{ cursor: 'default', fontSize: 10 }}>
                    <span className="inspector-shell-tree-item__dot" style={{ background: data?._status === 'ok' ? '#22c55e' : '#ef4444' }} />
                    <span>{key}: {data?._status || 'unknown'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      }
      middle={
        selectedTool ? (
          <>
            <div className="inspector-shell-form-header">
              <div className="inspector-shell-form-header__name">{selectedTool.name}</div>
              {selectedTool.description && (
                <div className="inspector-shell-form-header__desc">{selectedTool.description}</div>
              )}
            </div>
            <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
              <button className="inspector-shell-btn-call" onClick={send} disabled={sending}>
                {sending ? 'Sending...' : 'Execute'}
              </button>
              <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
            </div>
            <div className="inspector-shell-form-body">
              <div className="inspector-shell-field">
                <label>
                  Arguments (JSON)
                  <span className="type">object</span>
                </label>
                <textarea
                  value={argsText}
                  onChange={e => setArgsText(e.target.value)}
                  placeholder='{}'
                  spellCheck={false}
                  rows={6}
                  style={{ fontFamily: "'SF Mono', monospace" }}
                />
              </div>
              {active && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.6 }}>
                  <div>Gateway: <strong style={{ color: '#334155' }}>{active.name}</strong></div>
                  <div>Authorize: <strong style={{ color: '#334155' }}>{active.authzBackend}</strong></div>
                  {active.url && <div>URL: <code style={{ fontSize: 10 }}>{active.url}</code></div>}
                </div>
              )}
            </div>
            <div className="inspector-shell-form-actions">
              <button className="inspector-shell-btn-call" onClick={send} disabled={sending}>
                {sending ? 'Sending...' : 'Execute'}
              </button>
              <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
              {rateStatus?.aligned && (
                <button
                  className="inspector-shell-btn-clear"
                  onClick={runBurst}
                  disabled={bursting}
                  style={{ marginLeft: 'auto' }}
                >
                  {bursting ? 'Burst...' : 'Burst x5'}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="inspector-shell-form-empty">
            Select a tool from the tree to send through the Agent Gateway.
          </div>
        )
      }
      right={
        <>
          <InspectorTabs
            tabs={[
              { key: 'result', label: 'Result' },
              { key: 'audit', label: 'Audit Trail' },
              { key: 'authorize', label: 'Authorize Decision' },
              { key: 'mcpAudit', label: 'McpAudit (5W1H)' },
            ]}
            activeKey={outputTab}
            onChange={setOutputTab}
          />
          {resp ? (
            <>
              <div className="inspector-shell-output-body">
                <pre className="inspector-shell-output-code">
                  {outputTab === 'result' && <JsonHighlight value={resultValue} />}
                  {outputTab === 'audit' && (
                    <JsonHighlight value={resp.gwAuditTrail || { note: 'No audit trail on this response.' }} />
                  )}
                  {outputTab === 'authorize' && (
                    <>
                      {az ? (
                        <div style={{ padding: '0 0 16px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'SF Mono', monospace" }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #cbd5e1' }}>
                                <th style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600 }}>P1AZ Field</th>
                                <th style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600 }}>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {az.decision && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>Decision</td>
                                  <td style={{ padding: '5px 10px', color: az.decision === 'PERMIT' ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{az.decision}</td>
                                </tr>
                              )}
                              {az.toolName && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>ToolName</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.toolName}</td>
                                </tr>
                              )}
                              {az.clientId && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>ClientId</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.clientId}</td>
                                </tr>
                              )}
                              {az.actClientId && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>ActClientId</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.actClientId}</td>
                                </tr>
                              )}
                              {az.userId && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>UserId</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.userId}</td>
                                </tr>
                              )}
                              {az.scopes && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>Scopes</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{Array.isArray(az.scopes) ? az.scopes.join(', ') : String(az.scopes)}</td>
                                </tr>
                              )}
                              {az.riskLevel && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>RiskLevel</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.riskLevel}</td>
                                </tr>
                              )}
                              {az.policyId && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>PolicyId</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.policyId}</td>
                                </tr>
                              )}
                              {az.reason && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>Reason</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.reason}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                          <div style={{ marginTop: 12, borderTop: '1px solid #cbd5e1', paddingTop: 12 }}>
                            <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raw JSON</div>
                            <JsonHighlight value={az} />
                          </div>
                        </div>
                      ) : (
                        <JsonHighlight value={{ note: 'No authorize decision on this response.' }} />
                      )}
                    </>
                  )}
                  {outputTab === 'mcpAudit' && (
                    <>
                      {mcpAudit ? (
                        <div style={{ padding: '0 0 16px' }}>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
                            <strong style={{ color: '#1e293b' }}>McpAuditFilter 5W1H</strong> - Structured audit event capturing Who, What, When, Where, Why, and How.
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'SF Mono', monospace" }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #cbd5e1' }}>
                                <th style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600 }}>5W1H</th>
                                <th style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600 }}>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {mcpAudit.who && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>Who</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.who === 'object' ? JSON.stringify(mcpAudit.who) : mcpAudit.who}</td>
                                </tr>
                              )}
                              {mcpAudit.what && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>What</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.what === 'object' ? JSON.stringify(mcpAudit.what) : mcpAudit.what}</td>
                                </tr>
                              )}
                              {mcpAudit.when && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>When</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.when === 'object' ? JSON.stringify(mcpAudit.when) : mcpAudit.when}</td>
                                </tr>
                              )}
                              {mcpAudit.where && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>Where</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.where === 'object' ? JSON.stringify(mcpAudit.where) : mcpAudit.where}</td>
                                </tr>
                              )}
                              {mcpAudit.why && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>Why</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.why === 'object' ? JSON.stringify(mcpAudit.why) : mcpAudit.why}</td>
                                </tr>
                              )}
                              {mcpAudit.how && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>How</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.how === 'object' ? JSON.stringify(mcpAudit.how) : mcpAudit.how}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                          <div style={{ marginTop: 12, borderTop: '1px solid #cbd5e1', paddingTop: 12 }}>
                            <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raw JSON</div>
                            <JsonHighlight value={mcpAudit} />
                          </div>
                        </div>
                      ) : (
                        <JsonHighlight value={{ note: 'No McpAudit event. Ensure McpAuditFilter is active in PingGateway.' }} />
                      )}
                    </>
                  )}
                </pre>
              </div>
              <div className="inspector-shell-output-footer">
                <span>
                  <strong>Status:</strong>{' '}
                  {resp.clientError
                    ? 'Error'
                    : isRateLimited
                      ? '429 Rate Limited'
                      : resp.ok
                        ? '200 OK'
                        : `Error: ${resp.error || 'unknown'}`}
                </span>
                <span><strong>Duration:</strong> {resp.durationMs ?? '?'}ms</span>
                <span><strong>Decision:</strong> {decision || 'N/A'}</span>
                <span><strong>Gateway:</strong> {resp.gateway?.name || active?.name || '?'}</span>
              </div>
            </>
          ) : burstResp ? (
            <>
              <div className="inspector-shell-output-body">
                <pre className="inspector-shell-output-code">
                  <JsonHighlight value={burstResp} />
                </pre>
              </div>
              <div className="inspector-shell-output-footer">
                <span><strong>Burst test:</strong> {burstResp.summary || `${(burstResp.results || []).length} calls`}</span>
              </div>
            </>
          ) : (
            <div className="inspector-shell-output-empty">
              {selectedTool
                ? 'Click Execute to send through the gateway and see results here.'
                : 'Select a tool, then execute it to see results.'}
            </div>
          )}
        </>
      }
    />
  );
}
```

Everything inside this block is content-identical to what's in the file today — the `p1mcp-*` → `inspector-shell-*` renames, the container change from hand-rolled `<div className="p1mcp-page">`/`<div className="p1mcp-grid">` to `<InspectorShell>`'s slot props, and the output-tab button loop → `<InspectorTabs>` swap are the only structural changes. The two large `authorize`/`mcpAudit` result tables, every handler reference, every inline style object, and every conditional are byte-for-byte the same JSX, just re-indented one level to sit inside a slot prop instead of a `<div>`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run src/components/__tests__/AgentGatewayTester.test.jsx
```

Expected: PASS — 6 tests.

- [ ] **Step 8: Run the UI build gate**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git branch --show-current   # confirm worktree-agent-gateway-tester-inspector-shell
git add demo_api_ui/src/components/AgentGatewayTester.jsx \
        demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx
git commit -m "feat(agent-gateway-tester): convert onto InspectorShell"
```

---

## What this plan does not do

- Does not touch `McpGatewayConfig.jsx` — `AgentGatewayTester`'s sole consumer renders it exactly as before (`<AgentGatewayTester />`, no props), and this task doesn't change that call site since the component's default export and prop contract (none) are unchanged.
- Does not touch routing or `AdminSideNav.jsx` — there is nothing left to touch; the `/pinggateway-test` route and its nav entry no longer exist as of an already-merged, unrelated commit (see this plan's Architecture section).
- Does not touch `McpInspector.jsx`, `PingOneMcpInspector.jsx`, or `ApiExplorerPanel.js` — the merge of those three into one `McpInspectorPage` is the next and final plan per the design spec's migration order. Worth noting for that plan's own research: `McpInspector.jsx` is now *also* embedded inside `McpGatewayConfig.jsx` (as its "toolcalls" tab, alongside `AgentGatewayTester`'s "tester" tab) — the same kind of routing consolidation that affected this plan.
