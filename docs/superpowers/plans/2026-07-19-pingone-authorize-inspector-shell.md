# PingOneAuthorizePage → InspectorShell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the "Evaluate" section of `demo_api_ui/src/components/PingOneAuthorizePage.jsx` — today a single vertical stack (a separate "Authorization Policies" card, then a separate "Evaluate" card with an inline preset-form-then-result blob) — onto the shared `InspectorShell` from the prior plan: policy tree on the left, preset form in the middle, tabbed Decision/Response/Request output on the right.

**Architecture:** `EvaluatePanel` (today: a form-then-inline-result component nested inside its own "Evaluate" card, with a sibling `PoliciesCard` component rendering a separate "Authorization Policies" card above it) becomes the sole owner of an `<InspectorShell>` instance. It gains two new props — `policiesState` (replacing the current `policies` array prop, so it can render loading/error states) and `onTestRule` (today only passed to the sibling `PoliciesCard`) — and absorbs the policy-tree rendering into its `left` slot, using the existing `PolicyNode` recursive component completely unchanged. The preset tabs + form + Evaluate button move into `middle`. The result box, response JSON, and request JSON — previously three separately-visible blocks — become three tabs (`Decision` / `Response` / `Request`) in `right`, via a new `outputTab` state. **Correction to the design spec:** the spec (`docs/superpowers/specs/2026-07-19-inspector-shell-template-design.md`) called this "the simplest swap" of the three page conversions; deep-reading the full 1008-line file during this plan's research found the opposite — it is a single vertical stack of cards today, not close to a 3-column shape, making it the most invasive of the three. **Second correction, found mid-execution:** an earlier draft of this plan (and the human decision behind it) assumed the "Open policy decision trace" button opened a `FloatingPanel`/`PolicyDecisionTree` overlay gated by `traceOpen` state — true when the plan was first drafted, but a concurrent, unrelated commit (`8cf7db3ed`, already on `origin/main` by the time this plan's worktree branched) replaced that entirely with a plain `navigate('/policy-decision-trace', { state: { policies, result } })` call to a dedicated route, before this plan's implementation began. This plan now keeps *that* (the currently-real behavior) unchanged, dropping `FloatingPanel`/`PolicyDecisionTree`/`traceOpen` from its own scope entirely — confirmed with the human once the drift was discovered. That commit also left three orphaned `setTraceOpen(...)` calls behind (a live `ReferenceError` — `setTraceOpen` is not defined — that fires on every "Evaluate (live)" click); Task 1 fixes those three lines as a small, in-scope, pre-existing-bug fix since they sit inside code this task already edits.

Everything **outside** the Evaluate section — the outer tab bar (console / guided / mock authz rules / scopes & resources / snapshot import), header, error banner, `notConfigured`/`metaStrip` block, the "Decision Endpoint" picker card, "Recent Decisions" card, and "Run History" card — is untouched. `PoliciesCard` (the standalone "Authorization Policies" card component) is deleted once its content lives inside `EvaluatePanel`'s left column; its one piece of reusable logic (`ruleCount`, a recursive rule counter) moves to module level so both the deleted card and the new left column could have used it (only the new column does, post-deletion).

**Tech Stack:** React 18, Vitest + `@testing-library/react` + `@testing-library/jest-dom`, `vi.mock('../services/bffAxios', ...)` per this repo's established pattern (see `demo_api_ui/src/components/__tests__/AccessIdTokenPathPage.test.jsx`).

## Global Constraints

