# Pre-Demo Check — Frontend Page (Plan 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/check` page that any logged-in user reaches from the side nav, consuming the `/api/check` API from Plans 1–2 and rendering one results model as four switchable views (traffic-light cards default, pre-flight stepper run mode, grouped checklist, rail + detail), plus the frontend-driven real end-to-end **chip test**.

**Architecture:** A `useCheckRun` hook fetches `GET /api/check/catalog` and streams `POST /api/check/run` (SSE over fetch). `CheckPage.jsx` renders the shared results model through a view switcher. The chip test is a separate frontend action that POSTs `/api/agent/invoke` (the live-session agent path the UI already uses) and folds its outcome into the same results model. A side-nav item in `AdminSideNav.jsx` (no `adminOnly`) exposes it to every user.

**Tech Stack:** React (Vite), existing `bffAxios`, Jest + React Testing Library (`test:ui`), Playwright build gate.

## Global Constraints

- **Work in a git worktree, never the main checkout** (CLAUDE.md). Explicit staging; verify branch before commit.
- **Invoke the `regression-guard` skill before editing `demo_api_ui`** and run the UI build gate before calling the work done. Minimal diff — name the component/element, change only that.
- **Emoji allowlist** (`⚠️ ✅ ❌ 🔐 ✕ ✓` only). Traffic lights and status icons are **CSS/semantic dots via tokens**, never emoji (no 🟢🟡🔴⚪🚦). Reuse the `.light` CSS-dot approach from the design mock.
- Any logged-in user: route guarded like `/servers` (logged-in only, no admin gate); side-nav item has no `adminOnly`.
- Reference implementations: `demo_api_ui/src/pages/ServersPage.jsx` (page shell + fetch pattern), the published design mock (card/stepper/checklist/rail markup + CSS tokens), `RunReportPage.js` (`bffAxios.post('/api/agent/invoke', { prompt, vertical })`).

## Component File Structure

- `src/pages/CheckPage.jsx` — page shell, view switcher, verdict bar, wiring. One responsibility: orchestrate views + actions.
- `src/pages/CheckPage.css` — page styles (tokens + the four view layouts), ported from the mock; CSS traffic-light dots.
- `src/hooks/useCheckRun.js` — data layer: catalog fetch + SSE run stream + results store + verdict derivation. No JSX.
- `src/pages/check/CardsView.jsx`, `StepperView.jsx`, `ChecklistView.jsx`, `RailDetailView.jsx` — the four presentational views; each takes `{ results, catalog, verdict }` props and renders. No fetching.
- `src/pages/check/chipTest.js` — the frontend chip-test action (calls `/api/agent/invoke`, maps to a result object).

---

### Task 1: `useCheckRun` hook — catalog + SSE run + verdict

**Files:**
- Create: `demo_api_ui/src/hooks/useCheckRun.js`
- Test: `demo_api_ui/src/hooks/__tests__/useCheckRun.test.js`

**Interfaces:**
- Produces `useCheckRun()` → `{ catalog, results, verdict, running, loadCatalog(), runAll({ includeHeavy }), setResult(result) }`.
  - `catalog`: `{ flags, checks: [{id,name,category,heavy}] } | null`.
  - `results`: `Record<checkId, { id,name,category,status,detail,meta,durationMs }>` (keyed for live upsert).
  - `verdict`: `'ready' | 'ready_with_warnings' | 'not_ready' | null` — any `fail` ⇒ not_ready; else any `warn` ⇒ ready_with_warnings; else if ≥1 result ⇒ ready; else null.
  - `runAll`: opens `POST /api/check/run` (SSE via fetch stream), calling `setResult` on each `event: result`.
  - `setResult`: upsert one result (used by the chip test too).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/hooks/__tests__/useCheckRun.test.js
import { renderHook, act } from '@testing-library/react';
import { deriveVerdict } from '../useCheckRun';

