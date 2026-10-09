# Realistic MCP flows + dynamic step boxes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the real MCP 401 dance (anonymous call → 401 challenge → metadata → credentialed retry) everywhere flows are drawn, and make every step-box surface show only what actually happened in the run — non-fired hops collapse behind a `+N hops not in this run` chip.

**Architecture:** One shared visibility policy module (`stepVisibility.js`) replaces the four ad-hoc filters (rail live projection, reel HAPPENED set, topology UNFIRED_STATUSES, filmstrip). `buildTraceSteps` output is untouched — visibility is applied downstream, so no status vocabulary changes. UC diagram pages get a live overlay (fired hops from the trace store) over their curated fallback. The backend gains the missing `tools/list` 401 probe and the `tools/call` probe moves to its true wire position (after discovery, before the credentialed call). The static sequence page gets the two challenge legs as lettered steps (5a/5b, 25a/25b) plus a `discovery-dance` scenario — no renumbering.

**Tech Stack:** React (CRA-style jest/jsdom tests), Express BFF, Playwright (real-stack specs). No new dependencies.

**Spec:** Approved design from this session's conversation (2026-10-09). User decisions, verbatim from the AskUserQuestion answers:
- "Hide + collapse chip (Recommended)" — visibility policy for all step-box surfaces.
- "Show real dance everywhere (Recommended)" — challenge→list→challenge→call rendered as real hops.
- "Make UC walks live-driven" + "Curated fallback + live overlay (Recommended)".
- "Keep live probe (Recommended)" — mcpChallengeProbe stays.

Discovery-before-call (real `tools/list` leg on every gateway tool call) already shipped on main as commit `637235541`. This plan builds the UI/probe work on top of it.

## Global Constraints

- **Commit only from a git worktree.** The repo pre-commit hook blocks commits from the shared main checkout. Task 0 creates the worktree; every commit step runs inside it.
- End every commit message with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- All output and comments in English.
- **No new status strings.** Step statuses stay exactly `done | active | error | pending | notinpath | waiting` (buildTraceSteps.js:1292 documents why a new status breaks ~15 surfaces).
- Challenge hop ids stay `tools-list-challenge` / `tools-call-challenge`.
- In jest, drive flags/env via `process.env` (e.g. `FF_MCP_DISCOVERY_BEFORE_CALL`), never `jest.spyOn(configStore, ...)` — the global setup's `jest.resetModules()` makes module-captured spies stale (documented in mcpToolPipeline.discovery.test.js's header).
- No new npm dependencies. No renumbering of the static sequence page's numbered steps — letter suffixes only (the 18a–18d pattern).
- `buildTraceSteps.js` step construction is NOT modified in Tasks 1–4; only downstream consumers change. (Task 6 touches the *static* page, which is separate code.)
- Docker via OrbStack only (irrelevant to most tasks; applies if the stack is started for live verification).

## Review Focus

The five inputs most likely to bite a presenter, and the test that pins each:

1. **Free-typed prompt (no `useCaseId` on the trace)** → UC diagram page must fall back to the curated walk, never crash or show an empty overlay. Pinned in Task 7 (slug-null test).
2. **Guest / public-tool run (no bearer, probe skipped: `mcp_challenge_skipped`)** → dance hops collapse silently, never render as errors. Pinned in Task 1 (challenge-collapse test) and Task 5 (skipped-event test).
3. **Session-only state (sign-in happened, no agent run yet)** → all converted surfaces show empty/curated state, and the chip must not render as `+0 hops`. Pinned in Task 1 (session-only test).
4. **Mock-success replay traces** → revealed skipped steps keep their own teaching narratives; the SKIP_REASONS override must not stomp them. Pinned in Task 1 (mock-success test).
5. **Privilege A2A chain runs** (buildPrivilegeA2aChainSteps shortcut returns its own hop list) → visibility must pass them through unemptied. Pinned in Task 2 (privilege passthrough test).

---

### Task 0: Worktree setup

**Files:** none created (infrastructure).

- [ ] **Step 1: Create the worktree off current main**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git worktree add .claude/worktrees/realistic-flow-ui -b feat/realistic-flows-dynamic-steps main
```

- [ ] **Step 2: Install dependencies (background, both packages)**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_server && npm install --no-audit --no-fund
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_ui && npm install --no-audit --no-fund
```

Run each in the background; continue once both exit 0. (`npm ci` has failed in worktrees before; `npm install` is the proven path.)

- [ ] **Step 3: Baseline — confirm the suites are green before touching anything**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_server && npx jest src/__tests__/mcpToolPipeline.discovery.test.js src/__tests__/mcpGatewayClient.discovery.test.js
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_ui && npx jest src/services/tokenChainTrace src/components/__tests__/TokenChainTraceRail.test.jsx
```

Expected: PASS. If anything is red here, stop and record it — it is a pre-existing failure, not one this plan may silently absorb.

---

### Task 1: `stepVisibility` — the one policy module

**Files:**
- Create: `demo_api_ui/src/services/tokenChainTrace/stepVisibility.js`
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/stepVisibility.test.js`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (every later task imports these):
  - `applyStepVisibility(steps: Step[], trace: Trace, { collapsed = true }?) -> { visible: Step[], skipped: Step[], revealed: Step[] }`
  - `SKIP_REASONS: Record<string, string>` (moved verbatim from TokenChainTraceRail.jsx:64-85)
  - `HAPPENED_STATUSES = ["done", "active", "error", "waiting"]`