- **Worktree required.** All work happens in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-authorize-inspector-shell`, branch `worktree-pingone-authorize-inspector-shell`. Confirm with `git branch --show-current` before each commit.
- **Protected UI area.** `demo_api_ui` is covered by `REGRESSION_PLAN.md` §1. Invoke `regression-guard` before Task 1's first edit. State what will not break: `PingOneAuthorizePage.jsx` is reached only via the `/pingone-authorize` route (unchanged in this plan) and is not imported by any other page except being embedded via `AuthzTestPage` reference in the other direction (this file imports `AuthzTestPage`, nothing imports `PingOneAuthorizePage` except its own route) — so the blast radius is this one route.
- **Emoji allowlist** (`REGRESSION_PLAN.md` §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` permitted. The existing file already uses `❌` and `⚠️` (both allowlisted) — preserve them exactly where they appear in moved code; do not introduce any other emoji. (An earlier draft of this plan also expected `🪟` on the trace-open button; that prefix no longer exists in the current file — see Step 8's note.)
- **Stage explicitly.** `git add <exact files>`, never `git add -A`.
- **Depends on the prior plan.** `InspectorShell`, `InspectorListItem`, `InspectorTabs` (`demo_api_ui/src/components/shared/InspectorShell.jsx` / `.css`, `InspectorListItem.jsx`, `InspectorTabs.jsx`) must already exist on `main` before this plan starts — they do (merged commit `70266b628`). This plan uses `InspectorShell` and `InspectorTabs`; it does **not** use `InspectorListItem` (the policy tree reuses the existing `PolicyNode` component instead — `PolicyNode` renders a nested Policy Set → Policy → Rule tree with two actions per rule, which doesn't fit `InspectorListItem`'s one-row-one-click-one-badge-set shape).
- **UI build gate.** `npm run build` inside `demo_api_ui/` must succeed before this plan is done (final step of Task 2).
- **No behavior change outside the Evaluate section.** The endpoint picker, Recent Decisions, Run History, header, and outer tab bar (console / guided / mock authz rules / scopes & resources / snapshot import) keep their exact current JSX, props, and behavior — only the two lines that render `<PoliciesCard>` and the "Evaluate" card wrapper change, per Task 2.

---

## File Structure

Only one existing file is modified — no new files.

| File | Change |
|---|---|
| `demo_api_ui/src/components/PingOneAuthorizePage.jsx` | `EvaluatePanel` restructured onto `InspectorShell` (Task 1); `PoliciesCard` deleted, `ruleCount` promoted to module level, main component wired to the new `EvaluatePanel` props (Task 2). |
| `demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx` | **New.** Did not exist before this plan — the file had zero test coverage. Covers `EvaluatePanel` in isolation (Task 1) and the full page's wiring (Task 2). |

---

### Task 1: Restructure `EvaluatePanel` onto `InspectorShell`

**Files:**
- Modify: `demo_api_ui/src/components/PingOneAuthorizePage.jsx` (the `EvaluatePanel` function — find it by its `function EvaluatePanel({ endpointId, autoPreset, ...` signature, not by line number, since earlier upstream commits have shifted it since this plan was first drafted; plus one new module-level helper near the top)
- Create: `demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx`

**Interfaces:**
- Consumes: `InspectorShell({title, statusOn, statusText, actions, left, middle, right})` and `InspectorTabs({tabs, activeKey, onChange})` from `demo_api_ui/src/components/shared/InspectorShell.jsx` and `InspectorTabs.jsx` (already on `main`). Also consumes the existing, unchanged `PolicyNode({node, onTestRule})` (defined later in the same file, hoisted — function declarations are hoisted in JS, so `EvaluatePanel` can reference `PolicyNode` even though it's defined below it in the file).
- Produces: `EvaluatePanel({ endpointId, autoPreset, policiesState, pendingTest, onClearPendingTest, onEvaluated, onTestRule })` — a **named** export added alongside the file's existing default export (`export default function PingOneAuthorizePage()`), so this task's test file can import it directly: `import { EvaluatePanel } from '../PingOneAuthorizePage';`. `policiesState: { policies: Array, loading: boolean, error: string|null, note: string|null }` (replaces the old `policies: Array` prop — Task 2 updates the one caller). `onTestRule: (testCase) => void` (replaces the old sibling `<PoliciesCard onTestRule={...}>` prop — Task 2 wires it to the same `handleTestRule` function that already exists in the parent). All other props (`endpointId`, `autoPreset`, `pendingTest`, `onClearPendingTest`, `onEvaluated`) are unchanged from today.

- [ ] **Step 1: Invoke regression-guard**

Before any edit, invoke the `regression-guard` skill. State: this task only touches `PingOneAuthorizePage.jsx`, reached solely via the `/pingone-authorize` route; the endpoint picker, Recent Decisions, Run History, header, and outer tab bar are untouched in this task (Task 2 rewires the two lines that render the old `PoliciesCard`/Evaluate-card, still without touching anything else).

- [ ] **Step 2: Write the failing tests**

Create `demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx`:

```jsx
// demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import bffAxios from '../../services/bffAxios';
import { EvaluatePanel } from '../PingOneAuthorizePage';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// EvaluatePanel calls useNavigate() unconditionally (the "Open policy decision
// trace" button navigates to /policy-decision-trace) — mock it so render()
// doesn't throw "useNavigate() may be used only in the context of a <Router>".
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const ONE_POLICY = [
  {
    id: 'ps-1',
    kind: 'POLICY_SET',
    name: 'Banking Authorization',
    enabled: true,
    children: [
      {
        id: 'p-1',
        kind: 'POLICY',
        name: 'Transaction Authorization',
        enabled: true,
        children: [
          {
            id: 'r-1',
            kind: 'RULE',
            name: 'Deny threshold',
            enabled: true,
            effect: 'DENY',
            testCases: {
              trigger: { preset: 'transaction', parameters: { Amount: 50000, TransactionType: 'transfer' } },
              avoid: { preset: 'transaction', parameters: { Amount: 10, TransactionType: 'transfer' } },
            },
          },
        ],
      },
    ],
  },
];

function basePolicies(overrides = {}) {
  return { policies: ONE_POLICY, loading: false, error: null, note: null, ...overrides };
}

function renderPanel(props = {}) {
  return render(
    <EvaluatePanel
      endpointId="ep-1"
      autoPreset="transaction"
      policiesState={basePolicies()}
      pendingTest={null}
      onClearPendingTest={() => {}}
      onEvaluated={() => {}}
      onTestRule={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // EvaluatePanel fetches MCP-console defaults once on mount regardless of preset.
  bffAxios.get.mockResolvedValue({ data: {} });
});

test('renders the policy tree in the left column with the rule count', async () => {
  renderPanel();
  expect(await screen.findByText('Deny threshold')).toBeInTheDocument();
  expect(screen.getByText('Transaction Authorization')).toBeInTheDocument();
  expect(screen.getByText(/1 rule/)).toBeInTheDocument();
});

test('shows a loading message in the left column while policies load', () => {
  const { container } = renderPanel({ policiesState: basePolicies({ policies: [], loading: true }) });
  // Scoped: the topbar-style header also says "loading…" (a different element) — query the tree body specifically.
  const treeBody = container.querySelector('.inspector-shell-tree-body');
  expect(within(treeBody).getByText('Loading policies…')).toBeInTheDocument();
});

test('shows an error message in the left column when policies fail to load', () => {
  renderPanel({ policiesState: basePolicies({ policies: [], loading: false, error: 'worker not configured' }) });
  expect(screen.getByText(/worker not configured/)).toBeInTheDocument();
});

test('clicking a rule\'s Trigger button calls onTestRule with that rule\'s trigger test case', async () => {
  const onTestRule = vi.fn();
  renderPanel({ onTestRule });
  const trigger = await screen.findByRole('button', { name: 'Trigger →' });
  fireEvent.click(trigger);
  expect(onTestRule).toHaveBeenCalledWith({
    ruleName: 'Deny threshold',
    case: 'trigger',
    preset: 'transaction',
    parameters: { Amount: 50000, TransactionType: 'transfer' },
  });
});

test('switches preset tabs in the middle column', () => {
  // The Amount/Tool name <label>s aren't htmlFor-linked to their <input>s
  // (pre-existing markup) — assert on placeholder/label text instead of
  // getByLabelText, which requires that association.
  renderPanel();
  expect(screen.getByPlaceholderText('e.g. 5000')).toBeInTheDocument();
  fireEvent.click(screen.getByText('MCP First Tool'));
  expect(screen.getByText('Tool name')).toBeInTheDocument();
});

test('output tabs show empty-state text before any evaluation has run', () => {
  renderPanel();
  expect(screen.getByText(/Run an evaluation to see the decision/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Response' }));
  expect(screen.getByText(/Run an evaluation to see the response/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Request' }));
  expect(screen.getByText(/Run an evaluation to see the request/)).toBeInTheDocument();
});

test('clicking Evaluate posts to /api/authorize/evaluate-endpoint and shows the decision', async () => {
  bffAxios.post.mockResolvedValueOnce({
    data: { decision: 'PERMIT', engine: 'simulated', decisionId: 'dec-1', path: '/decide' },
  });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Evaluate \(live\)/ }));
  await waitFor(() => expect(bffAxios.post).toHaveBeenCalledWith(
    '/api/authorize/evaluate-endpoint',
    expect.objectContaining({ endpointId: 'ep-1' }),
  ));
  // Regex, not exact string: the decision renders as 3 text-node children
  // ("✅", " ", "PERMIT") inside one <span>, so an exact 'PERMIT' match never
  // matches the concatenated node text.
  expect(await screen.findByText(/PERMIT/)).toBeInTheDocument();
});

test('the Response and Request output tabs show the last call\'s trace after an evaluation', async () => {
  bffAxios.post.mockResolvedValueOnce({
    // pingoneResponse is required here (not in the other two tests) — it's
    // what authorizeResponsePayload() reads into lastTrace.response, which
    // this test's Response-tab assertion checks. Without it lastTrace.response
    // is null and the tab renders its empty state instead.
    data: { decision: 'PERMIT', engine: 'simulated', decisionId: 'dec-1', path: '/decide', pingoneResponse: { decision: 'PERMIT' } },
  });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Evaluate \(live\)/ }));
  await screen.findByText(/PERMIT/);

  fireEvent.click(screen.getByRole('button', { name: 'Response' }));
  expect(screen.getByText(/PERMIT/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Request' }));
  expect(screen.getByText(/ep-1|endpointId/)).toBeInTheDocument();
});

test('the "Open policy decision trace" button navigates to /policy-decision-trace with the policies and result', async () => {
  bffAxios.post.mockResolvedValueOnce({
    data: { decision: 'PERMIT', engine: 'simulated', decisionId: 'dec-1', path: '/decide' },
  });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Evaluate \(live\)/ }));
  await screen.findByText(/PERMIT/);

  fireEvent.click(screen.getByRole('button', { name: 'Open policy decision trace' }));
  expect(mockNavigate).toHaveBeenCalledWith(
    '/policy-decision-trace',
    expect.objectContaining({ state: expect.objectContaining({ policies: ONE_POLICY }) }),
  );
});
```

- [ ] **Step 3: Run the tests to verify they fail**

From `demo_api_ui/`:

```bash
npx vitest run src/components/__tests__/PingOneAuthorizePage.test.jsx
```

Expected: FAIL — `EvaluatePanel` is not exported yet (`does not provide an export named 'EvaluatePanel'`).

- [ ] **Step 4: Add the `ruleCount` module-level helper**

In `demo_api_ui/src/components/PingOneAuthorizePage.jsx`, add this near the other module-level helpers (immediately after the existing `endpointLabel` function, before `DecisionRow`):

```js
/** Recursively counts RULE nodes in a policy tree (used by the left-column header count). */
function ruleCount(nodes) {
  return nodes.reduce((n, p) => n + (p.kind === 'RULE' ? 1 : 0) + ruleCount(p.children || []), 0);
}
```

- [ ] **Step 5: Add `import InspectorShell` and `import InspectorTabs`**

At the top of `demo_api_ui/src/components/PingOneAuthorizePage.jsx`, add two imports alongside the existing ones (after the `AuthzTestPage` import, before the `authorizeResultExplain` import):

```js
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
```

- [ ] **Step 6: Rewrite `EvaluatePanel`'s signature and add `export`**

Change the function signature (currently `function EvaluatePanel({ endpointId, autoPreset, policies, pendingTest, onClearPendingTest, onEvaluated }) {`) to:

```js
export function EvaluatePanel({ endpointId, autoPreset, policiesState, pendingTest, onClearPendingTest, onEvaluated, onTestRule }) {
```

The function's current first line, `const navigate = useNavigate();`, stays exactly as-is — it's not part of this step. Immediately **after** that line (i.e. still before the existing `const [preset, setPreset] = useState(autoPreset);` line), add:

```js
  const { policies, loading: policiesLoading, error: policiesError, note: policiesNote } = policiesState;
  const [outputTab, setOutputTab] = useState('decision');
```

Every other `useState`/`useEffect`/`useCallback`/`useMemo` declaration in `EvaluatePanel` stays exactly as it is today — this step only adds these two lines and changes the signature. The `explanation` useMemo already reads `policies` as a plain identifier (`explainAuthorizeResult({ parameters: lastParameters, result, preset, policies })`) — leave that line untouched; it now resolves to the destructured local `const policies` instead of the old prop, with no other change needed.

- [ ] **Step 7: Fix 3 calls to `setTraceOpen` — a function that no longer exists**

The current file has three calls to `setTraceOpen(...)`, a leftover from a policy-decision-trace redesign (commit `8cf7db3ed`) that removed the `useState` declaration for `traceOpen` but missed these three call sites. This is a live bug: `setTraceOpen` is not defined anywhere in the file, so each of these throws `ReferenceError: setTraceOpen is not defined` when it runs — including the one inside `run()`, meaning **every click of "Evaluate (live)" currently crashes**. Fixing this is in scope because all three lines sit inside code this task already touches.

In the first `useEffect` (the one that resets state when `endpointId`/`autoPreset` changes), delete the `setTraceOpen(false);` line:

```js
  useEffect(() => {
    setPreset(autoPreset);
    setResult(null);
    setErr(null);
    setLastTrace(null);
    setLastParameters(null);
    onClearPendingTest?.();
  }, [endpointId, autoPreset, onClearPendingTest]);
```

In the second `useEffect` (the one that applies a `pendingTest`), delete the `setTraceOpen(false);` line:

```js
  useEffect(() => {
    if (!pendingTest) return;
    setPreset(pendingTest.preset);
    setResult(null);
    setErr(null);
    const p = pendingTest.parameters;
```

In `run()`, replace the first line — `setRunning(true); setResult(null); setTraceOpen(false); setErr(null); setLastTrace(null); setLastParameters(null);` — removing `setTraceOpen(false);` and adding `setOutputTab('decision');` so a fresh evaluation always surfaces its decision immediately:

```js
    setRunning(true); setResult(null); setErr(null); setLastTrace(null); setLastParameters(null); setOutputTab('decision');
```

- [ ] **Step 8: Replace `EvaluatePanel`'s return statement**

Replace the entire `return (...)` block (from `return (` through the matching closing `);` and the function's closing `}` — i.e. everything from the current `return (\n    <div>` through `\n  );\n}` that ends `EvaluatePanel`) with:

```jsx
  return (
    <InspectorShell
      title="PingOne Authorize"
      statusOn={!!endpointId}
      statusText={endpointId ? undefined : 'Select a decision endpoint above'}
      left={
          <>
            <div className="inspector-shell-tree-header">
              <span>Authorization Policies</span>
              <span>{policiesLoading ? 'loading…' : `${ruleCount(policies)} rule${ruleCount(policies) !== 1 ? 's' : ''}`}</span>
            </div>
            <div className="inspector-shell-tree-body">
              {policiesLoading ? (
                <div style={{ padding: '20px 16px', color: '#64748b', fontSize: '13px' }}>Loading policies…</div>
              ) : policiesError ? (
                <div style={{ padding: '20px 16px', color: '#b45309', fontSize: '13px' }}>⚠️ {policiesError}</div>
              ) : policies.length === 0 ? (
                <div style={{ padding: '20px 16px', color: '#64748b', fontSize: '13px' }}>
                  {policiesNote || 'No authorization policies found in this environment.'}
                </div>
              ) : (
                <div style={{ padding: '8px 12px' }}>
                  {policiesNote && (
                    <div style={{ marginBottom: '10px', fontSize: '12px', color: '#64748b' }}>{policiesNote}</div>
                  )}
                  <div style={S.polTree}>
                    {policies.map((p) => (
                      <PolicyNode key={p.id} node={p} onTestRule={onTestRule} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        }
        middle={
          <>
            <div className="inspector-shell-form-header">
              <div className="inspector-shell-form-header__name">Evaluate</div>
              <div className="inspector-shell-form-header__desc">Send a real decision request to the selected endpoint.</div>
            </div>
            <div className="inspector-shell-form-body">
              {pendingTest && (
                <div style={S.pendingLabel}>Testing: {pendingTest.ruleName} — {pendingTest.case}</div>
              )}
              <div style={S.tabs}>
                <span style={S.tab(preset === 'transaction')} onClick={() => { setPreset('transaction'); onClearPendingTest?.(); }}>Transaction</span>
                <span style={S.tab(preset === 'mcp')} onClick={() => { setPreset('mcp'); onClearPendingTest?.(); }}>MCP First Tool</span>
                <span style={S.tab(preset === 'custom')} onClick={() => { setPreset('custom'); onClearPendingTest?.(); }}>Custom parameters</span>
                <span style={S.presetPill}>preset: {presetLabel}</span>
              </div>

              {TAB_HELP[preset] && (
                <div style={S.tabHelp}>
                  <span style={S.tabHelpTitle}>{TAB_HELP[preset].title}:</span>
                  {TAB_HELP[preset].body}
                </div>
              )}

              {preset === 'transaction' && (
                <div style={S.formRow}>
                  <div style={S.fieldGroup}><label style={S.fld}>Amount (USD)</label>
                    <input style={S.input} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5000" /></div>
                  <div style={S.fieldGroup}><label style={S.fld}>Transaction type</label>
                    <select style={S.select} value={txType} onChange={e => setTxType(e.target.value)}>
                      {TX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select></div>
                  <div style={S.fieldGroup}><label style={S.fld}>ACR (auth context)</label>
                    <select style={S.select} value={acr} onChange={e => setAcr(e.target.value)}>
                      <option value="">(none)</option><option value="MFA">MFA</option><option value="Single">Single</option>
                    </select></div>
                  <div style={S.fieldGroup}><label style={S.fld}>User ID</label>
                    <input style={S.input} type="text" value={userId} onChange={e => setUserId(e.target.value)} /></div>
                </div>
              )}

              {preset === 'mcp' && (
                <>
                  <div style={S.formRow}>
                    <div style={S.fieldGroup}><label style={S.fld}>Tool name</label>
                      <input style={S.input} type="text" value={toolName} onChange={e => setToolName(e.target.value)} /></div>
                    <div style={S.fieldGroup}><label style={S.fld}>Token audience</label>
                      <input style={S.input} type="text" value={tokenAudience} onChange={e => setTokenAudience(e.target.value)} /></div>
                    <div style={S.fieldGroup}><label style={S.fld}>Act client id</label>
                      <input style={S.input} type="text" value={actClientId} onChange={e => setActClientId(e.target.value)} placeholder="act.client_id" /></div>
                    <div style={S.fieldGroup}><label style={S.fld}>User ID</label>
                      <input style={S.input} type="text" value={userId} onChange={e => setUserId(e.target.value)} /></div>
                  </div>
                  <div style={{ ...S.formRow, gridTemplateColumns: '1fr 2fr 1fr', marginTop: '12px' }}>
                    <div style={S.fieldGroup}><label style={S.fld}>HitlApproved</label>
                      <select style={S.select} value={hitlApproved ? 'true' : 'false'} onChange={e => setHitlApproved(e.target.value === 'true')}>
                        <option value="false">false</option><option value="true">true</option>
                      </select></div>
                    <div style={S.fieldGroup}><label style={S.fld}>MCP resource URI</label>
                      <input style={S.input} type="text" value={mcpResourceUri} onChange={e => setMcpResourceUri(e.target.value)} /></div>
                    <div />
                  </div>
                </>
              )}

              {preset === 'custom' && (
                <table style={S.table}>
                  <thead><tr>
                    <th style={{ ...S.th, width: '42%' }}>Parameter (Trust Framework attribute)</th>
                    <th style={S.th}>Value</th>
                    <th style={{ ...S.th, width: '44px' }}></th>
                  </tr></thead>
                  <tbody>
                    {customRows.map((r, i) => (
                      <tr key={i}>
                        <td style={S.td}><input style={S.input} type="text" value={r.key} placeholder="add attribute…" onChange={e => setRow(i, 'key', e.target.value)} /></td>
                        <td style={S.td}><input style={S.input} type="text" value={r.value} placeholder="value…" onChange={e => setRow(i, 'value', e.target.value)} /></td>
                        <td style={S.td}>
                          {(r.key || r.value) ? (
                            <button style={{ ...S.iconBtn, marginTop: 0, color: '#dc2626' }} onClick={() => removeRow(i)}>remove</button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="inspector-shell-form-actions">
              <button style={S.evalBtn} onClick={run} disabled={running || !endpointId}>{running ? 'Evaluating…' : 'Evaluate (live)'}</button>
              {err && <span style={{ color: '#dc2626', fontSize: '12px', marginLeft: '8px' }}>❌ {err}</span>}
            </div>
          </>
        }
        right={
          <>
            <InspectorTabs
              tabs={[
                { key: 'decision', label: 'Decision' },
                { key: 'response', label: 'Response' },
                { key: 'request', label: 'Request' },
              ]}
              activeKey={outputTab}
              onChange={setOutputTab}
            />
            <div className="inspector-shell-output-body">
              {outputTab === 'decision' && (
                result ? (
                  <div style={S.resultBox(decision)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                      <span style={S.resultDecision(decision)}>{DECISION_ICON[decision] || '?'} {decision}</span>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>engine: {result.engine}</span>
                    </div>
                    <div style={S.resultSub}>
                      {result.decisionId ? `Decision ID ${result.decisionId} · ` : ''}path: {result.path || '—'}
                    </div>
                    {explanation?.policyName && (
                      <div style={S.policyUsed}>
                        <div style={S.policyUsedLabel}>Policy evaluated</div>
                        <div style={S.policyUsedName}>{explanation.policyName}</div>
                        {explanation.policyDescription && (
                          <div style={S.policyUsedDesc}>{explanation.policyDescription}</div>
                        )}
                        {explanation.ruleName && (
                          <>
                            <div style={S.policyUsedLabel}>Rule that applied</div>
                            <div style={S.ruleUsedName}>{explanation.ruleName}</div>
                            {explanation.ruleDescription && (
                              <div style={S.policyUsedDesc}>{explanation.ruleDescription}</div>
                            )}
                          </>
                        )}
                        {explanation.combiningAlgorithm && (
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            Combining algorithm: {explanation.combiningAlgorithm.replace(/([A-Z])/g, ' $1').trim()}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={S.oblig}>
                      <div>Step-up: <b>{result.stepUpRequired ? 'yes' : 'no'}</b></div>
                      <div>Consent / HITL: <b>{(result.consentRequired || result.hitlRequired) ? 'yes' : 'no'}</b></div>
                    </div>
                    {explanation && (
                      <div style={S.explainBox}>
                        <div style={S.explainHeadline}>{explanation.headline}</div>
                        {explanation.ruleLikely && !explanation.ruleName && (
                          <div style={S.explainRule}>
                            Likely rule: <strong>{explanation.ruleLikely}</strong>
                          </div>
                        )}
                        {explanation.reasons.length > 0 && (
                          <ul style={S.explainList}>
                            {explanation.reasons.map((line) => <li key={line}>{line}</li>)}
                          </ul>
                        )}
                        {explanation.thresholds?.length > 0 && preset === 'transaction' && (
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            Policy thresholds: {explanation.thresholds.join(' · ')}
                          </div>
                        )}
                        {explanation.apiSummary && (
                          <div style={S.explainApi}>
                            API: {explanation.apiSummary}
                            {result.decisionId ? ` · decisionId ${result.decisionId}` : ''}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      style={S.reopenTrace}
                      onClick={() => navigate('/policy-decision-trace', { state: { policies, result } })}
                    >
                      Open policy decision trace
                    </button>
                  </div>
                ) : (
                  <div className="inspector-shell-output-empty">Run an evaluation to see the decision.</div>
                )
              )}
              {outputTab === 'response' && (
                lastTrace ? (
                  lastTrace.response ? (
                    <pre className="mcp-inspector__code jh-dark">
                      <JsonHighlight value={lastTrace.response} deep />
                    </pre>
                  ) : (
                    <p className="mcp-inspector__muted">No response body returned.</p>
                  )
                ) : (
                  <div className="inspector-shell-output-empty">Run an evaluation to see the response.</div>
                )
              )}
              {outputTab === 'request' && (
                lastTrace ? (
                  <pre className="mcp-inspector__code jh-dark">
                    <JsonHighlight value={lastTrace.request} deep />
                  </pre>
                ) : (
                  <div className="inspector-shell-output-empty">Run an evaluation to see the request.</div>
                )
              )}
            </div>
          </>
        }
      />
  );
}
```

Note what stayed byte-for-byte identical inside this new return: the entire preset-tab bar, `TAB_HELP` block, all three preset forms, the entire result-box content (decision badge through the "Open policy decision trace" button, which itself is unchanged from the file's current `navigate(...)`-based version — no `FloatingPanel`/`PolicyDecisionTree`/`traceOpen` involved, those were already removed from this file by an earlier, unrelated commit). Only the *container* changed (from one linear `<div>` stack to `InspectorShell`'s `left`/`middle`/`right` slots). The only genuinely new lines are: the left-column tree wrapper, the `InspectorTabs` bar, the three `outputTab === '...'` conditionals, and their empty-state messages. No fragment wrapper (`<>...</>`) is needed around `<InspectorShell>` — there is no sibling element anymore, unlike an earlier draft of this plan that assumed the (already-removed) `FloatingPanel` still needed one.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
npx vitest run src/components/__tests__/PingOneAuthorizePage.test.jsx
```

Expected: PASS — 9 tests.

- [ ] **Step 10: Commit**

```bash
git branch --show-current   # confirm worktree-pingone-authorize-inspector-shell
git add demo_api_ui/src/components/PingOneAuthorizePage.jsx \
        demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx
git commit -m "feat(pingone-authorize): rebuild EvaluatePanel on InspectorShell"
```

---

### Task 2: Wire the main page to the new `EvaluatePanel`, delete `PoliciesCard`

**Files:**
- Modify: `demo_api_ui/src/components/PingOneAuthorizePage.jsx` (delete `PoliciesCard`, the function immediately after `PolicyNode` — find it by its signature `function PoliciesCard({ state, onTestRule }) {`, not by line number, since Task 1's edits shift every line after it; update the two lines in the main component's return that render `<PoliciesCard>` and the old "Evaluate" card wrapper)
- Modify: `demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx` (add tests for the full page)

**Interfaces:**
- Consumes: `EvaluatePanel` from Task 1 (same file, now takes `policiesState` + `onTestRule` instead of `policies`).
- Produces: no new exports — `PingOneAuthorizePage`'s default export and its rendered output are what change (one fewer standalone "Authorization Policies" card; the policy tree now lives inside the Evaluate section).

- [ ] **Step 1: Delete `PoliciesCard`**

In `demo_api_ui/src/components/PingOneAuthorizePage.jsx`, delete the entire `PoliciesCard` function (from `function PoliciesCard({ state, onTestRule }) {` through its closing `}`, currently right after `PolicyNode`). Its local `ruleCount` const inside that function is already superseded by Task 1's module-level `ruleCount` — deleting the whole function removes both at once. `PolicyNode` (defined just above `PoliciesCard`) is **not** touched — it's still used, now only by `EvaluatePanel`'s left column.

- [ ] **Step 2: Update the main component's render to drop the standalone policies card and evaluate-card wrapper**

In the main `PingOneAuthorizePage` component's return, find this block:

```jsx
      {/* Authorization policies (read-only tree) */}
      <PoliciesCard state={policiesState} onTestRule={handleTestRule} />

      {/* Evaluate */}
      <div style={S.card} id="evaluate-card">
        <div style={S.cardHead}><span style={S.cardTitle}>Evaluate</span></div>
        <div style={S.cardBody}>
          {selectedId
            ? <EvaluatePanel endpointId={selectedId} autoPreset={autoPreset} policies={policiesState.policies} pendingTest={pendingTest} onClearPendingTest={clearPendingTest} onEvaluated={pushRunHistory} />
            : <div style={S.empty}>Select a decision endpoint to evaluate.</div>}
        </div>
      </div>
```

Replace it with:

```jsx
      {/* Evaluate — policy tree, form, and result all live inside one InspectorShell */}
      {selectedId
        ? <EvaluatePanel endpointId={selectedId} autoPreset={autoPreset} policiesState={policiesState} pendingTest={pendingTest} onClearPendingTest={clearPendingTest} onEvaluated={pushRunHistory} onTestRule={handleTestRule} />
        : <div style={S.card}><div style={S.cardBody}><div style={S.empty}>Select a decision endpoint to evaluate.</div></div></div>}
```

The `id="evaluate-card"` attribute is dropped along with it: `handleTestRule` (defined in the main component, unchanged) calls `document.getElementById('evaluate-card')?.scrollIntoView(...)` — with the policy tree and the form now side-by-side in the same shell instead of far apart vertically, there is nothing to scroll to. Leave `handleTestRule`'s body exactly as-is (including the now-inert `getElementById` call — it safely no-ops via the `?.` since the element no longer exists); do not remove that line in this task, it is out of scope for this plan's stated boundary (only the two card-rendering lines above are in scope) and removing it is a one-line cleanup better left to whoever next touches `handleTestRule` for an unrelated reason.

- [ ] **Step 3: Add the full-page wiring tests**

Two edits to `demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx`:

First, at the **top** of the file: change the import to bring in the default export alongside the named one, and **merge** `useSearchParams` into Task 1's existing `vi.mock('react-router-dom', ...)` call rather than adding a second one — vitest does not merge multiple mock factories registered for the same module path; only the last-registered factory survives, so a second `vi.mock('react-router-dom', ...)` call would silently break Task 1's `useNavigate` mock instead of adding to it.

Change:

```jsx
import { EvaluatePanel } from '../PingOneAuthorizePage';
```

to:

```jsx
import PingOneAuthorizePage, { EvaluatePanel } from '../PingOneAuthorizePage';
```

And change Task 1's existing mock block from:

```jsx
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
```

to:

```jsx
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
```

Second, **append** the following to the end of the file (after the existing `EvaluatePanel`-only tests):

```jsx
const LIVE_POLICY_RESPONSE = {
  endpoints: [{ id: 'ep-1', name: 'Transaction Auth', recordRecentRequests: false }],
  transactionEndpointId: 'ep-1',
  mcpEndpointId: null,
  workerConfigured: true,
  environmentId: 'env-123',
  region: 'com',
  activeEngine: 'simulated',
};

function mockPageEndpoints() {
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/authorize/pingone-policies') {
      return Promise.resolve({ data: { policies: ONE_POLICY, note: null } });
    }
    if (url === '/api/authorize/pingone-live-policy') {
      return Promise.resolve({ data: LIVE_POLICY_RESPONSE });
    }
    if (url.startsWith('/api/authorize/recent-decisions')) {
      return Promise.resolve({ data: { decisions: [] } });
    }
    if (url === '/api/authorize/mcp-console-defaults') {
      return Promise.resolve({ data: {} });
    }
    return Promise.resolve({ data: {} });
  });
}

describe('PingOneAuthorizePage (full page wiring)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPageEndpoints();
  });

  test('renders exactly one "Authorization Policies" tree region, not a separate card plus a shell copy', async () => {
    render(<PingOneAuthorizePage />);
    const matches = await screen.findAllByText('Authorization Policies');
    expect(matches).toHaveLength(1);
  });

  test('clicking Trigger on a rule (now inside the shell) round-trips through the parent\'s pendingTest state into the middle form', async () => {
    render(<PingOneAuthorizePage />);
    const trigger = await screen.findByRole('button', { name: 'Trigger →' });
    fireEvent.click(trigger);
    // pendingTest's preset is 'transaction' and its Amount is 50000 (ONE_POLICY's trigger case) —
    // confirms the parent's handleTestRule -> pendingTest -> EvaluatePanel's pendingTest-effect
    // chain still runs end-to-end through the new prop wiring.
    await waitFor(() => {
      expect(screen.getByLabelText(/^Amount/)).toHaveValue(50000);
    });
  });
});
```

- [ ] **Step 4: Run the full test file**

```bash
npx vitest run src/components/__tests__/PingOneAuthorizePage.test.jsx
```

Expected: PASS — 11 tests total (9 from Task 1 plus 2 new).

- [ ] **Step 5: Run the UI build gate**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # confirm worktree-pingone-authorize-inspector-shell
git add demo_api_ui/src/components/PingOneAuthorizePage.jsx \
        demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx
git commit -m "feat(pingone-authorize): delete PoliciesCard, wire EvaluatePanel's new props"
```

---

## What this plan does not do

- Does not touch the outer tab bar (console / guided / mock authz rules / scopes & resources / snapshot import), header, error banner, `notConfigured`/`metaStrip` block, "Decision Endpoint" picker card, "Recent Decisions" card, or "Run History" card — all unchanged.
- Does not change routing or `AdminSideNav.jsx` — `/pingone-authorize` and its existing "Authorize" group nav entry are untouched (per the design spec, this page's route/nav position doesn't move).
- Does not remove the `id="evaluate-card")` scroll-target reference inside `handleTestRule` (only the element it targets) — see Task 2 Step 2's note.
- Does not touch `AgentGatewayTester.jsx` or the `McpInspector`/`PingOneMcpInspector`/`ApiExplorerPanel` merge — those are the next two plans per the design spec's migration order.