describe('deriveVerdict', () => {
  test('null when empty', () => { expect(deriveVerdict({})).toBe(null); });
  test('ready when all pass', () => {
    expect(deriveVerdict({ a: { status: 'pass' }, b: { status: 'skip' } })).toBe('ready');
  });
  test('warn precedence', () => {
    expect(deriveVerdict({ a: { status: 'pass' }, b: { status: 'warn' } })).toBe('ready_with_warnings');
  });
  test('fail wins', () => {
    expect(deriveVerdict({ a: { status: 'warn' }, b: { status: 'fail' } })).toBe('not_ready');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/hooks/__tests__/useCheckRun.test.js`
Expected: FAIL — cannot find `../useCheckRun`.

- [ ] **Step 3: Write the hook**

```js
// demo_api_ui/src/hooks/useCheckRun.js
import { useCallback, useState } from 'react';

export function deriveVerdict(results) {
  const list = Object.values(results);
  if (!list.length) return null;
  if (list.some((r) => r.status === 'fail')) return 'not_ready';
  if (list.some((r) => r.status === 'warn')) return 'ready_with_warnings';
  return 'ready';
}

// Parse a fetch ReadableStream of SSE frames, invoking onEvent(eventName, data).
async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const ev = /event: (.*)/.exec(frame)?.[1];
      const dataLine = /data: (.*)/.exec(frame)?.[1];
      if (ev && dataLine) onEvent(ev, JSON.parse(dataLine));
    }
  }
}

export function useCheckRun() {
  const [catalog, setCatalog] = useState(null);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);

  const loadCatalog = useCallback(async () => {
    const res = await fetch('/api/check/catalog', { credentials: 'include' });
    setCatalog(await res.json());
  }, []);

  const setResult = useCallback((r) => setResults((prev) => ({ ...prev, [r.id]: r })), []);

  const runAll = useCallback(async ({ includeHeavy = false } = {}) => {
    setRunning(true);
    try {
      const res = await fetch('/api/check/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeHeavy }),
      });
      await readSse(res, (ev, data) => { if (ev === 'result') setResult(data); });
    } finally { setRunning(false); }
  }, [setResult]);

  return { catalog, results, verdict: deriveVerdict(results), running, loadCatalog, runAll, setResult };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/hooks/__tests__/useCheckRun.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/hooks/useCheckRun.js demo_api_ui/src/hooks/__tests__/useCheckRun.test.js
git commit -m "feat(check-ui): useCheckRun hook — catalog, SSE run, verdict"
```

---

### Task 2: Frontend chip test action

**Files:**
- Create: `demo_api_ui/src/pages/check/chipTest.js`
- Test: `demo_api_ui/src/pages/check/__tests__/chipTest.test.js`

**Interfaces:**
- Consumes: `bffAxios` (`src/services/...` — confirm import path from `RunReportPage.js` in Step 1).
- Produces `runChipTest({ vertical, prompt }) => Promise<result>` where `result` matches the check-result shape: `{ id:'chip.e2e', name:'End-to-end chip', category:'End-to-End Chip', status, detail, meta, durationMs }`.
  - `pass` when `/api/agent/invoke` returns 200 and the response shows a successful tool call (`toolsCalled?.length` or a non-error final message).
  - `fail` on 4xx/5xx (403 authorize deny, 428 consent, 502 tool error) with the server message in `detail`.

- [ ] **Step 1: Confirm the bffAxios import + invoke response shape**

Run: `cd demo_api_ui && grep -n "bffAxios\|/api/agent/invoke\|toolsCalled" src/components/RunReportPage.js | head`
Use the exact import path and the field that signals a successful tool run in Step 3.

- [ ] **Step 2: Write the failing test**

```js
// demo_api_ui/src/pages/check/__tests__/chipTest.test.js
jest.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { post: jest.fn() } }));
import bffAxios from '../../../services/bffAxios';
import { runChipTest } from '../chipTest';

describe('runChipTest', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass when agent calls a tool', async () => {
    bffAxios.post.mockResolvedValue({ status: 200, data: { toolsCalled: ['get_account_balance'], finalMessage: 'Your balance is…' } });
    const r = await runChipTest({ vertical: 'banking', prompt: 'What is my balance?' });
    expect(r.status).toBe('pass');
    expect(r.id).toBe('chip.e2e');
  });

  test('fail when server rejects', async () => {
    bffAxios.post.mockRejectedValue({ response: { status: 403, data: { message: 'authorize denied' } } });
    const r = await runChipTest({ vertical: 'banking', prompt: 'x' });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/authorize denied/);
  });
});
```

- [ ] **Step 3: Write the action**

```js
// demo_api_ui/src/pages/check/chipTest.js
import bffAxios from '../../services/bffAxios'; // confirm path in Step 1

