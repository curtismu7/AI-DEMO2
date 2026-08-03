# Guided Demo Track — Plan B: Standalone Page + Run History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The full-presenter "Guided Demo Track" standalone page (side-nav entry, act banners, step cards with takeaways, gauntlet grid with "Run all", run-history picker, printable finish summary) plus the one Plan A residual server fix (freeze filled slots against fallback-scan restamps).

**Architecture:** Plan A already shipped everything server-side: `config/demoTrack.js` (definition), `services/demoTrackService.js` (run ledger + matcher + LMDB), `/api/demo-track` routes, and observation hooks. Plan B is a new route-level page `pages/DemoTrackPage.jsx` that polls `GET /api/demo-track`, lists history from `GET /api/demo-track/runs`, triggers gauntlet sims through the existing `POST /api/demo/attack-sim/run`, and renders the presenter view from the mock. One small service change: the fallback scan must not overwrite an already-stamped slot.

**Tech Stack:** Server: Node >= 22, CommonJS + Express + jest + supertest. UI: React 19 + Vite 8 + **vitest** (never jest for UI). HTTP from the page goes through `services/apiClient` (UI standing rule).

**Spec:** `docs/superpowers/specs/2026-08-03-guided-demo-track-design.md` §"1. Standalone page". Mock: `docs/superpowers/specs/assets/2026-08-03-guided-demo-track/demo-track-mock.html` — copy its layout/visual language, not its markup verbatim.

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. This plan's UI uses only `✓` and `✕`.
- Work on worktree branch `worktree-demo-track-plan-b`. Stage files explicitly (`git add <file>`), never `git add -A` (jest regenerates files under `demo_api_server/data/`).
- Server tests: `cd demo_api_server && CI=true npx jest tests/<file> --forceExit`. In the worktree jest needs the `--testPathIgnorePatterns` override from the `verify-ai-demo2` skill if "No tests found" appears.
- UI tests: `cd demo_api_ui && npx vitest run src/pages/__tests__/<file>` — vitest, never jest.
- UI HTTP: `import apiClient from "../services/apiClient"` — never raw `axios`, and prefer apiClient over `fetch` for new pages.
- No new server endpoints. `GET /api/demo-track` (state), `POST /api/demo-track/runs` (new run), `GET /api/demo-track/runs` (history), `POST /api/demo-track/active-step`, `POST /api/demo/attack-sim/run` `{ sim }` already exist and are sufficient.
- Do not modify auth, token exchange, or session code (REGRESSION_PLAN §0/§1).
- Do not modify `TokenChainDemoTrackTab.jsx` — its known cosmetic counter issue is out of scope here.
- All six gauntlet sims are already in the attack route's `VALID_SIMS` (verified 2026-08-03): `insufficient-scope`, `cross-owner-account`, `wrong-aud`, `tampered-intent-token`, `impersonation-no-act`, `introspection-down`.

## Interfaces inherited from Plan A (read-only contract)

`GET /api/demo-track` → `{ track: { steps, gauntletSims }, run }`.
Step shape: `{ stepId, act (1|2), title, capability, ucIds[], buyerStory, slots: { green?, red? }, proved: { green, red, sayThis } }`; slot: `{ source: 'tool'|'sim', chipText?, label?, match, expected[] }`. Gauntlet step has `stepId: 'attack-gauntlet'` and no green slot.
Run shape: `{ runId, startedAt, activeStepId, slots: { '<stepId>:green'|'<stepId>:red': { verdict, decisionId, via, at } }, gauntlet: { '<sim>': { blocked, status, errorCode, decisionId, at } } }`.
`GET /api/demo-track/runs` → `{ runs: [ { ...run, endedAt } ] }` newest first, cap 20.

---

### Task 1: Service — filled slots survive the fallback scan