Policy (exact):
- **No run activity** (no `startedAt`/`prompt`/`tokenEvents`/`phases`/`mcpResult`/`authorize`/`llmDetail`/`llmReply`/`outcome`/`routingMode` — the rail's existing `hasActivity` check) → `{ visible: [], skipped: [], revealed: [] }`.
- **In-flight** (outcome not in `["ok","error","mock-success"]`) → `visible` = steps with status in `HAPPENED_STATUSES` OR `detail.notRequired`; `skipped` = `[]` (no chip mid-run).
- **Complete** → `visible` = same fired set; `skipped` = the rest, in original order. When `collapsed === false`, `revealed` = skipped steps each shallow-augmented with `detail.narrative = SKIP_REASONS[baseId] || "This possible step was not observed in the completed run."` — **except** when `trace.outcome === "mock-success"`, where the step's own narrative is kept. When `collapsed === true`, `revealed = []`.
- Steps are never mutated; always return new arrays/objects.

- [ ] **Step 1: Write the failing tests**

```js
// demo_api_ui/src/services/tokenChainTrace/__tests__/stepVisibility.test.js
import { applyStepVisibility, SKIP_REASONS } from "../stepVisibility";

const mk = (id, status, extra = {}) => ({ id, status, detail: {}, ...extra });
const activeTrace = { startedAt: Date.now(), tokenEvents: [{ id: "x" }] };
const doneTrace = { ...activeTrace, outcome: "ok" };

describe("applyStepVisibility", () => {
  test("no run activity: everything empty (session-only state shows nothing)", () => {
    const out = applyStepVisibility([mk("website", "done"), mk("signin", "done")], {});
    expect(out).toEqual({ visible: [], skipped: [], revealed: [] });
  });

  test("in-flight: fired + notRequired visible, no skipped, no chip", () => {
    const steps = [
      mk("website", "done"),
      mk("signin", "done"),
      mk("agent", "done"),
      mk("exchange", "pending"),
      mk("gateway", "notinpath"),
      mk("exchange-x", "notinpath", { detail: { notRequired: true } }),
    ];
    const out = applyStepVisibility(steps, activeTrace);
    expect(out.visible.map((s) => s.id)).toEqual(["website", "signin", "agent", "exchange-x"]);
    expect(out.skipped).toEqual([]);
  });

  test("complete + collapsed: fired visible, the rest counted in skipped", () => {
    const steps = [
      mk("website", "done"), mk("agent", "done"),
      mk("exchange", "notinpath"), mk("api", "pending"), mk("database", "notinpath"),
    ];
    const out = applyStepVisibility(steps, doneTrace, { collapsed: true });
    expect(out.visible.map((s) => s.id)).toEqual(["website", "agent"]);
    expect(out.skipped.map((s) => s.id)).toEqual(["exchange", "api", "database"]);
    expect(out.revealed).toEqual([]);
  });

  test("complete + expanded: skipped revealed with SKIP_REASONS narrative", () => {
    const steps = [mk("agent", "done"), mk("api", "notinpath")];
    const out = applyStepVisibility(steps, doneTrace, { collapsed: false });
    expect(out.revealed).toHaveLength(1);
    expect(out.revealed[0].detail.narrative).toBe(SKIP_REASONS.api);
    expect(out.visible.map((s) => s.id)).toEqual(["agent", "api"]);
  });

  test("mock-success: revealed steps keep their own narrative", () => {
    const steps = [mk("agent", "done"), mk("api", "notinpath", { detail: { narrative: "Teaching text." } })];
    const trace = { ...doneTrace, outcome: "mock-success" };
    const out = applyStepVisibility(steps, trace, { collapsed: false });
    expect(out.revealed[0].detail.narrative).toBe("Teaching text.");
  });

  test("challenge hop: probe ran (done) stays visible; probe skipped (notinpath) collapses", () => {
    const ran = mk("tools-call-challenge", "done");
    const skippedProbe = mk("tools-list-challenge", "notinpath");
    const out = applyStepVisibility([mk("agent", "done"), ran, skippedProbe], doneTrace, { collapsed: true });
    expect(out.visible.map((s) => s.id)).toEqual(["agent", "tools-call-challenge"]);
    expect(out.skipped.map((s) => s.id)).toEqual(["tools-list-challenge"]);
  });

  test("guest run (no bearer, no probe): challenge hops collapse, never error", () => {
    const steps = [mk("agent", "done"), mk("tools-list-challenge", "notinpath"), mk("tools-call-challenge", "notinpath")];
    const out = applyStepVisibility(steps, doneTrace, { collapsed: true });
    expect(out.visible.map((s) => s.id)).toEqual(["agent"]);
    expect(out.skipped).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_ui && npx jest src/services/tokenChainTrace/__tests__/stepVisibility.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```js
// demo_api_ui/src/services/tokenChainTrace/stepVisibility.js
//
// THE one step-visibility policy. Every step-box surface (token-chain rail,
// node rail, movie reel, filmstrip, topology canvas, MCP tab) asks this module
// which hops a run actually performed, instead of each keeping its own filter.
// Four ad-hoc filters had drifted (rail live projection, reel HAPPENED set,
// topology UNFIRED_STATUSES, filmstrip's import of the rail's projection);
// this module replaces all four.
//
// Policy (approved 2026-10-09): show what happened; on a COMPLETED run, the
// hops that never fired collapse behind a "+N hops not in this run" chip the
// consumer renders; expanding them reveals them greyed with a reason. In
// flight, unfired hops are simply hidden — mid-run there is nothing to teach
// about a hop the run may still reach.
//
// buildTraceSteps output is consumed as-is: statuses are never rewritten here
// (no new status strings — see buildTraceSteps.js's notRequired comment).

// A step only counts as "happened" in these statuses. "waiting" is included
// because the reel already treated it as happened (an exchange paused on a
// gate is very much part of the run).
export const HAPPENED_STATUSES = ["done", "active", "error", "waiting"];

// Moved verbatim from TokenChainTraceRail.jsx (SKIPPED_STEP_REASONS). Keyed by
// baseId — multi-decision authorize steps (authorize:2, authorize:3) collapse
// under the base id's reason.
export const SKIP_REASONS = {
  signin: "No sign-in token evidence was recorded for this run.",
  agent: "The Banking Agent did not participate in this run.",
  llm: "No LLM reasoning was used on this run.",
  "agent-token": "No separate agent identity token was acquired.",
  exchange: "Token exchange was skipped; no delegated token was issued.",
  authorize: "PingOne Authorize was skipped; no policy decision was recorded.",
  stepup: "No step-up or human approval challenge was required.",
  "intent-binding": "No RAR intent-binding check was required.",
  gateway: "The Agent Gateway was not in this run's path.",
  "api-key-swap": "The run did not use the API-key credential-swap path.",
  mcp: "No MCP tool call occurred.",
  api: "No downstream resource-server call occurred.",
  database: "No SQL database access was observed for this run.",
  reply: "No final reply evidence was recorded.",
  "tools-list-challenge": "No anonymous discovery challenge was issued on this run (guest path, or no gateway in route).",
  "tools-call-challenge": "No anonymous tools/call challenge was issued on this run (guest path, or no gateway in route).",
  "a2a-agent1-actor": "The Banking Agent identity token was not observed.",
  "a2a-exchange1": "The user-to-generalist exchange was not observed.",
  "a2a-agent2-actor": "The specialist agent identity token was not observed.",
  "a2a-exchange2": "The nested specialist delegation exchange was not observed.",
  "a2a-agent-card": "Specialist Agent Card discovery was not observed.",
  "a2a-protocol-message": "The A2A SendMessage handoff was not observed.",
};

// Rows that exist before any run: the browser step is unconditionally done and
// beginTrace carries sign-in across runs. Neither means a run has started.
const SESSION_STEP_IDS = new Set(["website", "signin"]);

function hasActivity(trace) {
  return Boolean(
    trace?.startedAt || trace?.prompt || trace?.tokenEvents?.length ||
    trace?.phases?.length || trace?.mcpResult || trace?.authorize ||
    trace?.llmDetail || trace?.llmReply || trace?.outcome || trace?.routingMode,
  );
}

function isComplete(trace) {
  return ["ok", "error", "mock-success"].includes(trace?.outcome);
}

function fired(step) {
  return HAPPENED_STATUSES.includes(step?.status) || step?.detail?.notRequired;
}

/**
 * @param {Array} steps  buildTraceSteps output (already spliced with A2A /
 *                       Privilege hops by the caller where that applies)
 * @param {object} trace the store trace
 * @param {{ collapsed?: boolean }} [opts] complete runs only: true hides the
 *                       non-fired hops (consumer renders the count chip);
 *                       false additionally returns them in `revealed`, each
 *                       annotated with its skip narrative.
 * @returns {{ visible: Array, skipped: Array, revealed: Array }}
 */
export function applyStepVisibility(steps, trace, { collapsed = true } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  if (!hasActivity(trace)) return { visible: [], skipped: [], revealed: [] };
  const visible = list.filter(fired);
  if (!isComplete(trace)) return { visible, skipped: [], revealed: [] };
  const skipped = list.filter((step) => !fired(step));
  const revealed = collapsed ? [] : skipped.map((step) => {
    if (trace.outcome === "mock-success") return step;
    const baseId = step.baseId || step.id;
    return {
      ...step,
      detail: {
        ...step.detail,
        narrative: SKIP_REASONS[baseId] || "This possible step was not observed in the completed run.",
      },
    };
  });
  return { visible, skipped, revealed };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx jest src/services/tokenChainTrace/__tests__/stepVisibility.test.js
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/tokenChainTrace/stepVisibility.js src/services/tokenChainTrace/__tests__/stepVisibility.test.js
git commit -m "feat(ui): shared step-visibility policy module

One policy for every step-box surface: show what happened, collapse the
rest behind a count chip on completed runs. Replaces the rail's live
projection, the reel's HAPPENED set and the topology's UNFIRED_STATUSES.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Convert the Token Chain rail (live + classic + chip)

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainTraceRail.jsx` (delete `buildLiveTokenChainSteps` :251-297 and `SKIPPED_STEP_REASONS` :64-85; rewire `steps` memo :483-485; add chip render in the detail view after :757 and below the map view's `TokenChainNodeRail`)
- Modify: `demo_api_ui/src/components/TokenChainFilmstrip.jsx:17,156-159` (switch import to `applyStepVisibility`; both view modes get the policy)
- Test: update `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx`, `demo_api_ui/src/utils/__tests__/privilegeA2aChainRun.test.js`, `demo_api_ui/src/components/__tests__/TokenChainFilmstrip.test.jsx`

**Interfaces:**
- Consumes: `applyStepVisibility(steps, trace, { collapsed })` from Task 1.
- Produces: rail state `showSkipped` (boolean, toggled by the chip). `buildLiveTokenChainSteps` is **deleted** — its other importer (filmstrip) converts in this task, and the two test files switch to `applyStepVisibility` + `buildPrivilegeA2aChainSteps` directly.

Rail rewiring (exact):

```jsx
import { applyStepVisibility } from "../services/tokenChainTrace/stepVisibility";

// inside the component:
const [showSkipped, setShowSkipped] = useState(false);

const baseSteps = useMemo(() => {
  // A Privilege chain run has no banking pipeline in it: show its hops alone.
  const chainSteps = buildPrivilegeA2aChainSteps(trace?.tokenEvents);
  if (chainSteps.length) return chainSteps.map((step, index) => ({ ...step, num: index + 1 }));
  const source = mcpRouteOnly ? snap.steps.filter((s) => MCP_STEP_IDS.includes(s.id)) : snap.steps;
  const a2aSteps = buildA2aTokenChainSteps(trace?.tokenEvents);
  if (!a2aSteps.length) return source;
  const insertAfter = source.findIndex((step) => step.id === "llm");
  const spliced = source.slice();
  spliced.splice(insertAfter + 1, 0, ...a2aSteps);
  return spliced;
}, [snap.steps, trace, mcpRouteOnly]);

const { visible: firedSteps, skipped, revealed } = useMemo(
  () => applyStepVisibility(baseSteps, trace, { collapsed: !showSkipped }),
  [baseSteps, trace, showSkipped],
);

const steps = useMemo(
  () => [...firedSteps, ...(showSkipped ? revealed : [])].map((step, index) => ({ ...step, num: index + 1 })),
  [firedSteps, revealed, showSkipped],
);
```

Note: `classicSteps` (the old variable) disappears — `mcpRouteOnly` filtering moves into `baseSteps`, and the classic/live split is now only `collapsed: !showSkipped` vs the same call with the chip. The one other `classicSteps` reader, `mcpDone` (:522), switches to the unfiltered store list — status counts must not depend on visibility:

```jsx
const mcpDone = snap.steps.filter((s) => MCP_STEP_IDS.includes(s.id) && s.status === "done").length;
```

The MCP tab (`TraceMcpPanel`) keeps receiving the fired-only list:

```jsx
const mcpSteps = useMemo(
  () => applyStepVisibility(
    snap.steps.filter((s) => MCP_STEP_IDS.includes(s.id)), trace, { collapsed: true },
  ).visible,
  [snap.steps, trace],
);
// ...
<TraceMcpPanel steps={mcpSteps} trace={trace} onInspect={onInspect} useCase={proofUseCase} />
```

Chip render — in the detail view, directly after the `steps.map(...)` block (:755-757), and in the map view directly under `<TokenChainNodeRail ... />`:

```jsx
{skipped.length > 0 && (
  <button
    type="button"
    className="tctr-skipped-chip"
    data-testid="tctr-skipped-chip"
    aria-expanded={showSkipped}
    onClick={() => setShowSkipped((v) => !v)}
  >
    {showSkipped ? `− ${skipped.length} hops not in this run` : `+ ${skipped.length} hops not in this run`}
  </button>
)}
```

CSS (append to the rail's stylesheet, or the rail's `<style>`-adjacent css file it already uses — `TokenChainTraceRail` imports its css; add):

```css
.tctr-skipped-chip {
  display: inline-block;
  margin: 0.5rem 0;
  padding: 0.2rem 0.7rem;
  font-size: 0.72rem;
  border: 1px dashed var(--tc-border, #94a3b8);
  border-radius: 999px;
  background: transparent;
  color: var(--tc-muted, #64748b);
  cursor: pointer;
}
.tctr-skipped-chip[aria-expanded="true"] { border-style: solid; }
```

Also: the `useEffect` at :488-492 that clears selection when `steps.length === 0` keeps working unchanged (steps is still the rendered list).

- [ ] **Step 1: Update the rail tests first (they encode the old policy)**

In `TokenChainTraceRail.test.jsx`, any assertion that a `notinpath`/`pending` step renders on a completed run becomes its inverse plus the chip:

```jsx
// old: expects the exchange card to render with its skip narrative
it('completed run: unfired hops collapse behind the chip', async () => {
  const user = userEvent.setup();
  render(<TokenChainTraceRail onInspect={jest.fn()} />);
  await expect(screen.getByTestId('tctr-skipped-chip')).toBeVisible();
  expect(screen.getByTestId('tctr-skipped-chip')).toHaveTextContent(/\+\s*\d+ hops not in this run/);
  expect(screen.queryByText(/Token exchange was skipped/)).not.toBeInTheDocument();
  await user.click(screen.getByTestId('tctr-skipped-chip'));
  expect(screen.getByText(/Token exchange was skipped/)).toBeVisible();
});
```

In `privilegeA2aChainRun.test.js`, replace each `buildLiveTokenChainSteps(...)` call with the pair it actually composed:

```js
import { applyStepVisibility } from "../../services/tokenChainTrace/stepVisibility";
// old: buildLiveTokenChainSteps(chainSteps, trace)
// new:
const { visible } = applyStepVisibility(chainSteps, trace);
const steps = visible.map((step, index) => ({ ...step, num: index + 1 }));
```

and add the passthrough assertion (Review Focus #5):

```js
test('privilege chain hops pass through the visibility policy unemptied', () => {
  const chainSteps = buildPrivilegeA2aChainSteps(events); // the suite's existing fixture
  const trace = { outcome: "ok", tokenEvents: events, startedAt: 1 };
  const { visible } = applyStepVisibility(chainSteps, trace);
  expect(visible.map((s) => s.id)).toEqual(chainSteps.map((s) => s.id)); // every hop fired
});
```

Run → FAIL (old component still exports `buildLiveTokenChainSteps`; chip testid absent).

- [ ] **Step 2: Run the rail tests — expect FAIL (old component still exported)**

```bash
npx jest src/components/__tests__/TokenChainTraceRail.test.jsx src/utils/__tests__/privilegeA2aChainRun.test.js
```

- [ ] **Step 3: Rewire the rail + filmstrip as above**

- [ ] **Step 4: Run to verify pass**

```bash
npx jest src/components/__tests__/TokenChainTraceRail.test.jsx src/utils/__tests__/privilegeA2aChainRun.test.js src/components/__tests__/TokenChainFilmstrip.test.jsx src/components/__tests__/TokenChainNodeRail.test.jsx src/components/__tests__/TokenChainPresenter.test.jsx src/components/__tests__/FloatingTokenChainPanel.raildetail.test.jsx
```
Expected: PASS. (Presenter/node-rail suites run here because they consume the same steps list.)

- [ ] **Step 5: Commit**

```bash
git add src/components/TokenChainTraceRail.jsx src/components/TokenChainFilmstrip.jsx src/components/__tests__/ src/utils/__tests__/privilegeA2aChainRun.test.js
git commit -m "feat(ui): token-chain rail + filmstrip use the shared visibility policy

Live and classic views now show only what happened; completed runs get the
'+N hops not in this run' chip. buildLiveTokenChainSteps deleted — its
policy lives in stepVisibility.applyStepVisibility.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Convert the movie reel

**Files:**
- Modify: `demo_api_ui/src/components/SequenceReelDiagram.jsx` (delete `HAPPENED` :140 and the manual filter in the `allLifelineSteps` memo :206-211)
- Test: existing `src/components/__tests__/SequenceReelDiagram.*.test.js(x)` suites must stay green; add one assertion to `SequenceReelDiagramLanes.test.js` that a completed trace's notinpath hops produce no lifeline row.

**Interfaces:**
- Consumes: `applyStepVisibility`.

The memo becomes:

```jsx
import { applyStepVisibility } from "../services/tokenChainTrace/stepVisibility";
// ...
const allLifelineSteps = useMemo(() => {
  const { visible } = applyStepVisibility(steps, snap.trace);
  const failureIndex = visible.findIndex((step) => step.status === "error");
  const visibleSteps = failureIndex === -1 ? visible : visible.slice(0, failureIndex + 1);
  if (!visibleSteps.some((step) => !SESSION_STEP_IDS.has(step.id))) return [];
  return deriveLifelineSteps(visibleSteps);
}, [steps, snap.trace]);
```

(`SESSION_STEP_IDS` stays local — the reel's guard remains as defense-in-depth; the module already returns empty for session-only state.) The reel renders no chip — it is a playback surface; fired hops only, in both in-flight and completed runs. The dance hops appear as real arrows as soon as their probe events land (Task 5 makes the tools/list probe real).

- [ ] **Step 1: Add the failing lane test** — a completed trace with a notinpath hop must produce no lifeline row for it. Appended to `src/components/__tests__/SequenceReelDiagramLanes.test.js`:

```js
// appended to SequenceReelDiagramLanes.test.js
import { applyStepVisibility } from "../services/tokenChainTrace/stepVisibility";
import { deriveLifelineSteps } from "../../services/tokenChainTrace/deriveLifelineSteps";

test("completed run: notinpath hops draw no lifeline rows", () => {
  const steps = [
    { id: "website", status: "done", lane: "BROWSER", title: "Browser" },
    { id: "gateway", status: "done", lane: "MCP", title: "Gateway" },
    { id: "database", status: "notinpath", lane: "API", title: "Database" },
  ];
  const { visible } = applyStepVisibility(steps, { outcome: "ok", tokenEvents: [{ id: "e" }] });
  const rows = deriveLifelineSteps(visible);
  expect(rows.map((r) => r.id)).not.toContain("database");
});
```

- [ ] **Step 2: Run it — FAIL (module not wired)**

```bash
npx jest src/components/__tests__/SequenceReelDiagramLanes.test.js
```

- [ ] **Step 3: Rewire the reel memo; delete `HAPPENED`.**

- [ ] **Step 4: Run the full reel suite**

```bash
npx jest src/components/__tests__/SequenceReelDiagram
```
Expected: PASS (the slowReveal suite is 28K — fix any assertion that depended on the old filter, same policy-shift pattern as Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/components/SequenceReelDiagram.jsx src/components/__tests__/SequenceReelDiagramLanes.test.js
git commit -m "feat(ui): movie reel draws fired hops via the shared visibility policy

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Topology — ghosts collapse behind the chip

**Files:**
- Modify: `demo_api_ui/src/components/TokenTopologyPanel.jsx` (:154-169 `UNFIRED_STATUSES`/`isUnfired`/`buildObservedTopology` stay; the consumer at :697 and the node/edge builders at :773-797 change)
- Test: `src/components/__tests__/TokenTopologyPanel.enforcement.test.jsx`

**Interfaces:**
- Consumes: `applyStepVisibility`.
- Produces: `buildObservedTopology(steps)` unchanged in signature — callers now hand it fired-only or revealed lists.

Change (component body):

```jsx
const [showSkippedNodes, setShowSkippedNodes] = useState(false);
// hasActivity stays as-is (it also covers a2aTopology). Visibility only
// re-buckets the store's steps; the guard above still gates the empty state.
const { visible: firedSteps, skipped: skippedSteps, revealed } = applyStepVisibility(steps, trace, { collapsed: !showSkippedNodes });
const topologyNodes = hasActivity ? buildObservedTopology(firedSteps) : [];
const ghostNodes = hasActivity && showSkippedNodes ? buildObservedTopology(revealed) : [];
// pass [...topologyNodes, ...ghostNodes] into the existing node/edge builders
// (the :697 topologyNodes consumer, and the :773-797 node/edge builders which
// already ghost-key off isUnfired(step) — skipped steps are pending/notinpath,
// so they render ghosted exactly as before).
```

Chip (rendered just above the canvas, same classes as the rail's chip but `ttp-` prefixed to keep styles panel-local):

```jsx
{skippedSteps.length > 0 && (
  <button type="button" className="ttp-skipped-chip" data-testid="ttp-skipped-chip"
    aria-expanded={showSkippedNodes} onClick={() => setShowSkippedNodes((v) => !v)}>
    {showSkippedNodes ? `− ${skippedSteps.length} hops not in this run` : `+ ${skippedSteps.length} hops not in this run`}
  </button>
)}
```

CSS: reuse the `.tctr-skipped-chip` rule shape under a `.ttp-skipped-chip` selector in `TokenTopologyPanel.css`.

The teaching value is preserved: the control points that exist but went unused are one click away, greyed, instead of always-on ghosts.

- [ ] **Step 1: Update the topology tests first (they encode the old policy)**

In `TokenTopologyPanel.enforcement.test.jsx`, the existing steps fixture (steps at :126-127 carry `notinpath`/`pending` statuses that the old code always rendered as ghosts) drives assertions like "keeps pending and notinpath hops instead of dropping them". In the component those hops now collapse by default. Rewrite the component-level test as:

```jsx
it('collapses unfired hops behind the chip; expanding reveals them ghosted', async () => {
  const user = userEvent.setup();
  render(<TokenTopologyPanel isOpen onClose />);
  // completed run with both fired and unfired hops in the store
  // (seed via tokenChainTraceStore the way the suite's existing helpers do)
  await expect(screen.queryByTestId('ttp-skipped-chip')).toBeVisible();
  // a notinpath hop is NOT drawn while collapsed
  expect(screen.queryByText(/Step-up required/)).not.toBeInTheDocument();
  await user.click(screen.getByTestId('ttp-skipped-chip'));
  // expanded: the same hop is drawn, ghosted
  expect(screen.getByText(/Step-up required/)).toBeVisible();
});
```

(Match the suite's existing store-seeding helper and query style — the fixture steps' titles are the query targets, `data-testid="ttp-skipped-chip"` is the chip. Keep any `buildObservedTopology` unit tests untouched: that function's contract is unchanged.) Run → FAIL.

- [ ] **Step 2: Implement; run `npx jest src/components/__tests__/TokenTopologyPanel` — PASS** (the a2a suite runs too: privilege/a2a steps have fired statuses and pass through).

- [ ] **Step 3: Commit**

```bash
git add src/components/TokenTopologyPanel.jsx src/components/TokenTopologyPanel.css src/components/__tests__/TokenTopologyPanel.enforcement.test.jsx
git commit -m "feat(ui): topology canvas hides unfired hops behind the count chip

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Backend — the real tools/list challenge + true wire order

**Files:**
- Modify: `demo_api_server/services/mcpToolPipeline.js`
  - ADD the `tools/list`-phase probe at the top of the discovery block (after `if (discoveryOn) { try {`, before the credentialed `callToolViaGateway` discovery call at :1059).
  - MOVE the existing `tools/call` probe block (:1028-1039) from its current position (before discovery) to immediately before the credentialed tools/call dispatch — after the discovery block ends. Wire truth: a real client walks the discovery dance first, then the call dance. Today the call probe fires before discovery, which puts the wire calls in an order no real client would produce.
- Test: extend `demo_api_server/src/__tests__/mcpToolPipeline.discovery.test.js`

**Interfaces:**
- Consumes: `probeMcpChallenge(req, { method, phase, gatewayUrl, params })` — exists, never throws, returns `{ events }`.
- Produces: token events `mcp_challenge` / `mcp_resource_metadata` with `phase: 'tools/list'` — exactly what `buildChallengeStep("tools-list-challenge", "tools/list", ...)` already matches.

New probe code (mirrors the existing tools/call probe at :1028-1039 verbatim, phase swapped):

```js
// Discovery is itself a protected request: walk its half of the dance first —
// the anonymous tools/list the gateway refuses with 401 + WWW-Authenticate —
// then the credentialed one below. Evidence only: never throws, result unused.
const listProbe = await require('./mcpChallengeProbe').probeMcpChallenge(req, {
    method: 'tools/list',
    phase: 'tools/list',
    gatewayUrl: gatewayHttpUrl,
    params: {},
});
if (listProbe.events.length) {
    tokenEvents.push(...listProbe.events);
    deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
}
```

The moved tools/call probe block keeps its exact code; only its position changes (comment updated to note it now runs after discovery, matching the real client order).

- [ ] **Step 1: Write the failing tests** (append to the describe block; mock the probe module):

```js
// at top of file, after other requires:
jest.mock('../../services/mcpChallengeProbe', () => ({
  probeMcpChallenge: jest.fn(async () => ({ status: 401, challenge: {}, metadata: null, events: [] })),
}));
const { probeMcpChallenge } = require('../../services/mcpChallengeProbe');

// in the describe (beforeEach resets it):
beforeEach(() => { probeMcpChallenge.mockClear(); });

test('discovery walks the tools/list dance: anonymous probe before the credentialed list', async () => {
  const { ctx, deps } = baseCtx();
  await runMcpToolPipeline(ctx);
  expect(probeMcpChallenge).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-1' }), expect.objectContaining({
    method: 'tools/list', phase: 'tools/list', gatewayUrl: expect.any(String),
  }));
  // probe for tools/list fired before the credentialed discovery call
  const probeIdx = probeMcpChallenge.mock.calls.findIndex(([, o]) => o.phase === 'tools/list');
  const discoveryIdx = deps.callToolViaGateway.mock.calls.findIndex(([, , , , o]) => o.rpcMethod === 'tools/list');
  expect(probeIdx).toBeGreaterThanOrEqual(0);
  expect(discoveryIdx).toBeGreaterThanOrEqual(0);
});

test('wire order: discovery dance, then tools/call dance, then the call', async () => {
  const { ctx } = baseCtx();
  await runMcpToolPipeline(ctx);
  const seq = [];
  // interleave the two spies by push order is not directly observable across
  // mocks; instead assert: the tools/call probe happened, and it happened
  // AFTER the credentialed discovery call completed.
  const callProbe = probeMcpChallenge.mock.calls.find(([, o]) => o.phase === 'tools/call');
  expect(callProbe).toBeTruthy();
  const discoveryIdx = deps.callToolViaGateway.mock.calls.findIndex(([, , , , o]) => o.rpcMethod === 'tools/list');
  expect(discoveryIdx).toBeGreaterThanOrEqual(0);
  // discovery ran before the tool call
  const callIdx = deps.callToolViaGateway.mock.calls.findIndex(([, , , , o]) => !o.rpcMethod);
  expect(discoveryIdx).toBeLessThan(callIdx);
});

test('probe events reach the token chain and SSE', async () => {
  probeMcpChallenge.mockResolvedValueOnce({
    status: 401, challenge: { challenged: true }, metadata: null,
    events: [{ type: 'mcp_challenge', phase: 'tools/list', challenged: true, status: 401 }],
  });
  const { ctx, deps } = baseCtx();
  await runMcpToolPipeline(ctx);
  expect(deps.publishTokenEventsToSse).toHaveBeenCalledWith('flow-1',
    expect.arrayContaining([expect.objectContaining({ type: 'mcp_challenge', phase: 'tools/list' })]));
});

test('probe failure never blocks discovery or the call', async () => {
  probeMcpChallenge.mockRejectedValueOnce(new Error('probe socket hangup'));
  const { ctx, deps } = baseCtx();
  const outcome = await runMcpToolPipeline(ctx);
  expect(outcome.kind).toBe('result');
  expect(deps.callToolViaGateway).toHaveBeenCalledTimes(2);
});
```

(Adjust the first `expect(probeMcpChallenge).toHaveBeenCalledWith(...)` to the probe's real call shape — the pipeline invokes it as `probeMcpChallenge(req, opts)`, and `req` is `ctx.req`. The jest mock records calls as `[(req, opts)]`, so assert `probeMcpChallenge.mock.calls[0][1]` matches `{ method: 'tools/list', phase: 'tools/list', gatewayUrl: expect.any(String) }`.)

- [ ] **Step 2: Run — expect the new tests FAIL** (no tools/list probe yet; tools/call probe ordering wrong).

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_server && npx jest src/__tests__/mcpToolPipeline.discovery.test.js
```

- [ ] **Step 3: Implement** (add probe + move block, per above).

- [ ] **Step 4: Run — PASS, plus the neighboring suites stay green:**

```bash
npx jest src/__tests__/mcpToolPipeline.discovery.test.js src/__tests__/mcpGatewayClient.discovery.test.js src/__tests__/callMcpTool.stepUpAuthorizeIngest.test.js 2>/dev/null || npx jest src/__tests__/mcpToolPipeline.discovery.test.js src/__tests__/mcpGatewayClient.discovery.test.js
```

- [ ] **Step 5: Commit**

```bash
git add services/mcpToolPipeline.js src/__tests__/mcpToolPipeline.discovery.test.js
git commit -m "feat(mcp): real tools/list 401 probe; tools/call probe moved to true wire order

A real client walks the discovery dance before the call dance. The BFF now
probes both: anonymous tools/list -> 401 before the credentialed discovery,
anonymous tools/call -> 401 after discovery, immediately before the
authorized call. Evidence-only; probe failures never block the run.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Static sequence page — the dance as real steps + `discovery-dance` scenario

**Files:**
- Modify: `demo_api_ui/src/components/SequenceDiagramPage.js`
  - Export the step data for tests: change `const ALL_STEPS = [` (:733) to `export const ALL_STEPS = [` and `const SCENARIOS = {` (:2718) to `export const SCENARIOS = {` (the component's default export is untouched; no other file imports this module today).
  - Insert steps `"5a"`, `"5b"` immediately before the existing step 5 (`tools/list (JSON-RPC)` at :910) — i.e., after the "Request tool list" note (:898-908).
  - Insert steps `"25a"`, `"25b"` immediately before step 26 (`tools/call check_balance … with TX token` at :1985).
  - Add the `discovery-dance` scenario to `SCENARIOS` (:2718) and its `<option>` (:3397 block).
- Modify: `demo_api_ui/public/architecture/i4ai-ref-arch.mmd` (canonical source the page mirrors 1:1 — add both dance legs).
- Test: create `demo_api_ui/src/components/__tests__/sequenceDiagramDance.test.js` (jest, like the rail tests — the existing `sequenceDiagramLabels.test.js` is a vitest file and a different subject).

**Interfaces:** pure data additions — the page's renderer, mermaid export, and 18a–18d auth filter all work off the step array. The new steps are NOT in the `["18a","18b","18c","18d"]` filter list (:3194), so they render in both auth scenarios — correct: the dance happens regardless of the user's session state.

New steps (insert verbatim; note the letter-suffix `step` values — no renumbering):

```js
  // A->>AG: tools/list with NO Authorization header (the 401 dance, leg 1)
  {
    step: "5a",
    from: "A",
    to: "AG",
    label: "tools/list (no Authorization header)",
    type: "request",
    description: "Anonymous discovery attempt",
    why: "A real MCP client that arrives holding nothing still tries discovery first. The gateway is an OAuth 2.1 protected resource: it refuses the credential-less call with 401 and a WWW-Authenticate challenge instead of answering it. The challenge is how the client learns which authorization server to go to.",
    request: {
      method: "POST",
      url: "http://localhost:3036/jsonrpc",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    },
    response: {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="mcp", resource_metadata="https://api.ping.demo:3036/.well-known/oauth-protected-resource"',
      },
      body: { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Unauthorized: missing bearer token" } },
    },
    onError: [
      "Gateway answers 200 to an anonymous call — the protected-resource gate is off; fix before demoing enforcement",
      "No WWW-Authenticate header on the 401 — the client cannot discover the authorization server (RFC 9728 pointer missing)",
      "Probe timeout — the dance legs run live against the gateway; check it is up on 3036",
    ],
  },
  // A->>AG: GET .well-known/oauth-protected-resource (the 401 dance, leg 2)
  {
    step: "5b",
    from: "A",
    to: "AG",
    label: "GET .well-known/oauth-protected-resource",
    type: "request",
    description: "RFC 9728 metadata fetch",
    why: "The 401 challenge pointed at the gateway's protected-resource metadata. Fetching it tells the client which authorization servers can issue tokens for this resource and which scopes exist — no hardcoding.",
    request: {
      method: "GET",
      url: "https://api.ping.demo:3036/.well-known/oauth-protected-resource",
      headers: { Accept: "application/json" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        resource: "https://api.ping.demo:3036/mcp",
        authorization_servers: ["https://auth.ping.one/{ENV_ID}/as"],
        scopes_supported: ["tools.list", "balance:read", "transfer:write"],
        bearer_methods_supported: ["header"],
      },
    },
    onError: [
      "metadata URL unreachable — the challenge's resource_metadata pointer must match a live route",
      "authorization_servers empty — the client has nowhere to send the user; check PingOne AS config",
    ],
  },
```

For the tools/call dance, the same shape with `step: "25a"` / `"25b"`, method `tools/call`, `params: { name: "check_balance", arguments: {} }` in 25a's body, and labels "tools/call check_balance (no Authorization header)" / "GET .well-known/oauth-protected-resource (before the call)". Adjust the 25a `why` to: "The same handshake on invocation: before presenting the delegated token, the first tools/call goes out bare. The gateway refuses it at its own edge — nothing reaches the MCP server on this leg."

Scenario + dropdown:

```js
  // The MCP authorization dance in isolation: both 401 challenges, both
  // metadata fetches, and the credentialed calls that follow them.
  "discovery-dance": ALL_STEPS.filter((s) =>
    [4, 5, 6, 7, 8, 26].includes(s.step) || ["5a", "5b", "25a", "25b"].includes(String(s.step))),
```

```jsx
<option value="discovery-dance">401 Discovery Dance (both legs)</option>
```

Canonical `.mmd` — after line 44 (`A->>AG: tools/list (JSON-RPC)`) insert:

```
    A->>AG: tools/list (no Authorization header)
    AG-->>A: 401 + WWW-Authenticate (resource_metadata)
    A->>AG: GET .well-known/oauth-protected-resource
    AG-->>A: RFC 9728 metadata (authorization_servers, scopes)
```

and before the step-28 line at :79 insert:

```
    A->>AG: tools/call check_balance (no Authorization header)
    AG-->>A: 401 + WWW-Authenticate (resource_metadata)
    A->>AG: GET .well-known/oauth-protected-resource
    AG-->>A: RFC 9728 metadata
```

- [ ] **Step 1: Write the failing test** (new file `src/components/__tests__/sequenceDiagramDance.test.js`):

```js
// demo_api_ui/src/components/__tests__/sequenceDiagramDance.test.js
import { SCENARIOS } from "../SequenceDiagramPage";

describe("401 discovery dance steps", () => {
  const ALL = SCENARIOS["full-flow"];
  test("both dance legs exist exactly once, with lettered ids", () => {
    for (const id of ["5a", "5b", "25a", "25b"]) {
      expect(ALL.filter((s) => String(s.step) === id)).toHaveLength(1);
    }
  });
  test("5a/5b sit between the tool-list note and the credentialed tools/list", () => {
    const idx = (id) => ALL.findIndex((s) => String(s.step) === id);
    expect(idx("5a")).toBeGreaterThan(0);
    expect(idx("5b")).toBe(idx("5a") + 1);
    expect(idx(5)).toBe(idx("5b") + 1);
  });
  test("25a/25b sit immediately before the credentialed tools/call (step 26)", () => {
    const idx = (id) => ALL.findIndex((s) => String(s.step) === id);
    expect(idx("25b")).toBe(idx("25a") + 1);
    expect(idx(26)).toBe(idx("25b") + 1);
  });
  test("discovery-dance scenario contains both dances and the credentialed calls", () => {
    const steps = SCENARIOS["discovery-dance"];
    expect(steps.map((s) => String(s.step))).toEqual(expect.arrayContaining(["5a", "5b", "25a", "25b", "5", "26"]));
  });
  test("dance steps are not stripped by the authenticated filter (not in 18a-18d)", () => {
    const filtered = SCENARIOS["full-flow"].filter((s) => !["18a", "18b", "18c", "18d"].includes(String(s.step)));
    expect(filtered.map((s) => String(s.step))).toEqual(expect.arrayContaining(["5a", "25a"]));
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: implement. Step 4: run — PASS:**

```bash
npx jest src/components/__tests__/sequenceDiagramLabels.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/components/SequenceDiagramPage.js src/components/__tests__/sequenceDiagramDance.test.js public/architecture/i4ai-ref-arch.mmd
git commit -m "feat(seq): static sequence page shows the real MCP 401 dance on both legs

5a/5b (discovery) and 25a/25b (invocation) render the anonymous call, the
401 + WWW-Authenticate challenge and the RFC 9728 metadata fetch as real
steps, plus a discovery-dance scenario. Canonical .mmd updated 1:1.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6b: Lifeline audit page — reflect the new path (static)

**Files:**
- Modify: `demo_api_ui/src/components/DemoStepsLifelineAuditPage.jsx` (data arrays + header meta only; the page stays a static report — no store reads, no runtime state)

The audit predates this work; three of its claims are now stale. Update them in place, reusing the page's existing "fixed in place" patterns (GAPS[0]'s inline "Fixed in PR #3233.", FIXES' `ready` flag):

1. **`GAPS[3]` "The credential-less `tools/call` challenge is out of order"** — body becomes:
   `"Fixed 9 Oct 2026: the \`tools/call\` probe now fires after discovery and immediately before the authorized call, and the discovery leg probes its own anonymous \`tools/list\` first — both dances draw in wire order. The static sequence page carries them as steps 5a/5b and 25a/25b."`
2. **`GAPS[0]` "The diagram drew steps that hadn't happened"** — body's final sentence extends to:
   `"Fixed in PR #3233, and reworked 9 Oct 2026: one shared visibility policy drives every step-box surface — a completed run shows only what happened, and the rest collapse behind a 'hops not in this run' chip."`
3. **`STEPS` UC1 row** — gap becomes:
   `"Discovery now runs before the call and both 401 challenges draw in wire order (re-checked 9 Oct 2026). API and database steps can't finish without the MCP result; BFF introspection not drawn."` (`shown` stays `true`.)
4. **`FIXES`** — the "Put gateway decisions on the gateway" row loses its now-done challenge clause and gains the landed status:
   `"Check a gateway denial before an authorize failure and count \`gw-filter-chain\` as gateway evidence (landed on main since the audit); the credential-less \`tools/call\` challenge now draws in wire order (fixed 9 Oct 2026 with the discovery rework)."`
   And one new ready row inserted at the top of `FIXES`:
   `["Walk the MCP 401 dance on both legs", ["Ready · this work", "UI + BFF"], "Discovery runs for real before every gateway tool call, both anonymous probes (tools/list and tools/call) capture the live 401 + WWW-Authenticate and the RFC 9728 metadata, and every step-box surface shows only the hops the run performed — the rest collapse behind a count chip.", true]`
5. **Header meta** — add one span next to the audited date: `<span>Re-checked 9 Oct 2026 — discovery + 401 dance rework</span>`.

No other rows change: the remaining gaps (step-up phases, CIBA, sims without flow ids, page-type steps, chat-path MCP results) are untouched by this work and stay as reported.

- [ ] **Step 1: Apply the five edits above.**
- [ ] **Step 2: Verify the page still renders** — `npx jest src/components/__tests__/UseCaseDiagramPage.test.jsx` is unrelated; there is no test on this page (static content). Instead run the app-level smoke: `npx jest src/components/__tests__/` and confirm nothing imports broke.
- [ ] **Step 3: Commit**

```bash
git add src/components/DemoStepsLifelineAuditPage.jsx
git commit -m "docs(audit): lifeline audit reflects the discovery + 401 dance rework

Static page: the out-of-order challenge gap is marked fixed, the
steps-that-hadn't-happened gap notes the shared visibility policy, UC1's
row is re-checked, and the fix list gains the dance rework as ready.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: UC diagram pages — live overlay on curated fallback (UC1 + UC8)

**Files:**
- Modify: `demo_api_ui/src/config/useCaseDiagrams/UC1.js` (add `slug` + `hopHints` exports on the default object)
- Modify: `demo_api_ui/src/config/useCaseDiagrams/UC8.js` (same)
- Create: `demo_api_ui/src/services/tokenChainTrace/ucLiveOverlay.js`
- Modify: `demo_api_ui/src/context/ProofOfEnforcementContext.js:45` — add `export` to `firstUseCaseId` (single source for the slug lookup)
- Modify: `demo_api_ui/src/components/UseCaseDiagramPage.jsx` (store subscription, overlay wiring, mode badge)
- Test: create `demo_api_ui/src/services/tokenChainTrace/__tests__/ucLiveOverlay.test.js`; extend `src/components/__tests__/UseCaseDiagramPage.test.jsx`

**Interfaces:**
- Consumes: `applyStepVisibility` (Task 1), `firstUseCaseId(trace)` (existing, now exported), `tokenChainTraceStore`.
- Produces: `buildLiveUcWalk(cfg, trace, steps) -> walk[] | null`. A walk step matches the curated shape (`{ title, label, nodes, edges, lines, tech }`) so `StaticFlowDiagram` and the panel render it unchanged.

Config additions (UC1):

```js
export default {
  id: "UC1",
  slug: "delegated-access-with-proof", // backend catalog useCaseId (config/useCases.js:361)
  // buildTraceSteps baseId -> this diagram's node ids. A live hop renders on
  // the nodes it actually touched; hops without a hint stay off the overlay.
  hopHints: {
    signin: ["user"], prompt: ["user"], agent: ["agent"], llm: ["agent"],
    "agent-token": ["agent"], exchange: ["gw", "p1"], "exchange-1": ["gw", "p1"],
    authorize: ["gw", "p1"], gateway: ["gw"], "tools-list": ["agent", "gw"],
    "tools-list-challenge": ["agent", "gw"], "tools-call-challenge": ["agent", "gw"],
    mcp: ["gw", "acct"], api: ["acct"], reply: ["agent", "user"],
  },
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G, NODES, EDGES, walk,
};
```

UC8 (`hitl-consent`, nodes user/agent/gw/p1):

```js
  slug: "hitl-consent",
  hopHints: {
    signin: ["user"], prompt: ["user"], agent: ["agent"], llm: ["agent"],
    "agent-token": ["agent"], exchange: ["gw", "p1"], authorize: ["gw", "p1"],
    stepup: ["gw", "user"], gateway: ["gw"], "tools-list": ["agent", "gw"],
    "tools-list-challenge": ["agent", "gw"], "tools-call-challenge": ["agent", "gw"],
    mcp: ["gw"], api: ["gw"], reply: ["agent", "user"],
  },
```

The overlay module:

```js
// demo_api_ui/src/services/tokenChainTrace/ucLiveOverlay.js
//
// Live overlay for the curated UC diagram pages: when the trace store holds a
// run whose use-case slug matches the page's config, the walk is rebuilt from
// the hops that run actually performed (fired hops only — the shared
// visibility policy). No matching run -> null, and the page renders its
// curated fallback untouched. Slug matching is config-side: useCaseId slugs
// are shared across verticals by design (ProofOfEnforcementContext comment),
// so one `slug` line per config replaces a catalog fetch.
import { applyStepVisibility } from "./stepVisibility";
import { firstUseCaseId } from "../../context/ProofOfEnforcementContext";

const LANE_TAG = { API: "API", MCP: "API", BROWSER: "API", PINGONE: "POLICY", PINGFEDERATE: "POLICY", HEURISTICS: "POLICY" };

export function buildLiveUcWalk(cfg, trace, steps) {
  if (!cfg?.hopHints || !trace) return null;
  const slug = firstUseCaseId(trace);
  if (!slug || cfg.slug !== slug) return null;
  const { visible } = applyStepVisibility(steps, trace);
  const walk = [];
  for (const step of visible) {
    const baseId = step.baseId || step.id;
    const nodes = cfg.hopHints[baseId];
    if (!nodes?.length) continue;
    const edges = cfg.EDGES
      .map(([src, tgt], i) => (nodes.includes(src) && nodes.includes(tgt) ? i : -1))
      .filter((i) => i >= 0);
    const text = step.detail?.why || step.detail?.narrative || step.title;
    walk.push({
      title: step.title.length > 44 ? `${step.title.slice(0, 41)}…` : step.title,
      label: step.status === "error" ? "denied / failed in this run" : "observed in this run",
      nodes,
      edges,
      lines: [{ who: step.lane || "RUN", text }],
      tech: (step.detail?.kv || []).slice(0, 3)
        .map(([k, v]) => ({ t: LANE_TAG[step.lane] || "TOKEN", c: `${k}: ${v}` })),
    });
  }
  return walk.length ? walk : null;
}
```

Page wiring (`UseCaseDiagramPage.jsx`):

```jsx
import React, { useEffect, useMemo, useState } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { buildLiveUcWalk } from "../services/tokenChainTrace/ucLiveOverlay";

export default function UseCaseDiagramPage() {
  const { ucId } = useParams();
  const cfg = getConfig(ucId);
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);

  const liveWalk = useMemo(
    () => (cfg ? buildLiveUcWalk(cfg, snap.trace, snap.steps) : null),
    [cfg, snap.trace, snap.steps],
  );
  const activeWalk = liveWalk || cfg?.walk || [];
  const stepper = useDiagramStepper(cfg ? activeWalk.length : 0);

  // A run landing on (or leaving) this page is a new story: restart the walk
  // so the stepper never points past the end of a switched walk.
  useEffect(() => {
    if (cfg) stepper.goTo(0);
    setPickedNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.id, activeWalk.length]);
```

(The file's existing `useEffect` for `cfg?.id` is replaced by the one above; `useMemo` must be added to the React import on line 13.)

Render changes:
- `const hop = stepper.step >= 0 ? activeWalk[stepper.step] : null;`
- panel `tech` fallback: `activeWalk[0]?.tech || []`; the picked-node tech query: `activeWalk.filter(...)`.
- hop counter: `activeWalk.length` in both `chip` and the `<span data-testid="ucd-hop-label">`.
- `<StaticFlowDiagram ... walk={activeWalk} ... />`
- header badge, next to the result pill:

```jsx
<span className="ucd-pill ucd-pill--info" data-testid="ucd-mode">
  {liveWalk ? "Live run overlay" : "Curated walkthrough"}
</span>
```

CSS: none needed (reuses `.ucd-pill--info`).

- [ ] **Step 1: Write the failing module tests**

```js
// demo_api_ui/src/services/tokenChainTrace/__tests__/ucLiveOverlay.test.js
import UC1 from "../../../config/useCaseDiagrams/UC1";
import UC8 from "../../../config/useCaseDiagrams/UC8";
import { buildTraceSteps } from "../buildTraceSteps";
import { buildLiveUcWalk } from "../ucLiveOverlay";

const eventsFor = (slug, extra = []) => [
  { id: "user-token", claims: { sub: "alice" }, useCaseId: undefined },
  { id: "request_accepted", status: "done", useCaseId: slug, vertical: "banking" },
  ...extra,
];

test("UC1 run renders a live walk from fired hops", () => {
  const trace = {
    prompt: { message: "balance" }, outcome: "ok", startedAt: Date.now(),
    tokenEvents: eventsFor("delegated-access-with-proof", [
      { id: "gw-authorize", status: "done", decision: "PERMIT", useCaseId: "delegated-access-with-proof" },
      { id: "exchanged-token", status: "done", claims: { scope: "accounts:read", act: { sub: "agent" } }, useCaseId: "delegated-access-with-proof" },
    ]),
    authorize: { decision: "PERMIT", useCaseId: "delegated-access-with-proof" },
  };
  const walk = buildLiveUcWalk(UC1, trace, buildTraceSteps(trace));
  expect(walk).not.toBeNull();
  const ids = walk.map((w) => w.nodes.join(">"));
  expect(ids).toContain("gw>p1");           // exchange hop
  expect(walk.every((w) => w.lines.length && Array.isArray(w.tech))).toBe(true);
});

test("free-typed prompt (no slug): curated fallback (Review Focus #1)", () => {
  const trace = { prompt: { message: "hi" }, outcome: "ok", startedAt: 1, tokenEvents: [{ id: "x" }] };
  expect(buildLiveUcWalk(UC1, trace, buildTraceSteps(trace))).toBeNull();
});

test("slug mismatch (UC1 page, UC8 run): curated fallback", () => {
  const trace = { outcome: "ok", startedAt: 1, tokenEvents: [{ id: "e", useCaseId: "hitl-consent" }] };
  expect(buildLiveUcWalk(UC1, trace, [])).toBeNull();
});

test("UC8 run overlays its consent walk", () => {
  const trace = {
    outcome: "ok", startedAt: 1,
    tokenEvents: [{ id: "authorize-decision", decision: "HITL_REQUIRED", useCaseId: "hitl-consent" }],
    authorize: { decision: "HITL_REQUIRED", useCaseId: "hitl-consent" },
    phases: [{ phase: "gateway_hitl_required", label: "consent" }],
  };
  const walk = buildLiveUcWalk(UC8, trace, buildTraceSteps(trace));
  expect(walk).not.toBeNull();
});

test("config without hopHints never overlays (all other UCs unchanged)", () => {
  const cfg = { ...UC1, hopHints: undefined };
  expect(buildLiveUcWalk(cfg, { outcome: "ok", startedAt: 1, tokenEvents: [{ id: "e", useCaseId: "delegated-access-with-proof" }] }, [])).toBeNull();
});
```

- [ ] **Step 2: Run — FAIL. Step 3: implement config + module + context export. Run module tests — PASS.**

- [ ] **Step 4: Page test** (new cases in `src/components/__tests__/UseCaseDiagramPage.test.jsx`):

```jsx
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

afterEach(() => tokenChainTraceStore.reset());

it('overlays the live walk when the store holds a matching UC1 run', () => {
  tokenChainTraceStore.beginTrace({ flowTraceId: 'f1' });
  tokenChainTraceStore.ingestTokenEvent({ id: 'request_accepted', status: 'done', useCaseId: 'delegated-access-with-proof' });
  tokenChainTraceStore.ingestTokenEvent({ id: 'gw-authorize', status: 'done', decision: 'PERMIT', useCaseId: 'delegated-access-with-proof' });
  tokenChainTraceStore.completeTrace(true);
  render(<MemoryRouter initialEntries={["/use-case-diagrams/UC1"]}><Routes><Route path="/use-case-diagrams/:ucId" element={<UseCaseDiagramPage />} /></Routes></MemoryRouter>);
  expect(screen.getByTestId('ucd-mode')).toHaveTextContent('Live run overlay');
});

it('shows the curated walkthrough when the store is empty', () => {
  render(<MemoryRouter initialEntries={["/use-case-diagrams/UC1"]}><Routes><Route path="/use-case-diagrams/:ucId" element={<UseCaseDiagramPage />} /></Routes></MemoryRouter>);
  expect(screen.getByTestId('ucd-mode')).toHaveTextContent('Curated walkthrough');
});
```

(Match the file's existing render helpers/router wrapper; the store calls mirror the rail tests' seeding.)

- [ ] **Step 5: Run page suite — PASS; commit**

```bash
git add src/config/useCaseDiagrams/UC1.js src/config/useCaseDiagrams/UC8.js src/services/tokenChainTrace/ucLiveOverlay.js src/services/tokenChainTrace/__tests__/ucLiveOverlay.test.js src/context/ProofOfEnforcementContext.js src/components/UseCaseDiagramPage.jsx src/components/__tests__/UseCaseDiagramPage.test.jsx
git commit -m "feat(uc): use-case diagram pages overlay the live run's hops

UC1 and UC8 rebuild their walk from the trace store's fired hops when the
run's use-case slug matches; every other page (and any non-matching run)
keeps the curated fallback. Mode is badged on the page header.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Playwright — one real-stack check of the whole story

**Files:**
- Create: `demo_api_ui/tests/e2e/uc1-token-dance.real.spec.js`

**Interfaces:** follows the existing `.real.spec.js` conventions (`helpers/realLogin`, `playwright.real.config.js`, `RUN_REAL_TESTS=true`, live stack required — see uc7-airlines-smoke.real.spec.js).

```js
// The realistic-flow lock: a real UC1 chip run must show the 401 dance on
// both legs in the live surfaces, and the rail must collapse what didn't run.
// Runs ONLY against the live stack (loginAsCustomer + real gateway + PingOne);
// CI runs the mocked suites instead.
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, getE2eBaseUrl } = require('./helpers/realLogin');

test('UC1 run: dance hops visible, non-fired hops collapsed behind the chip', { timeout: 240_000 }, async ({ page }) => {
  await loginAsCustomer(page);
  await page.goto(`${getE2eBaseUrl().replace(/\/$/, '')}/dashboard`);
  // Run UC1 the way a presenter does: click its chip (same selector pattern
  // stepVerification.banking.real.spec.js uses — read it and mirror the
  // chip-lookup helper; do not hardcode a second copy of the locator).
  await page.getByRole('button', { name: /check balance/i }).first().click();
  // Wait for the run to settle (reply lands / outcome recorded).
  await page.waitForSelector('[data-testid="tctr-run-story"]', { timeout: 120_000 });

  // 1. The dance: both challenge hops render as done.
  await expect(page.locator('[data-step-id="tools-list-challenge"]')).toContainText('401');
  await expect(page.locator('[data-step-id="tools-call-challenge"]')).toContainText('401');

  // 2. The collapse: chip present with a nonzero count, and a never-fired hop
  //    (database, on a read-only balance run) is NOT rendered as a card.
  const chip = page.locator('[data-testid="tctr-skipped-chip"]');
  await expect(chip).toBeVisible();
  await expect(chip).not.toContainText('+ 0');
  await expect(page.locator('[data-step-id="database"]')).toHaveCount(0);

  // 3. Expand reveals the greyed hops.
  await chip.click();
  await expect(page.locator('[data-step-id="database"]')).toHaveCount(1);

  // 4. The reel draws the dance as arrows (401 evidence in the reel labels).
  await expect(page.locator('.srd-arrow-label, .srd-note-label').first()).toBeVisible();
  await page.screenshot({ path: 'evidence/uc1-token-dance.png', fullPage: true });
});
```

Notes for the implementer:
- `data-step-id` is emitted by TraceStepCard's `<details>` (the rail's map view already relies on it — see TokenChainTraceRail.jsx's `querySelector('.tctr-step[data-step-id=...]')`). Verify the reel's label class names before finalizing assertion 4; adjust selectors to what the DOM actually emits rather than weakening the assertions.
- The chip lives in both the detail and map chain views; the spec asserts whichever view is default-open.

- [ ] **Step 1: Write the spec.**
- [ ] **Step 2: Run against the live stack** (start stack via OrbStack docker if not up; then):

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_ui
RUN_REAL_TESTS=true npx playwright test --config playwright.real.config.js tests/e2e/uc1-token-dance.real.spec.js
```

Expected: PASS. If the stack is not available in this environment, mark the spec skipped-with-reason (`test.skip(!process.env.RUN_REAL_TESTS, ...)`) — it is already gated by the real config — and record that live verification is pending.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/uc1-token-dance.real.spec.js
git commit -m "test(e2e): UC1 real-run lock — dance hops drawn, unfired hops collapsed

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Full verification

- [ ] **Step 1: Unit suites (worktree)**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_ui && npx jest src/services/tokenChainTrace src/components/__tests__ src/utils/__tests__/privilegeA2aChainRun.test.js
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/realistic-flow-ui/demo_api_server && npx jest src/__tests__/mcpToolPipeline.discovery.test.js src/__tests__/mcpGatewayClient.discovery.test.js
```
Expected: all PASS.

- [ ] **Step 2: Live verification checklist (stack up, OrbStack docker):**

1. Sign in → run UC1 chip → rail: `tools-list-challenge` done (401 evidence), `tools-list` done (permitted count), `tools-call-challenge` done, gateway done; chip counts the rest; expand → greyed with reasons.
2. Movie reel: dance visible as arrows in wire order.
3. `/use-case-diagrams/UC1` after the run: "Live run overlay" badge, walk rebuilt from fired hops; `/use-case-diagrams/UC8` with no matching run: "Curated walkthrough".
4. Static sequence page: 5a/5b/25a/25b render; `discovery-dance` scenario plays.
5. Free-typed prompt on the UC1 page: curated fallback (no overlay).
6. Flag off (`ff_mcp_discovery_before_call=false` in Quick Config) + rerun UC1: no tools/list leg; challenge hops for tools/list collapse (probe still issues the anonymous call — the tools-list-challenge hop still shows; only the credentialed discovery leg disappears).

- [ ] **Step 3: Merge back** (from the worktree branch, per this repo's flow):

```bash
cd /Users/cmuir/Development/AI-DEMO2 && git merge feat/realistic-flows-dynamic-steps
```

---

## Scope notes (deviations from the presented design, and why)

Presented design listed four more surfaces as "convert to shared policy". On recon, three of them don't consume `buildTraceSteps` steps at all, and the fourth is already correct — converting them would add code without changing what a viewer sees:

- **TokenChainDisplay, SimpleStepperPanel, DetailedStepsTabContent** render the raw token-event stream (`TokenChainContext.events`) — every event in it actually fired. They already satisfy "if we do not do a step, don't show it"; their `didNotRun`/`halted` ghosting is post-failure context, not unfired-step noise. No change.
- **SystemFlowMap** is a fixed infrastructure map (BFF, gateway, P1AZ, MCP, RS boxes): `stateForStep` returns `null` → unlit for evidence-free hops and `skipped` for notinpath — a grey variant, not a "this happened" state. Hiding infrastructure boxes because a run bypassed them would make the map jitter between runs. No change.
- **DemoStepsLifelineAuditPage** is a static audit snapshot (hardcoded STEPS rows about which UCs draw); it reads no runtime state. No change.
- **UC matching** uses a `slug` line in the UC config instead of a `/api/use-cases` catalog fetch: slugs are vertical-independent by design, so the config line is simpler and works offline. Same outcome as the presented design.

If any of these should actually change, say so and they become a follow-up task.