export async function runChipTest({ vertical = 'banking', prompt = 'What is my account balance?' } = {}) {
  const start = Date.now();
  const base = { id: 'chip.e2e', name: 'End-to-end chip', category: 'End-to-End Chip' };
  try {
    const res = await bffAxios.post('/api/agent/invoke', { prompt, vertical });
    const toolsCalled = res.data?.toolsCalled || [];
    const ok = res.status >= 200 && res.status < 300 && (toolsCalled.length > 0 || !!res.data?.finalMessage);
    return {
      ...base,
      status: ok ? 'pass' : 'warn',
      detail: ok ? `Completed via ${toolsCalled.join(', ') || 'agent response'}` : 'Agent responded but called no tool',
      meta: { toolsCalled, vertical },
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err?.response?.data?.message || err?.message || 'agent invoke failed';
    return { ...base, status: 'fail', detail: `${err?.response?.status || ''} ${msg}`.trim(), meta: null, durationMs: Date.now() - start };
  }
}
```

- [ ] **Step 4: Run test & commit**

Run: `cd demo_api_ui && npx jest src/pages/check/__tests__/chipTest.test.js`
Expected: PASS (2 tests).

```bash
git add demo_api_ui/src/pages/check/chipTest.js demo_api_ui/src/pages/check/__tests__/chipTest.test.js
git commit -m "feat(check-ui): frontend real chip test via /api/agent/invoke"
```

---

### Task 3: The four views (presentational components)

**Files:**
- Create: `demo_api_ui/src/pages/check/CardsView.jsx`, `StepperView.jsx`, `ChecklistView.jsx`, `RailDetailView.jsx`
- Create: `demo_api_ui/src/pages/CheckPage.css` (ported from the mock; CSS traffic-light dots)
- Test: `demo_api_ui/src/pages/check/__tests__/views.test.jsx`

**Interfaces:**
- Each view: `export default function XView({ catalog, results, verdict })`. Groups `results`/`catalog.checks` by `category`. Renders status via CSS classes `s-pass|s-warn|s-fail|s-idle` (dot span `.light`) — **no emoji**.
- Category → light: worst status among its checks (`fail>warn>pass`; none-run ⇒ idle).

- [ ] **Step 1: Port the CSS from the mock**

Copy the `:root` token block, theme blocks, `.light`/`s-*`, `.card*`, `.step*`, `.group*`, `.rows/.row`, `.split/.rail*` rules from the published mock (`check-page-mocks.html`) into `CheckPage.css`. Remove the tab/demo-only chrome. Keep both light/dark token sets.

- [ ] **Step 2: Write the failing test (CardsView groups + status)**

```jsx
// demo_api_ui/src/pages/check/__tests__/views.test.jsx
import { render, screen } from '@testing-library/react';
import CardsView from '../CardsView';

const catalog = { flags: {}, checks: [
  { id: 'servers.all_up', name: 'All servers running', category: 'Servers' },
  { id: 'llm.status', name: 'LLM models', category: 'LLM' },
] };

test('CardsView shows a card per category with worst-status class', () => {
  const results = { 'servers.all_up': { id: 'servers.all_up', category: 'Servers', status: 'pass', detail: '12/12 up' } };
  render(<CardsView catalog={catalog} results={results} verdict="ready" />);
  expect(screen.getByText('Servers')).toBeInTheDocument();
  expect(screen.getByText('LLM')).toBeInTheDocument();
  expect(screen.getByText(/12\/12 up/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Implement `CardsView` (then the other three by the same contract)**

```jsx
// demo_api_ui/src/pages/check/CardsView.jsx
import React from 'react';

const RANK = { fail: 3, warn: 2, pass: 1, skip: 0 };
function worst(statuses) {
  if (!statuses.length) return 'idle';
  const top = statuses.reduce((a, s) => (RANK[s] > RANK[a] ? s : a), 'skip');
  return top === 'skip' ? 'pass' : top;
}

function groupByCategory(catalog, results) {
  const cats = {};
  for (const c of catalog?.checks || []) {
    (cats[c.category] ||= []).push({ ...c, result: results[c.id] || null });
  }
  return cats;
}

export default function CardsView({ catalog, results }) {
  const cats = groupByCategory(catalog, results);
  return (
    <div className="grid">
      {Object.entries(cats).map(([category, checks]) => {
        const done = checks.map((c) => c.result?.status).filter(Boolean);
        const cls = done.length ? `s-${worst(done)}` : 's-idle';
        const summary = checks.find((c) => c.result?.detail)?.result?.detail || 'Not run';
        return (
          <div className={`card ${cls}`} key={category}>
            <div className="card-top"><span className="light" /><span className="title">{category}</span></div>
            <div className="card-sub">{summary}</div>
          </div>
        );
      })}
    </div>
  );
}
```

Implement `ChecklistView`, `RailDetailView`, `StepperView` using the same `groupByCategory`/`worst` helpers (extract them to `src/pages/check/status.js` and import in each) and the corresponding markup ported from the mock. Each renders CSS dots, never emoji.

- [ ] **Step 4: Run view tests & commit**

Run: `cd demo_api_ui && npx jest src/pages/check/__tests__/views.test.jsx`
Expected: PASS.

```bash
git add demo_api_ui/src/pages/check demo_api_ui/src/pages/CheckPage.css
git commit -m "feat(check-ui): four result views + CSS traffic-light dots"
```

---

### Task 4: `CheckPage` shell + view switcher + actions

**Files:**
- Create: `demo_api_ui/src/pages/CheckPage.jsx`
- Test: `demo_api_ui/src/pages/__tests__/CheckPage.test.jsx`

**Interfaces:**
- Consumes: `useCheckRun`, the four views, `runChipTest`, `CheckPage.css`.
- Produces default-exported `CheckPage` component. On mount calls `loadCatalog()`. Renders: verdict bar (READY / READY WITH WARNINGS / NOT READY from `verdict`) + `Run all checks` (→ `runAll({includeHeavy:false})`), a view switcher (Cards default, Stepper, Checklist, Rail+Detail), and the heavyweight actions `Run real chip test` (vertical select → `runChipTest` → `setResult`) and `Deep LLM test` (→ `runAll({includeHeavy:true})`).

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/CheckPage.test.jsx
import { render, screen, waitFor } from '@testing-library/react';
import CheckPage from '../CheckPage';

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/catalog')) {
      return Promise.resolve({ json: () => Promise.resolve({ flags: {}, checks: [{ id: 'servers.all_up', name: 'All servers running', category: 'Servers' }] }) });
    }
    return Promise.resolve({ body: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) } });
  });
});
afterEach(() => jest.clearAllMocks());