Plan A residual (recorded in plan-a doc §"Post-merge residuals"): a gauntlet sim that runs the full pipeline can restamp an already-proved slot (e.g. `fine-grained-authz:red`) via the fallback scan, changing the decision ID the presenter already showed. Fix: the **fallback scan** (non-active steps, `wildcardOk === false`) skips steps whose target slot is already stamped. The **active step** keeps overwrite semantics (re-running the active step's flow refreshes its stamp — by design).

**Files:**
- Modify: `demo_api_server/services/demoTrackService.js` (`_candidates` call sites — `observeToolCall`, `observeDecision`, `observeAttackSim`)
- Test: `demo_api_server/tests/demoTrackService.test.js` (extend existing file)

**Interfaces:**
- Consumes: existing exports of `demoTrackService` (`_resetForTests`, `observeToolCall`, `observeDecision`, `setActiveStep`, `getState`).
- Produces: no signature changes — behavior only.

- [ ] **Step 1: Write the failing test** — append to `demo_api_server/tests/demoTrackService.test.js`:

```js
describe('fallback scan does not restamp filled slots', () => {
  beforeEach(() => svc._resetForTests());

  test('non-active step keeps its first stamp when a later observation matches it', () => {
    // Fill fine-grained-authz:red while it is NOT active (fallback scan), then
    // send a second matching observation — the stamp must not change.
    svc.setActiveStep('delegated-access');
    svc.observeDecision({ tool: 'transfer_funds', decision: 'DENY', decisionId: 'dec-1' });
    const first = svc.getState().run.slots['fine-grained-authz:red'];
    expect(first.decisionId).toBe('dec-1');

    svc.observeDecision({ tool: 'transfer_funds', decision: 'DENY', decisionId: 'dec-2' });
    const after = svc.getState().run.slots['fine-grained-authz:red'];
    expect(after.decisionId).toBe('dec-1'); // frozen — not dec-2
  });

  test('active step still overwrites its own stamp on re-run', () => {
    svc.setActiveStep('fine-grained-authz');
    svc.observeDecision({ tool: 'transfer_funds', decision: 'DENY', decisionId: 'dec-1' });
    svc.observeDecision({ tool: 'transfer_funds', decision: 'DENY', decisionId: 'dec-2' });
    expect(svc.getState().run.slots['fine-grained-authz:red'].decisionId).toBe('dec-2');
  });
});
```

(`svc` is already required at the top of the existing test file as `const svc = require('../services/demoTrackService');` — reuse it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrackService.test.js --forceExit`
Expected: FAIL — `after.decisionId` is `'dec-2'` (fallback scan restamped).

- [ ] **Step 3: Minimal implementation** — in `demoTrackService.js`, add one helper and use it in the three observe functions' candidate loops:

```js
function _slotOpen(run, step, color, wildcardOk) {
  // Active step (wildcardOk) may re-stamp itself; fallback scan never
  // overwrites a stamp the presenter has already shown.
  return wildcardOk || !run.slots[`${step.stepId}:${color}`];
}
```

In `observeToolCall`, guard both fills: `if (g && g.source === 'tool' && _slotOpen(run, step, 'green', wildcardOk) && _toolMatches(...))` and the symmetric `red` branch. In `observeDecision`, same guard on the red fill. In `observeAttackSim`, the per-step red fill loop iterates `_candidates(run)` but discards `wildcardOk` — destructure it and guard: `if (r && r.source === 'sim' && _slotOpen(run, step, 'red', wildcardOk) && r.match.sims.includes(sim))`.

- [ ] **Step 4: Run the full service + hooks + route suites**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrackService.test.js tests/demoTrackHooks.test.js tests/demoTrackRoute.test.js tests/demoTrack.config.test.js --forceExit`
Expected: all PASS (existing overwrite-semantics tests, if any assert restamps on non-active steps, must be updated to assert the new freeze — but check first; Plan A recorded the overwrite path as untested, so no collision is expected).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/demoTrackService.js demo_api_server/tests/demoTrackService.test.js
git commit -m "fix(demo-track): fallback scan never restamps a filled slot"
```

---

### Task 2: DemoTrackPage — data load, act banners, step cards, takeaways

**Files:**
- Create: `demo_api_ui/src/pages/DemoTrackPage.jsx`
- Create: `demo_api_ui/src/pages/DemoTrackPage.css`
- Test: `demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/demo-track` via `apiClient.get('/api/demo-track')` (returns `{ data: { track, run } }`).
- Produces: default export `DemoTrackPage` (no props) — consumed by Task 4's App.js route. Internal helpers `StepCard` and `slotStamp` stay module-private.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoTrackPage from '../DemoTrackPage';

const STATE = {
  track: {
    steps: [
      { stepId: 'delegated-access', act: 1, title: 'Delegated access — token exchange', capability: 'RFC 8693 · act claim', ucIds: ['UC1', 'UC3'], buyerStory: 'Every agent action must trace back to a real human.', slots: { green: { source: 'tool', chipText: 'show my balance', expected: ['PERMIT'] }, red: { source: 'sim', label: 'stolen token rejected', expected: ['BLOCKED'] } }, proved: { green: 'act claim proves delegation', red: 'replayed token died at the gateway', sayThis: 'Every agent action is tied to its user.' } },
      { stepId: 'attack-gauntlet', act: 1, title: 'Attack gauntlet', capability: 'finale', ucIds: ['UC26'], buyerStory: 'Six attacks, six blocks.', slots: { red: { source: 'sim', label: 'six attacks blocked', match: { sims: [] }, expected: ['BLOCKED'] } }, proved: { green: null, red: 'every attack died with a live verdict', sayThis: 'Attacks fail loudly here.' } },
      { stepId: 'pingone-mcp-admin', act: 2, title: 'PingOne MCP server — admin agent', capability: 'admin', ucIds: ['UC-LEARN2'], buyerStory: 'Admin AI is governed too.', slots: { green: { source: 'tool', chipText: 'list users', expected: ['PERMIT'] }, red: { source: 'tool', chipText: 'out-of-scope call', expected: ['DENY'] } }, proved: { green: 'real admin work through hosted MCP', red: 'out-of-scope admin call denied', sayThis: 'Same rails govern the admins.' } },
    ],
    gauntletSims: [
      { sim: 'insufficient-scope', ucId: 'UC5', label: 'Wrong scope' },
      { sim: 'wrong-aud', ucId: 'UC11', label: 'Bad client' },
    ],
  },
  run: {
    runId: 'run-1', startedAt: '2026-08-03T10:00:00Z', activeStepId: 'delegated-access',
    slots: { 'delegated-access:green': { verdict: 'PERMIT', decisionId: 'dec-9', via: 'get_account_balance', at: '2026-08-03T10:42:00Z' } },
    gauntlet: { 'insufficient-scope': { blocked: true, status: 403, decisionId: null, at: '2026-08-03T10:43:00Z' } },
  },
};

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
import apiClient from '../../services/apiClient';

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockImplementation((url) =>
    url === '/api/demo-track'
      ? Promise.resolve({ data: STATE })
      : Promise.resolve({ data: { runs: [] } })
  );
});

describe('DemoTrackPage', () => {
  it('renders both act banners and every step title', async () => {
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByText(/Delegated access/)).toBeInTheDocument());
    expect(screen.getByText(/ACT 1/)).toBeInTheDocument();
    expect(screen.getByText(/ACT 2/)).toBeInTheDocument();
    expect(screen.getByText(/PingOne MCP server/)).toBeInTheDocument();
  });

  it('active step is expanded: buyer story, slot rows, filled stamp with decision id', async () => {
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByText(/Every agent action must trace back/)).toBeInTheDocument());
    expect(screen.getByText(/PERMIT/)).toBeInTheDocument();
    expect(screen.getByText(/dec-9/)).toBeInTheDocument();
    expect(screen.getByText(/stolen token rejected/)).toBeInTheDocument();
  });

  it('collapsed step shows the one-line summary, and clicking expands it', async () => {
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByText(/PingOne MCP server/)).toBeInTheDocument());
    expect(screen.queryByText(/Admin AI is governed too/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/PingOne MCP server/));
    expect(screen.getByText(/Admin AI is governed too/)).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/api/demo-track/active-step', { stepId: 'pingone-mcp-admin' });
  });

  it('takeaway card renders when a step is complete', async () => {
    const done = JSON.parse(JSON.stringify(STATE));
    done.run.slots['delegated-access:red'] = { verdict: 'BLOCKED', decisionId: 'dec-2', via: 'replayed-token', at: '2026-08-03T10:44:00Z' };
    apiClient.get.mockImplementation((url) =>
      url === '/api/demo-track' ? Promise.resolve({ data: done }) : Promise.resolve({ data: { runs: [] } })
    );
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByText(/WHAT THIS PROVED/)).toBeInTheDocument());
    expect(screen.getByText(/SAY THIS/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: FAIL — cannot resolve `../DemoTrackPage`.

- [ ] **Step 3: Implement the page skeleton**

```jsx
// demo_api_ui/src/pages/DemoTrackPage.jsx
// Guided Demo Track — standalone presenter page (spec surface 1).
// Layout follows docs/superpowers/specs/assets/2026-08-03-guided-demo-track/demo-track-mock.html.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "../services/apiClient";
import "./DemoTrackPage.css";

const POLL_MS = 5000;

function stamp(s) {
  if (!s) return null;
  const good = s.verdict === "PERMIT";
  return (
    <span className={`dtp-stamp ${good ? "dtp-stamp--green" : "dtp-stamp--red"}`}>
      {s.verdict} {good ? "✓" : "✕"}
      {s.at ? ` · ${new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
      {s.decisionId ? <span className="dtp-decision"> · {s.decisionId}</span> : null}
    </span>
  );
}

function SlotRow({ tag, slot, filled }) {
  if (!slot) return null;
  return (
    <div className="dtp-slot-row">
      <span className={`dtp-tag dtp-tag--${tag === "GREEN" ? "g" : "r"}`}>{tag}</span>
      <span className="dtp-slot-label">{slot.chipText || slot.label}</span>
      {filled ? stamp(filled) : <span className="dtp-stamp dtp-stamp--empty">pending</span>}
    </div>
  );
}

function stepComplete(step, run, gauntletSims) {
  if (step.stepId === "attack-gauntlet") {
    return gauntletSims.length > 0 && gauntletSims.every((g) => run.gauntlet[g.sim]?.blocked);
  }
  const g = !step.slots.green || run.slots[`${step.stepId}:green`];
  const r = !step.slots.red || run.slots[`${step.stepId}:red`];
  return Boolean(g && r);
}

function StepCard({ step, index, run, gauntletSims, expanded, onSelect, gauntletPanel }) {
  const complete = stepComplete(step, run, gauntletSims);
  const green = run.slots[`${step.stepId}:green`];
  const red = run.slots[`${step.stepId}:red`];
  const summary = `${green ? "✓" : "·"} ${red || complete ? "✕" : "·"}`;
  return (
    <section className={`dtp-step${expanded ? " dtp-step--open" : ""}${complete ? " dtp-step--done" : ""}`}>
      <button type="button" className="dtp-step-head" onClick={() => onSelect(step.stepId)}>
        <span className="dtp-step-num">{index + 1}</span>
        <span className="dtp-step-title">{step.title}</span>
        <span className="dtp-step-cap">{step.capability}</span>
        {!expanded && <span className="dtp-step-summary">{summary}</span>}
        <span className="dtp-step-ucs">{step.ucIds.join(" · ")}</span>
      </button>
      {expanded && (
        <div className="dtp-step-body">
          <p className="dtp-story">{step.buyerStory}</p>
          {step.stepId === "attack-gauntlet" ? gauntletPanel : (
            <>
              <SlotRow tag="GREEN" slot={step.slots.green} filled={green} />
              <SlotRow tag="RED" slot={step.slots.red} filled={red} />
            </>
          )}
          {complete && (
            <div className="dtp-proved">
              <h4>WHAT THIS PROVED</h4>
              {step.proved.green && <div className="dtp-proved-line"><span className="dtp-mark-g">✓</span> {step.proved.green}</div>}
              {step.proved.red && <div className="dtp-proved-line"><span className="dtp-mark-r">✕</span> {step.proved.red}</div>}
              <div className="dtp-say">SAY THIS: {step.proved.sayThis}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function DemoTrackPage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/demo-track");
      setState(res.data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const select = useCallback(async (stepId) => {
    setExpandedId(stepId);
    try {
      await apiClient.post("/api/demo-track/active-step", { stepId });
      load();
    } catch { /* next poll recovers */ }
  }, [load]);

  const expanded = expandedId || state?.run?.activeStepId;

  const acts = useMemo(() => {
    if (!state) return [];
    return [
      { n: 1, label: "ACT 1 · THE CUSTOMER AGENT", steps: state.track.steps.filter((s) => s.act === 1) },
      { n: 2, label: "ACT 2 · SAME RAILS GOVERN THE ADMINS", steps: state.track.steps.filter((s) => s.act === 2) },
    ];
  }, [state]);

  if (error) return <div className="dtp-error">Demo Track unavailable — {error}</div>;
  if (!state) return <div className="dtp-loading">Loading demo track…</div>;

  const { track, run } = state;
  let idx = -1;
  return (
    <div className="dtp-root">
      <header className="dtp-topbar">
        <h2>Guided Demo Track</h2>
        <div className="dtp-dots">
          {track.steps.map((s) => (
            <button key={s.stepId} type="button" title={s.title}
              className={`dtp-dot${stepComplete(s, run, track.gauntletSims) ? " dtp-dot--done" : ""}${run.activeStepId === s.stepId ? " dtp-dot--active" : ""}`}
              onClick={() => select(s.stepId)} />
          ))}
        </div>
      </header>
      {acts.map((act) => (
        <React.Fragment key={act.n}>
          <div className="dtp-act">{act.label}</div>
          {act.steps.map((s) => { idx += 1; return (
            <StepCard key={s.stepId} step={s} index={idx} run={run} gauntletSims={track.gauntletSims}
              expanded={expanded === s.stepId} onSelect={select} gauntletPanel={null} />
          ); })}
        </React.Fragment>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Minimal CSS** — `demo_api_ui/src/pages/DemoTrackPage.css`. Follow the mock's visual language (dark cards, green/red accent rails); required classes: `dtp-root`, `dtp-topbar` (`position: sticky; top: 0`), `dtp-dots`/`dtp-dot`/`dtp-dot--done`/`dtp-dot--active`, `dtp-act`, `dtp-step`, `dtp-step-head`, `dtp-step-summary`, `dtp-slot-row`, `dtp-tag--g`/`dtp-tag--r`, `dtp-stamp--green`/`dtp-stamp--red`/`dtp-stamp--empty`, `dtp-decision`, `dtp-proved`, `dtp-say`, `dtp-error`, `dtp-loading`. Reuse the palette variables already used in `TokenChainDemoTrackTab.css` where sensible.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/DemoTrackPage.jsx demo_api_ui/src/pages/DemoTrackPage.css demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx
git commit -m "feat(demo-track): standalone presenter page — acts, step cards, takeaways"
```

---

### Task 3: Gauntlet grid with "Run all" + running score

**Files:**
- Modify: `demo_api_ui/src/pages/DemoTrackPage.jsx` (replace `gauntletPanel={null}` with a real panel)
- Modify: `demo_api_ui/src/pages/DemoTrackPage.css` (tile classes)
- Test: `demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx` (extend)

**Interfaces:**
- Consumes: `POST /api/demo/attack-sim/run` with body `{ sim: '<sim-name>' }` via apiClient (existing route; observation hook fills `run.gauntlet` server-side).
- Produces: `GauntletPanel({ sims, gauntlet, onRunAll, running })` module-private component.

- [ ] **Step 1: Write the failing tests** — append to the describe block:

```jsx
  it('gauntlet grid shows tiles, score, and BLOCKED verdicts', async () => {
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByText(/Attack gauntlet/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Attack gauntlet/));
    await waitFor(() => expect(screen.getByText(/1 \/ 2 blocked/)).toBeInTheDocument());
    expect(screen.getByText(/Wrong scope/)).toBeInTheDocument();
    expect(screen.getByText(/Bad client/)).toBeInTheDocument();
  });

  it('"Run all" posts every sim to the attack-sim route', async () => {
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByText(/Attack gauntlet/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Attack gauntlet/));
    await userEvent.click(await screen.findByRole('button', { name: /Run all/ }));
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/demo/attack-sim/run', { sim: 'insufficient-scope' });
      expect(apiClient.post).toHaveBeenCalledWith('/api/demo/attack-sim/run', { sim: 'wrong-aud' });
    });
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: the two new tests FAIL (no score line, no Run all button); the four Task 2 tests still PASS.

- [ ] **Step 3: Implement `GauntletPanel`** — add to `DemoTrackPage.jsx`:

```jsx
function GauntletPanel({ sims, gauntlet, onRunAll, running }) {
  const blocked = sims.filter((g) => gauntlet[g.sim]?.blocked).length;
  return (
    <div className="dtp-gauntlet">
      <div className="dtp-gauntlet-bar">
        <span className="dtp-gauntlet-score">{blocked} / {sims.length} blocked</span>
        <button type="button" className="dtp-runall" disabled={running} onClick={onRunAll}>
          {running ? "Running…" : "Run all"}
        </button>
      </div>
      <div className="dtp-tiles">
        {sims.map((g) => {
          const r = gauntlet[g.sim];
          return (
            <div key={g.sim} className={`dtp-tile${r?.blocked ? " dtp-tile--blocked" : ""}`}>
              <span className="dtp-tile-label">{g.label}</span>
              <span className="dtp-tile-uc">{g.ucId}</span>
              {r?.blocked && <span className="dtp-tile-verdict">BLOCKED ✕ {r.status}{r.decisionId ? ` · ${r.decisionId}` : ""}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

In `DemoTrackPage`, add state `const [running, setRunning] = useState(false);` and:

```jsx
  const runAll = useCallback(async () => {
    if (!state) return;
    setRunning(true);
    try {
      for (const g of state.track.gauntletSims) {
        // sequential on purpose — parallel sims share backend fixtures
        // eslint-disable-next-line no-await-in-loop
        await apiClient.post("/api/demo/attack-sim/run", { sim: g.sim }).catch(() => {});
      }
    } finally {
      setRunning(false);
      load();
    }
  }, [state, load]);
```

Pass `gauntletPanel={<GauntletPanel sims={track.gauntletSims} gauntlet={run.gauntlet} onRunAll={runAll} running={running} />}` at the `StepCard` call site. CSS: `dtp-gauntlet`, `dtp-gauntlet-bar`, `dtp-gauntlet-score`, `dtp-runall`, `dtp-tiles` (grid, 3 columns), `dtp-tile`, `dtp-tile--blocked`, `dtp-tile-verdict`.

- [ ] **Step 4: Run the suite**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/DemoTrackPage.jsx demo_api_ui/src/pages/DemoTrackPage.css demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx
git commit -m "feat(demo-track): gauntlet grid with Run all + live blocked score"
```

---

### Task 4: Run history picker + finish summary + print CSS

**Files:**
- Modify: `demo_api_ui/src/pages/DemoTrackPage.jsx`
- Modify: `demo_api_ui/src/pages/DemoTrackPage.css`
- Test: `demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx` (extend)

**Interfaces:**
- Consumes: `GET /api/demo-track/runs` → `{ runs: [...] }` (archived runs, newest first); `POST /api/demo-track/runs` (start new run).
- Produces: toolbar with run picker (`<select>`), "Start new run" button, `FinishSummary({ track, run })` module-private component. When a history run is selected the page renders that run read-only (no polling overwrite): keep `viewedRunId` state; `viewedRunId === null` means live.

- [ ] **Step 1: Write the failing tests** — append:

```jsx
  it('run picker lists history and switches to a past run read-only', async () => {
    apiClient.get.mockImplementation((url) =>
      url === '/api/demo-track'
        ? Promise.resolve({ data: STATE })
        : Promise.resolve({ data: { runs: [{ runId: 'run-0', startedAt: '2026-08-02T09:00:00Z', endedAt: '2026-08-02T09:30:00Z', activeStepId: 'pingone-mcp-admin', slots: { 'delegated-access:green': { verdict: 'PERMIT', decisionId: 'old-1', via: 'get_balance', at: '2026-08-02T09:05:00Z' } }, gauntlet: {} }] } })
    );
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByLabelText(/Run/)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/Run/), 'run-0');
    await waitFor(() => expect(screen.getByText(/old-1/)).toBeInTheDocument());
    expect(screen.getByText(/viewing past run/i)).toBeInTheDocument();
  });

  it('finish summary card renders when every step is complete', async () => {
    const done = JSON.parse(JSON.stringify(STATE));
    done.run.slots['delegated-access:red'] = { verdict: 'BLOCKED', decisionId: 'd-r1', via: 'replayed-token', at: '2026-08-03T10:44:00Z' };
    done.run.slots['pingone-mcp-admin:green'] = { verdict: 'PERMIT', decisionId: 'd-g9', via: 'list_users', at: '2026-08-03T10:45:00Z' };
    done.run.slots['pingone-mcp-admin:red'] = { verdict: 'DENY', decisionId: 'd-r9', via: 'delete_env', at: '2026-08-03T10:46:00Z' };
    done.run.gauntlet = { 'insufficient-scope': { blocked: true, status: 403 }, 'wrong-aud': { blocked: true, status: 401 } };
    apiClient.get.mockImplementation((url) =>
      url === '/api/demo-track' ? Promise.resolve({ data: done }) : Promise.resolve({ data: { runs: [] } })
    );
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByText(/TRACK COMPLETE/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Print/ })).toBeInTheDocument();
  });

  it('"Start new run" posts and reloads', async () => {
    render(<DemoTrackPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start new run/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Start new run/ }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/demo-track/runs'));
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: 3 new FAIL, 6 old PASS.

- [ ] **Step 3: Implement** — in `DemoTrackPage`:

- State: `const [history, setHistory] = useState([]);` `const [viewedRunId, setViewedRunId] = useState(null);`
- Load history alongside state: in `load`, `const h = await apiClient.get('/api/demo-track/runs'); setHistory(h.data.runs || []);` (single try/catch; history failure must not blank the live view — wrap separately or default `[]`).
- `const run = (viewedRunId && history.find((r) => r.runId === viewedRunId)) || state.run;` — all rendering below uses this `run` (fallback to live if the id vanishes from history). When `viewedRunId` is set, add a `dtp-banner` div: `viewing past run — <button>back to live</button>` (`onClick={() => setViewedRunId(null)}`).
- Toolbar in the sticky header:

```jsx
        <label className="dtp-runpick">Run{" "}
          <select value={viewedRunId || "live"} onChange={(e) => setViewedRunId(e.target.value === "live" ? null : e.target.value)}>
            <option value="live">Current ({new Date(state.run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})</option>
            {history.map((r) => (
              <option key={r.runId} value={r.runId}>{new Date(r.startedAt).toLocaleString()}</option>
            ))}
          </select>
        </label>
        <button type="button" className="dtp-newrun" onClick={startRun}>Start new run</button>
```

with `const startRun = useCallback(async () => { setViewedRunId(null); try { await apiClient.post('/api/demo-track/runs'); load(); } catch { /* next poll recovers */ } }, [load]);`
- `FinishSummary`: rendered after the act sections when every step satisfies `stepComplete(step, run, track.gauntletSims)`:

```jsx
function FinishSummary({ track, run }) {
  return (
    <section className="dtp-finish">
      <h3>TRACK COMPLETE — {track.steps.length} capabilities proved</h3>
      <ul>
        {track.steps.map((s) => {
          const g = run.slots[`${s.stepId}:green`];
          const r = run.slots[`${s.stepId}:red`];
          return (
            <li key={s.stepId}>
              <span className="dtp-fin-title">{s.title}</span>
              {g && <span className="dtp-mark-g"> ✓ {g.decisionId || g.via}</span>}
              {r && <span className="dtp-mark-r"> ✕ {r.decisionId || r.via}</span>}
              {s.stepId === "attack-gauntlet" && <span className="dtp-mark-r"> ✕ {track.gauntletSims.filter((x) => run.gauntlet[x.sim]?.blocked).length}/{track.gauntletSims.length} blocked</span>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="dtp-print" onClick={() => window.print()}>Print leave-behind</button>
    </section>
  );
}
```

- Print CSS in `DemoTrackPage.css`: `@media print { .dtp-topbar, .dtp-runall, .dtp-newrun, .dtp-print { display: none; } .dtp-step { break-inside: avoid; } }` — expand all steps' takeaways is not required; the finish summary is the leave-behind.

- [ ] **Step 4: Run the suite**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/DemoTrackPage.jsx demo_api_ui/src/pages/DemoTrackPage.css demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx
git commit -m "feat(demo-track): run history picker, finish summary, print leave-behind"
```

---

### Task 5: Route + side-nav wiring

**Files:**
- Modify: `demo_api_ui/src/App.js` (import + `<Route>`)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (nav entry)

**Interfaces:**
- Consumes: `DemoTrackPage` default export from Task 2.
- Produces: route `/demo-track`; nav label "Guided Demo Track".

- [ ] **Step 1: Add the route** — in `App.js`, add `import DemoTrackPage from "./pages/DemoTrackPage";` beside the other page imports, and next to the existing diagram-page routes (near the `/privilege-mcp-diagrams` route, ~line 1252):

```jsx
                            <Route
                              path="/demo-track"
                              element={<DemoTrackPage />}
                            />
```

- [ ] **Step 2: Add the nav entry** — in `AdminSideNav.jsx`, find the nav group that carries the demo/use-case pages (the same `items` array pattern as `{ label: "Privilege MCP Diagrams", path: "/privilege-mcp-diagrams", icon: "arc" }`). Add to the most demo-facing group (the one holding Use Cases / demo pages — pick by reading the groups, not by guessing):

```jsx
        { label: "Guided Demo Track", path: "/demo-track", icon: "arc" },
```

Match the group's existing icon convention — if its entries use a different icon token, copy that one.

- [ ] **Step 3: Verify by build (route wiring has no unit test)**

Run: `cd demo_api_ui && npm run build`
Expected: `✓ built` — no unresolved import, no JSX error.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat(demo-track): /demo-track route + Guided Demo Track side-nav entry"
```

---

### Task 6: Verification gate (whole branch)

**Files:** none — verification only.

- [ ] **Step 1: Server suite**

Run: `cd demo_api_server && CI=true npm test -- --forceExit` (worktree: add the `--testPathIgnorePatterns` override from `verify-ai-demo2`, keeping `/tests/real/` ignored)
Expected: green (Plan A baseline was 683 passed / 2 skipped; Task 1 adds 2).

- [ ] **Step 2: UI unit + build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: vitest green (Plan A baseline 2601 passed + this plan's 9; the 5 pre-existing unrelated failures noted in Plan A may still fail — verify they are the same 5), then `✓ built`.

- [ ] **Step 3: Emoji allowlist scan of the new files**

Run: `grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" demo_api_ui/src/pages/DemoTrackPage.jsx demo_api_ui/src/pages/DemoTrackPage.css demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx | grep -v "✓\|✕"`
Expected: no output.

- [ ] **Step 4: Do not claim done without the paste** — paste the result lines of steps 1–3 into the final report (root CLAUDE.md "Before claiming done").

---

## Post-plan notes

- Deferred to Plan C (agent dropdown): step banners in chat, chip-row swap, DraggableModal picker.
- Deferred (spec surface-2 polish, Plan A residual): mini token-chain strips per run line, decision-ID links into token detail views, tab live-dot.
- Known-gap fixes (spec §"Known gaps") — UC16 sim reaching policy, UC2 A2A 502s — are Plan D, not this branch.