test('renders verdict bar and Run all button, loads catalog', async () => {
  render(<CheckPage />);
  expect(screen.getByRole('button', { name: /run all checks/i })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Servers')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/pages/__tests__/CheckPage.test.jsx`
Expected: FAIL — cannot find `../CheckPage`.

- [ ] **Step 3: Implement `CheckPage`**

```jsx
// demo_api_ui/src/pages/CheckPage.jsx
import React, { useEffect, useState } from 'react';
import './CheckPage.css';
import { useCheckRun } from '../hooks/useCheckRun';
import { runChipTest } from './check/chipTest';
import CardsView from './check/CardsView';
import StepperView from './check/StepperView';
import ChecklistView from './check/ChecklistView';
import RailDetailView from './check/RailDetailView';

const VIEWS = { cards: CardsView, stepper: StepperView, checklist: ChecklistView, rail: RailDetailView };
const VERDICT_TEXT = { ready: 'Ready for demo', ready_with_warnings: 'Ready — with warnings', not_ready: 'Not ready' };

export default function CheckPage() {
  const { catalog, results, verdict, running, loadCatalog, runAll, setResult } = useCheckRun();
  const [view, setView] = useState('cards');
  const [vertical, setVertical] = useState('banking');

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  const ViewComp = VIEWS[view];

  return (
    <div className="check-wrap">
      <div className={`verdict-bar verdict-${verdict || 'idle'}`}>
        <div className="verdict"><span className="dot" />
          <h2>{verdict ? VERDICT_TEXT[verdict] : 'Not run yet'}</h2></div>
        <div className="verdict-actions">
          <button className="btn btn-primary" disabled={running} onClick={() => runAll({ includeHeavy: false })}>Run all checks</button>
        </div>
      </div>

      <div className="check-tabs" role="tablist">
        {Object.keys(VIEWS).map((k) => (
          <button key={k} role="tab" aria-selected={view === k} className="tab" onClick={() => setView(k)}>{k}</button>
        ))}
      </div>

      <div className="check-actions">
        <label>Vertical
          <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
            <option value="banking">banking</option>
            <option value="healthcare">healthcare</option>
            <option value="workforce">workforce</option>
          </select>
        </label>
        <button className="btn btn-ghost" onClick={async () => setResult(await runChipTest({ vertical }))}>Run real chip test</button>
        <button className="btn btn-ghost" onClick={() => runAll({ includeHeavy: true })}>Deep LLM test</button>
      </div>

      <ViewComp catalog={catalog} results={results} verdict={verdict} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/pages/__tests__/CheckPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/CheckPage.jsx demo_api_ui/src/pages/__tests__/CheckPage.test.jsx
git commit -m "feat(check-ui): CheckPage shell — verdict, view switcher, heavy actions"
```

---

### Task 5: Route + side-nav wiring (invoke regression-guard first)

**Files:**
- Modify: `demo_api_ui/src/App.js` (add `/check` route, following the `/servers` block ~line 509)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (add nav item near `/servers` ~line 711)
- Test: `demo_api_ui/src/components/__tests__/adminSideNav.test.jsx` (extend — assert Check item present)

**Interfaces:**
- Consumes: `CheckPage`.
- Produces: authenticated `/check` route (logged-in only, no admin gate); side-nav item `{ label: 'Check', path: '/check', icon: 'clk' }` **without** `adminOnly`.

- [ ] **Step 1: Invoke the regression-guard skill**

This edits protected UI surfaces (`App.js`, side nav). Invoke `regression-guard` and state what you will NOT break (existing routes, nav filtering, role gating), keep the diff minimal.

- [ ] **Step 2: Add the import + route in `App.js`**

Near the other page imports (~line 103): `import CheckPage from "./pages/CheckPage";`
Add a route mirroring the `/servers` block exactly, swapping path and component:

```jsx
<Route
  path="/check"
  element={
    loading ? null : user ? (
      <>
        <TopNav user={user} onLogout={logout} />
        <main className="main-content"><CheckPage /></main>
      </>
    ) : (<Navigate to="/" replace />)
  }
/>
```

- [ ] **Step 3: Add the side-nav item in `AdminSideNav.jsx`**

Next to `{ label: "Servers", path: "/servers", icon: "clk" }` (~line 711), add:

```jsx
    { label: "Check", path: "/check", icon: "clk" },
```

(No `adminOnly` → visible and runnable for every logged-in user.)

- [ ] **Step 4: Extend the side-nav test**

```jsx
// in demo_api_ui/src/components/__tests__/adminSideNav.test.jsx
test('Check item is present for any user (no admin gate)', () => {
  // render the nav as a non-admin user per the file's existing render helper
  // then assert:
  expect(screen.getByText('Check')).toBeInTheDocument();
});
```

- [ ] **Step 5: Run UI tests**

Run: `cd demo_api_ui && npx jest src/components/__tests__/adminSideNav.test.jsx src/pages/__tests__/CheckPage.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/components/__tests__/adminSideNav.test.jsx
git commit -m "feat(check-ui): route /check + side-nav entry for all users"
```

---

### Task 6: Build gate + end-to-end verification

- [ ] **Step 1: UI unit suite**

Run: `cd demo_api_ui && npm run test:ui`
Expected: PASS (no regressions).

- [ ] **Step 2: UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds with no type/import errors.

- [ ] **Step 3: Manual smoke (live stack)**

Start the stack (`./run.sh`), log in, open the side nav → **Check**, click **Run all checks**: cards light up green/amber/red; switch to Stepper/Checklist/Rail views; run **Run real chip test** and confirm a pass/fail row appears; confirm READY / NOT READY banner reflects results. (Use the `verify` skill to drive this.)

- [ ] **Step 4: Commit any fixups**

```bash
git add -u demo_api_ui && git commit -m "test(check-ui): build gate + smoke green" || echo "nothing to commit"
```

---

## Self-Review

- `/check` reachable from side nav by any user → Task 5 (no `adminOnly`). ✓
- Four switchable views over one results model → Tasks 3–4. ✓
- Cards default + stepper + checklist + rail → Task 3; switcher → Task 4. ✓
- SSE consumption of `POST /api/check/run` → Task 1 (`readSse` fetch-stream). ✓
- Real chip test via live session (`/api/agent/invoke`) folded into the same model → Tasks 2, 4. ✓
- Deep LLM via `includeHeavy` → Task 4. ✓
- CSS traffic lights, emoji allowlist, regression-guard, build gate → Global Constraints + Tasks 3, 5, 6. ✓
- **Confirm steps (not placeholders):** Task 2 Step 1 confirms `bffAxios` path + the invoke success field from `RunReportPage.js`; Task 5 Step 4 uses the nav test's existing render helper. Defaults provided.
- Type consistency: result shape `{id,name,category,status,detail,meta,durationMs}` and `pass|fail|warn|skip` match Plans 1–2; `chip.e2e` id is unique.
