# Guided Demo Track — Plan A: Server Foundation + Live Token Chain Tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side Guided Demo Track state (definition + run ledger + observation matcher + API) and the live "Demo Track" tab on the Token Chain panel.

**Architecture:** A static track definition (`config/demoTrack.js`) curates 9 steps over the existing use-case catalog. A service (`demoTrackService.js`) keeps one active run whose green/red slots are filled by three tiny observation hooks at existing choke points (MCP tool audit, pipeline authorize-block, attack-sim route). A thin authenticated route exposes definition + run state. The UI adds a 5th tab to `TokenChainDisplay` that polls that route and renders slots, mini-chains, and "STEP N PROVED" cards.

**Tech Stack:** Node >= 22, CommonJS + Express + jest + supertest (server); React 19 + vitest (UI — NOT jest).

**Spec:** `docs/superpowers/specs/2026-08-03-guided-demo-track-design.md`. Plan B (standalone page + history UI), Plan C (agent dropdown), Plan D (UC16/UC2 fixes) come after this lands.

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. This plan's UI uses only `✓` and `✕`.
- Work on the worktree branch `worktree-guided-demo-track-spec`. Stage files explicitly (`git add <file>`), never `git add -A` (jest regenerates data files under `demo_api_server/data/`).
- Server tests: `cd demo_api_server && CI=true npx jest tests/<file> --forceExit`. If jest says "No tests found" in the worktree, run with the explicit relative path from `demo_api_server/`.
- UI tests: `cd demo_api_ui && npx vitest run src/components/__tests__/<file>` — vitest, never jest.
- All observation hooks are non-fatal: wrapped in try/catch, lazy `require`, never block the host code path.
- Do not modify auth, token exchange, or session code. Hooks are read-only observers.
- Deviation from spec (approved to surface): gauntlet tile "UC4 overscoped" has no attack sim; substituted `tampered-intent-token` (UC15). Config is data-only — swapping tiles later is a one-line change.

---

### Task 1: Track definition config

**Files:**
- Create: `demo_api_server/config/demoTrack.js`
- Test: `demo_api_server/tests/demoTrack.config.test.js`

**Interfaces:**
- Produces: `TRACK_STEPS` (array, 9 entries), `GAUNTLET_SIMS` (array of 6 sim descriptors), `getTrackDefinition()` → `{ steps: TRACK_STEPS, gauntletSims: GAUNTLET_SIMS }`. Slot shape consumed by Tasks 2–5:
  `slots.green` / `slots.red` = `{ source: 'tool'|'sim', chipText?, label?, match: { tools?: string[], sims?: string[] }, expected: string[] }`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/demoTrack.config.test.js
'use strict';
const { TRACK_STEPS, GAUNTLET_SIMS, getTrackDefinition } = require('../config/demoTrack');

describe('demoTrack config', () => {
  test('has 9 steps with unique ids in act order', () => {
    expect(TRACK_STEPS).toHaveLength(9);
    const ids = TRACK_STEPS.map(s => s.stepId);
    expect(new Set(ids).size).toBe(9);
    const acts = TRACK_STEPS.map(s => s.act);
    expect(acts).toEqual([1, 1, 1, 1, 1, 1, 1, 2, 2]);
  });

  test('every step has slots with a valid source, match, and expected verdicts', () => {
    for (const step of TRACK_STEPS) {
      for (const key of ['green', 'red']) {
        const slot = step.slots[key];
        if (!slot) continue; // gauntlet step has no green slot
        expect(['tool', 'sim']).toContain(slot.source);
        if (slot.source === 'tool') expect(Array.isArray(slot.match.tools)).toBe(true);
        if (slot.source === 'sim') expect(Array.isArray(slot.match.sims)).toBe(true);
        expect(slot.expected.length).toBeGreaterThan(0);
      }
      expect(step.proved.sayThis).toBeTruthy();
    }
  });

  test('gauntlet has 6 sims and getTrackDefinition returns both', () => {
    expect(GAUNTLET_SIMS).toHaveLength(6);
    const def = getTrackDefinition();
    expect(def.steps).toHaveLength(9);
    expect(def.gauntletSims).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrack.config.test.js --forceExit`
Expected: FAIL — `Cannot find module '../config/demoTrack'`

- [ ] **Step 3: Write the config**

```js
// demo_api_server/config/demoTrack.js
'use strict';
/**
 * Guided Demo Track — curated 2-act ordering over config/useCases.js.
 * Data only; runtime slot state lives in services/demoTrackService.js.
 * Spec: docs/superpowers/specs/2026-08-03-guided-demo-track-design.md
 */

const GAUNTLET_SIMS = [
  { sim: 'insufficient-scope',    ucId: 'UC5',  label: 'Wrong scope' },
  { sim: 'cross-owner-account',   ucId: 'UC10', label: 'Cross-owner access' },
  { sim: 'wrong-aud',             ucId: 'UC11', label: 'Bad client / wrong audience' },
  { sim: 'tampered-intent-token', ucId: 'UC15', label: 'Tampered intent token' },
  { sim: 'impersonation-no-act',  ucId: 'UC16', label: 'Impersonation (no OBO)' },
  { sim: 'introspection-down',    ucId: 'UC29', label: 'Introspection outage — fail closed' },
];

const TRACK_STEPS = [
  {
    stepId: 'delegated-access', act: 1, title: 'Delegated access — token exchange',
    capability: 'RFC 8693 · act claim', ucIds: ['UC1', 'UC3', 'UC12'],
    buyerStory: 'Every agent action must trace back to a real human — no anonymous agent access.',
    slots: {
      green: { source: 'tool', chipText: 'show my balance', match: { tools: ['get_account_balance', 'get_balance'] }, expected: ['PERMIT'] },
      red:   { source: 'sim', label: 'stolen token / wrong aud rejected', match: { sims: ['replayed-token'] }, expected: ['BLOCKED'] },
    },
    proved: {
      green: 'The agent acted for you — the act claim proves delegation, minted live via RFC 8693.',
      red: 'A replayed token died at the gateway — a bearer alone is not enough.',
      sayThis: 'Every agent action is cryptographically tied to the user who authorized it.',
    },
  },
  {
    stepId: 'a2a-delegation', act: 1, title: 'A2A delegation — specialist handoff',
    capability: 'Nested act chain', ucIds: ['UC2', 'UC2.5', 'UC13'],
    buyerStory: 'A specialist must carry proof of the original user\'s authorization through the entire chain.',
    slots: {
      green: { source: 'tool', chipText: 'hand off to a specialist', match: { tools: ['get_portfolio_summary'] }, expected: ['PERMIT'] },
      red:   { source: 'sim', label: 'confused-deputy actor injection blocked', match: { sims: ['rogue-actor'] }, expected: ['BLOCKED'] },
    },
    proved: {
      green: 'The specialist inherited only narrowed scope — the nested act chain shows every hop back to the user.',
      red: 'An injected rogue actor was rejected — the delegation chain cannot be forged.',
      sayThis: 'Multi-agent pipelines stay governed end-to-end.',
    },
  },
  {
    stepId: 'fine-grained-authz', act: 1, title: 'Fine-grained authorization — PingOne Authorize',
    capability: 'P1AZ · policy externalized', ucIds: ['UC6', 'UC35'],
    buyerStory: 'Policy lives outside the agent — and every decision is explainable.',
    slots: {
      green: { source: 'tool', chipText: 'transfer $200 to savings', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'transfer $6,000 to savings', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['DENY'] },
    },
    proved: {
      green: 'A normal transfer was permitted — the decision was evaluated live in PingOne Authorize, not hard-coded in the agent.',
      red: 'The same policy denied the large transfer — the tool was never invoked, decision ID on record.',
      sayThis: 'The agent didn\'t change between those two clicks — the policy decided.',
    },
  },
  {
    stepId: 'step-up', act: 1, title: 'Step-up authentication — trust is dynamic',
    capability: 'MFA · 428 challenge', ucIds: ['UC7'],
    buyerStory: 'A risk threshold mid-conversation forces re-authentication before money moves.',
    slots: {
      green: { source: 'tool', chipText: 'transfer after completing MFA', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'transfer above the step-up threshold', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['STEP_UP'] },
    },
    proved: {
      green: 'After MFA, the same transfer completed — trust was re-established, not assumed.',
      red: 'Without step-up the transfer was challenged (HTTP 428) — the deny is inherent to the flow.',
      sayThis: 'Trust is dynamic — it is earned per transaction, not granted once at login.',
    },
  },
  {
    stepId: 'hitl-ciba', act: 1, title: 'Human-in-the-loop — CIBA out-of-band approval',
    capability: 'HITL · CIBA', ucIds: ['UC8', 'UC22', 'UC27'],
    buyerStory: 'High-risk actions pause for a human decision on a second device — and the agent cannot skip it.',
    slots: {
      green: { source: 'tool', chipText: 'transfer approved by human on second device', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'agent attempts to bypass consent', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['HITL', 'DENY'] },
    },
    proved: {
      green: 'A human approved out-of-band and only then did the transfer proceed.',
      red: 'The bypass attempt failed — consent is enforced server-side, not agent-side.',
      sayThis: 'The human stays in the loop by policy, not by the agent\'s good manners.',
    },
  },
  {
    stepId: 'mcp-gateway', act: 1, title: 'MCP Gateway — third-party MCP server, governed',
    capability: 'Gateway scoping', ucIds: ['UC30', 'UC31', 'UC32'],
    buyerStory: 'An external MCP server your bank did not write is still governed centrally at the gateway.',
    slots: {
      green: { source: 'tool', chipText: 'get the weather (scoped, permitted)', match: { tools: ['get_weather', 'get_forecast'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'out-of-scope third-party call', match: { tools: ['get_weather', 'get_forecast'] }, expected: ['DENY'] },
    },
    proved: {
      green: 'The third-party MCP call was permitted only for the scope the gateway granted.',
      red: 'The out-of-scope call was denied at the gateway — the external server never saw it.',
      sayThis: 'You can adopt third-party MCP servers without adopting their risk.',
    },
  },
  {
    stepId: 'attack-gauntlet', act: 1, title: 'Attack gauntlet — the chain fails closed',
    capability: 'Act 1 finale', ucIds: ['UC5', 'UC10', 'UC11', 'UC15', 'UC16', 'UC29', 'UC26'],
    buyerStory: 'Everything you just watched permit — now watch it deny. Same rails, rapid fire.',
    // Gauntlet: no green/red pair; six sim tiles tracked in run.gauntlet.
    slots: {
      red: { source: 'sim', label: 'six attacks, six denials', match: { sims: GAUNTLET_SIMS.map(g => g.sim) }, expected: ['BLOCKED'] },
    },
    proved: {
      green: null,
      red: 'Six distinct attacks, six denials — verdicts fetched live, not slideware.',
      sayThis: 'We didn\'t build a demo that works. We built one you can attack.',
    },
  },
  {
    stepId: 'pingone-mcp-admin', act: 2, title: 'PingOne MCP server — the governed admin agent',
    capability: 'Hosted PingOne MCP', ucIds: ['UC-LEARN2'],
    buyerStory: 'The AI that manages your identity platform is itself governed by it.',
    slots: {
      green: { source: 'tool', chipText: 'admin agent performs a real admin task', match: { tools: ['*'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'out-of-scope admin call denied', match: { tools: ['*'] }, expected: ['DENY'] },
    },
    proved: {
      green: 'The admin agent did real platform work through Ping\'s own hosted MCP server.',
      red: 'The same admin agent was denied outside its granted scope — dogfooding, same rails.',
      sayThis: 'The rails that govern your customers\' agents govern ours too.',
    },
  },
  {
    stepId: 'lifecycle-killswitch', act: 2, title: 'Agent lifecycle + kill switch',
    capability: 'Non-human identity', ucIds: ['UC19'],
    buyerStory: 'An agent identity is provisioned, audited, and revocable — instantly.',
    slots: {
      green: { source: 'tool', chipText: 'provisioned agent working normally', match: { tools: ['*'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'kill switch — next call dies', match: { tools: ['*'] }, expected: ['DENY'] },
    },
    proved: {
      green: 'The agent worked because its identity was provisioned and in good standing.',
      red: 'One kill switch later, the very next call died — revocation is immediate.',
      sayThis: 'Non-human identity is managed like workforce identity — including the off switch.',
    },
  },
];

function getTrackDefinition() {
  return { steps: TRACK_STEPS, gauntletSims: GAUNTLET_SIMS };
}

module.exports = { TRACK_STEPS, GAUNTLET_SIMS, getTrackDefinition };
```

Note: wildcard `['*']` on act-2 steps is deliberate — those verticals' tool names vary; the active-step rule (Task 2) scopes what a wildcard can fill.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrack.config.test.js --forceExit`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/demoTrack.js demo_api_server/tests/demoTrack.config.test.js
git commit -m "feat(demo-track): track definition config — 2 acts, 9 steps, gauntlet sims"
```

---

### Task 2: demoTrackService — run ledger + matcher + LMDB persistence

**Files:**
- Create: `demo_api_server/services/lmdb/demoTrackStore.lmdb.js`
- Create: `demo_api_server/services/demoTrackService.js`
- Test: `demo_api_server/tests/demoTrackService.test.js`

**Interfaces:**
- Consumes: `getTrackDefinition()`, `TRACK_STEPS` from Task 1.
- Produces (consumed by Tasks 3 & 4):
  - `getState()` → `{ track, run }` where `run = { runId, startedAt, activeStepId, slots: { '<stepId>:green'|'<stepId>:red': { verdict, decisionId, via, at } }, gauntlet: { '<sim>': { blocked, status, errorCode, decisionId, at } } }`
  - `startRun()` → new run (previous active run pushed to history)
  - `setActiveStep(stepId)` → run
  - `getHistory()` → `[{ runId, startedAt, endedAt, slots, gauntlet }]` (newest first, cap 20)
  - `observeToolCall({ toolName, success, timestamp })`
  - `observeDecision({ tool, decision, decisionId })` — decision ∈ 'DENY' | 'STEP_UP' | 'HITL'
  - `observeAttackSim({ sim, status, errorCode, decisionId })`
  - `_resetForTests()`

**Matching rules (the heart of the feature — implement exactly):**
1. Observations lazily create an active run if none exists.
2. Candidate slots are tried in this order: the **active step** first, then remaining steps in track order. First matching **unfilled or refillable** slot wins; a later matching observation **overwrites** (presenter re-runs refresh the stamp).
3. `observeToolCall` with `success: true` fills a green slot whose `match.tools` contains `toolName` or `'*'` → verdict `PERMIT`. With `success: false` it fills a red slot (same tool match) whose `expected` includes `DENY` → verdict `DENY` (decisionId null — gateway-side denials carry no BFF decision id).
4. `observeDecision` fills a red slot whose `match.tools` contains `tool` or `'*'` and whose `expected` includes `decision` → verdict = decision, with decisionId.
5. `observeAttackSim`: if the sim is a `GAUNTLET_SIMS` member, stamp `run.gauntlet[sim] = { blocked: status >= 400, status, errorCode, decisionId, at }`. Independently, any step red slot with `source: 'sim'` whose `match.sims` contains the sim is stamped verdict `BLOCKED` when `status >= 400`.
6. Wildcard `'*'` tool matches are honored **only on the active step** — never in the track-order fallback scan (prevents act-2 wildcards from swallowing every observation).
7. When both slots of the active step are filled, `activeStepId` auto-advances to the next step in track order (gauntlet counts as complete when all 6 gauntlet sims are blocked; steps with only a red slot complete on that slot).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/demoTrackService.test.js
'use strict';
const svc = require('../services/demoTrackService');

describe('demoTrackService', () => {
  beforeEach(() => svc._resetForTests());

  test('lazily creates a run and fills the active step green slot on tool success', () => {
    svc.observeToolCall({ toolName: 'get_account_balance', success: true, timestamp: '2026-08-03T10:00:00Z' });
    const { run } = svc.getState();
    expect(run.slots['delegated-access:green']).toMatchObject({ verdict: 'PERMIT', via: 'get_account_balance' });
  });

  test('sim observation fills the matching red slot and the gauntlet map', () => {
    svc.observeAttackSim({ sim: 'replayed-token', status: 401, errorCode: 'invalid_token', decisionId: null });
    svc.observeAttackSim({ sim: 'impersonation-no-act', status: 403, errorCode: 'obo_required', decisionId: 'd-1' });
    const { run } = svc.getState();
    expect(run.slots['delegated-access:red'].verdict).toBe('BLOCKED');
    expect(run.gauntlet['impersonation-no-act']).toMatchObject({ blocked: true, decisionId: 'd-1' });
  });

  test('observeDecision fills a red tool slot with decisionId; active step tried first', () => {
    svc.setActiveStep('fine-grained-authz');
    svc.observeDecision({ tool: 'transfer_funds', decision: 'DENY', decisionId: 'd-4f21c9' });
    const { run } = svc.getState();
    expect(run.slots['fine-grained-authz:red']).toMatchObject({ verdict: 'DENY', decisionId: 'd-4f21c9' });
  });

  test('wildcard slots only fill on the active step', () => {
    svc.setActiveStep('fine-grained-authz');
    svc.observeToolCall({ toolName: 'some_unknown_tool', success: true, timestamp: '2026-08-03T10:01:00Z' });
    const { run } = svc.getState();
    expect(run.slots['pingone-mcp-admin:green']).toBeUndefined();
    svc.setActiveStep('pingone-mcp-admin');
    svc.observeToolCall({ toolName: 'some_unknown_tool', success: true, timestamp: '2026-08-03T10:02:00Z' });
    expect(svc.getState().run.slots['pingone-mcp-admin:green'].verdict).toBe('PERMIT');
  });

  test('auto-advances active step when both slots fill', () => {
    svc.setActiveStep('fine-grained-authz');
    svc.observeToolCall({ toolName: 'transfer_funds', success: true, timestamp: '2026-08-03T10:00:00Z' });
    svc.observeDecision({ tool: 'transfer_funds', decision: 'DENY', decisionId: 'd-1' });
    expect(svc.getState().run.activeStepId).toBe('step-up');
  });

  test('startRun archives the previous run to history', () => {
    svc.observeToolCall({ toolName: 'get_account_balance', success: true, timestamp: '2026-08-03T10:00:00Z' });
    const first = svc.getState().run.runId;
    svc.startRun();
    const { run } = svc.getState();
    expect(run.runId).not.toBe(first);
    expect(run.slots).toEqual({});
    expect(svc.getHistory()[0].runId).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrackService.test.js --forceExit`
Expected: FAIL — `Cannot find module '../services/demoTrackService'`

- [ ] **Step 3: Write the LMDB wrapper (copy the demoScenarioStore.lmdb.js pattern)**

```js
// demo_api_server/services/lmdb/demoTrackStore.lmdb.js
'use strict';
/**
 * demoTrackStore.lmdb.js — LMDB persistence for the Guided Demo Track run
 * ledger, backing services/demoTrackService.js.
 * Keys (single DB 'demo_track'):
 *   demo-track:active  -> active run object
 *   demo-track:history -> array of archived runs (newest first, cap 20)
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'demo_track';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function get(key) { return _db().get(key) || null; }
function put(key, value) { _db().putSync(key, value); }

module.exports = { get, put };
```

- [ ] **Step 4: Write the service**

```js
// demo_api_server/services/demoTrackService.js
'use strict';
/**
 * Guided Demo Track — run ledger + observation matcher.
 * Observations arrive from three read-only hooks (mcpToolAuditStore,
 * mcpToolPipeline authorize-block, attack-sim route); all hooks are
 * best-effort and this service must never throw into a host code path.
 * Matching rules: docs/superpowers/plans/2026-08-03-guided-demo-track-plan-a.md Task 2.
 */
const { TRACK_STEPS, GAUNTLET_SIMS, getTrackDefinition } = require('../config/demoTrack');

let lmdb = null;
try { lmdb = require('./lmdb/demoTrackStore.lmdb'); } catch { /* tests without LMDB env */ }

const ACTIVE_KEY = 'demo-track:active';
const HISTORY_KEY = 'demo-track:history';
const HISTORY_CAP = 20;
const GAUNTLET_SET = new Set(GAUNTLET_SIMS.map(g => g.sim));

let _run = null;
let _history = null;

function _persist() {
  try {
    if (!lmdb) return;
    lmdb.put(ACTIVE_KEY, _run);
    lmdb.put(HISTORY_KEY, _history);
  } catch { /* persistence is best-effort */ }
}

function _hydrate() {
  if (_history === null) {
    try { _history = (lmdb && lmdb.get(HISTORY_KEY)) || []; } catch { _history = []; }
  }
  if (_run === null) {
    try { _run = lmdb && lmdb.get(ACTIVE_KEY); } catch { _run = null; }
  }
}

function _newRun() {
  return {
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    startedAt: new Date().toISOString(),
    activeStepId: TRACK_STEPS[0].stepId,
    slots: {},
    gauntlet: {},
  };
}

function _ensureRun() {
  _hydrate();
  if (!_run) { _run = _newRun(); _persist(); }
  return _run;
}

function _stepById(stepId) { return TRACK_STEPS.find(s => s.stepId === stepId) || null; }

function _stepComplete(step, run) {
  if (step.stepId === 'attack-gauntlet') {
    return GAUNTLET_SIMS.every(g => run.gauntlet[g.sim] && run.gauntlet[g.sim].blocked);
  }
  const greenOk = !step.slots.green || run.slots[`${step.stepId}:green`];
  const redOk = !step.slots.red || run.slots[`${step.stepId}:red`];
  return Boolean(greenOk && redOk);
}

function _maybeAdvance(run) {
  const idx = TRACK_STEPS.findIndex(s => s.stepId === run.activeStepId);
  if (idx === -1) return;
  if (!_stepComplete(TRACK_STEPS[idx], run)) return;
  const next = TRACK_STEPS[idx + 1];
  if (next) run.activeStepId = next.stepId;
}

/**
 * Candidate steps: active step first, then track order. `wildcardOk` is true
 * only for the active step — '*' matches must not swallow observations from
 * the fallback scan.
 */
function _candidates(run) {
  const active = _stepById(run.activeStepId);
  const rest = TRACK_STEPS.filter(s => s !== active);
  return [...(active ? [{ step: active, wildcardOk: true }] : []), ...rest.map(step => ({ step, wildcardOk: false }))];
}

function _toolMatches(slot, toolName, wildcardOk) {
  const tools = (slot.match && slot.match.tools) || [];
  if (tools.includes(toolName)) return true;
  return wildcardOk && tools.includes('*');
}

function _fill(run, stepId, color, stamp) {
  run.slots[`${stepId}:${color}`] = stamp;
  _maybeAdvance(run);
  _persist();
}

function observeToolCall({ toolName, success, timestamp }) {
  try {
    const run = _ensureRun();
    const at = timestamp || new Date().toISOString();
    for (const { step, wildcardOk } of _candidates(run)) {
      if (success) {
        const g = step.slots.green;
        if (g && g.source === 'tool' && _toolMatches(g, toolName, wildcardOk)) {
          return _fill(run, step.stepId, 'green', { verdict: 'PERMIT', decisionId: null, via: toolName, at });
        }
      } else {
        const r = step.slots.red;
        if (r && r.source === 'tool' && r.expected.includes('DENY') && _toolMatches(r, toolName, wildcardOk)) {
          return _fill(run, step.stepId, 'red', { verdict: 'DENY', decisionId: null, via: toolName, at });
        }
      }
    }
  } catch { /* never throw into the audit path */ }
}

function observeDecision({ tool, decision, decisionId }) {
  try {
    const run = _ensureRun();
    const at = new Date().toISOString();
    for (const { step, wildcardOk } of _candidates(run)) {
      const r = step.slots.red;
      if (r && r.source === 'tool' && r.expected.includes(decision) && _toolMatches(r, tool, wildcardOk)) {
        return _fill(run, step.stepId, 'red', { verdict: decision, decisionId: decisionId || null, via: tool, at });
      }
    }
  } catch { /* never throw into the pipeline */ }
}

function observeAttackSim({ sim, status, errorCode, decisionId }) {
  try {
    const run = _ensureRun();
    const at = new Date().toISOString();
    const blocked = Number(status) >= 400;
    if (GAUNTLET_SET.has(sim)) {
      run.gauntlet[sim] = { blocked, status, errorCode: errorCode || null, decisionId: decisionId || null, at };
      _maybeAdvance(run);
      _persist();
    }
    if (!blocked) return;
    for (const { step } of _candidates(run)) {
      const r = step.slots.red;
      if (r && r.source === 'sim' && r.match.sims.includes(sim)) {
        return _fill(run, step.stepId, 'red', { verdict: 'BLOCKED', decisionId: decisionId || null, via: sim, at });
      }
    }
  } catch { /* never throw into the sim route */ }
}

function getState() {
  return { track: getTrackDefinition(), run: _ensureRun() };
}

function startRun() {
  _hydrate();
  if (_run) {
    _history = [{ ..._run, endedAt: new Date().toISOString() }, ...(_history || [])].slice(0, HISTORY_CAP);
  }
  _run = _newRun();
  _persist();
  return _run;
}

function setActiveStep(stepId) {
  const run = _ensureRun();
  if (_stepById(stepId)) { run.activeStepId = stepId; _persist(); }
  return run;
}

function getHistory() {
  _hydrate();
  return _history || [];
}

function _resetForTests() { _run = _newRun(); _history = []; }

module.exports = {
  getState, startRun, setActiveStep, getHistory,
  observeToolCall, observeDecision, observeAttackSim,
  _resetForTests,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrackService.test.js --forceExit`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/demoTrackService.js demo_api_server/services/lmdb/demoTrackStore.lmdb.js demo_api_server/tests/demoTrackService.test.js
git commit -m "feat(demo-track): run ledger + observation matcher with LMDB persistence"
```

---

### Task 3: Observation hooks at the three choke points

**Files:**
- Modify: `demo_api_server/services/mcpToolAuditStore.js` (inside `recordToolCall`, after the `_events.unshift(event)` line)
- Modify: `demo_api_server/services/mcpToolPipeline.js` (inside the `if (mcpAuthz.ran && mcpAuthz.block)` branch, next to the existing `recordComplianceAudit` block that computes `decision` from `b.error`)
- Modify: `demo_api_server/routes/attackSimulator.js` (after `const result = await runAttackSim(sim, req);`)
- Test: `demo_api_server/tests/demoTrackHooks.test.js`

**Interfaces:**
- Consumes: `observeToolCall`, `observeDecision`, `observeAttackSim` from Task 2. All three hooks lazy-require the service and swallow every error.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/demoTrackHooks.test.js
'use strict';
const svc = require('../services/demoTrackService');
const { recordToolCall } = require('../services/mcpToolAuditStore');

describe('demo track observation hooks', () => {
  beforeEach(() => svc._resetForTests());

  test('mcpToolAuditStore.recordToolCall feeds observeToolCall', () => {
    recordToolCall({ userId: 'u1', toolName: 'get_account_balance', success: true, duration: 5 });
    expect(svc.getState().run.slots['delegated-access:green']).toMatchObject({ verdict: 'PERMIT' });
  });

  test('recordToolCall failure feeds a red DENY slot when that step is active', () => {
    svc.setActiveStep('mcp-gateway');
    recordToolCall({ userId: 'u1', toolName: 'get_weather', success: false, duration: 5 });
    expect(svc.getState().run.slots['mcp-gateway:red']).toMatchObject({ verdict: 'DENY' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrackHooks.test.js --forceExit`
Expected: FAIL — slots undefined (hook not wired yet)

- [ ] **Step 3: Wire the three hooks**

In `mcpToolAuditStore.js`, inside `recordToolCall` immediately after `_events.unshift(event);`:

```js
	// Guided Demo Track — best-effort observation; must never affect the audit.
	try {
		require('./demoTrackService').observeToolCall({ toolName, success, timestamp: event.timestamp });
	} catch { /* track observation is optional */ }
```

In `mcpToolPipeline.js`, inside `if (mcpAuthz.ran && mcpAuthz.block) {`, immediately after the `deps.emit({ phase: 'authorize_denied', ... })` call (before the `recordComplianceAudit` block so it runs even when that optional dep is unwired):

```js
            // Guided Demo Track — best-effort observation; never blocks the response.
            try {
                const _b = mcpAuthz.block.body || {};
                const _trackDecision = _b.error === 'mcp_step_up_required' ? 'STEP_UP'
                    : _b.error === 'mcp_hitl_required' ? 'HITL'
                        : 'DENY';
                require('./demoTrackService').observeDecision({
                    tool,
                    decision: _trackDecision,
                    decisionId: _b.decisionId || null,
                });
            } catch { /* track observation is optional */ }
```

In `routes/attackSimulator.js`, after `const result = await runAttackSim(sim, req);`:

```js
    // Guided Demo Track — best-effort observation; never blocks the sim response.
    try {
      require('../services/demoTrackService').observeAttackSim({
        sim,
        status: result?.status,
        errorCode: result?.errorCode || null,
        decisionId: result?.authorize?.decisionId || result?.decisionId || null,
      });
    } catch { /* track observation is optional */ }
```

- [ ] **Step 4: Run the new test and the touched files' existing suites**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrackHooks.test.js --forceExit`
Expected: PASS (2 tests)

Run: `cd demo_api_server && CI=true npx jest tests --forceExit -t "mcpToolPipeline" || CI=true npx jest tests/mcpToolPipeline --forceExit`
Expected: existing pipeline tests still PASS (hook is try/catch-isolated). If no suite matches that name, run the full suite in the final task instead.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/mcpToolAuditStore.js demo_api_server/services/mcpToolPipeline.js demo_api_server/routes/attackSimulator.js demo_api_server/tests/demoTrackHooks.test.js
git commit -m "feat(demo-track): observation hooks — tool audit, authorize block, attack sims"
```

---

### Task 4: Demo Track API route

**Files:**
- Create: `demo_api_server/routes/demoTrack.js`
- Modify: `demo_api_server/server.js` (one mount line next to the `/api/use-cases` mount at ~line 1083)
- Test: `demo_api_server/tests/demoTrackRoute.test.js`

**Interfaces:**
- Consumes: `getState`, `startRun`, `setActiveStep`, `getHistory` from Task 2.
- Produces (consumed by Task 5's UI and later Plans B/C):
  - `GET  /api/demo-track` → `{ track, run }`
  - `POST /api/demo-track/runs` → `{ run }` (starts a new run)
  - `POST /api/demo-track/active-step` body `{ stepId }` → `{ run }`
  - `GET  /api/demo-track/runs` → `{ runs }` (history)

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/demoTrackRoute.test.js
'use strict';
const express = require('express');
const request = require('supertest');
const svc = require('../services/demoTrackService');

function app() {
  const a = express();
  a.use(express.json());
  // Route is mounted behind authenticateToken in server.js; test the router bare.
  a.use('/api/demo-track', require('../routes/demoTrack'));
  return a;
}

describe('demo track route', () => {
  beforeEach(() => svc._resetForTests());

  test('GET returns track definition and active run', async () => {
    const res = await request(app()).get('/api/demo-track');
    expect(res.status).toBe(200);
    expect(res.body.track.steps).toHaveLength(9);
    expect(res.body.run.runId).toMatch(/^run-/);
  });

  test('POST /runs starts a fresh run; GET /runs lists the archived one', async () => {
    const a = app();
    const r1 = await request(a).get('/api/demo-track');
    const res = await request(a).post('/api/demo-track/runs');
    expect(res.status).toBe(200);
    expect(res.body.run.runId).not.toBe(r1.body.run.runId);
    const hist = await request(a).get('/api/demo-track/runs');
    expect(hist.body.runs[0].runId).toBe(r1.body.run.runId);
  });

  test('POST /active-step sets the active step; unknown step is a no-op 200', async () => {
    const res = await request(app()).post('/api/demo-track/active-step').send({ stepId: 'step-up' });
    expect(res.status).toBe(200);
    expect(res.body.run.activeStepId).toBe('step-up');
  });
});
```

(Remove the placeholder line marked above when writing the file — it is shown struck so the diff intent is unambiguous: the test body is the three awaits.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrackRoute.test.js --forceExit`
Expected: FAIL — `Cannot find module '../routes/demoTrack'`

- [ ] **Step 3: Write the route and mount it**

```js
// demo_api_server/routes/demoTrack.js
'use strict';
/**
 * Guided Demo Track API — read state, start runs, set the active step.
 * Mounted behind authenticateToken in server.js (same posture as /api/use-cases).
 */
const express = require('express');
const router = express.Router();
const svc = require('../services/demoTrackService');

router.get('/', (req, res) => {
  res.json(svc.getState());
});

router.post('/runs', (req, res) => {
  res.json({ run: svc.startRun() });
});

router.get('/runs', (req, res) => {
  res.json({ runs: svc.getHistory() });
});

router.post('/active-step', (req, res) => {
  res.json({ run: svc.setActiveStep(req.body && req.body.stepId) });
});

module.exports = router;
```

In `server.js`, next to the `/api/use-cases` mount (~line 1083):

```js
app.use('/api/demo-track', authenticateToken, require('./routes/demoTrack'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/demoTrackRoute.test.js --forceExit`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/demoTrack.js demo_api_server/server.js demo_api_server/tests/demoTrackRoute.test.js
git commit -m "feat(demo-track): /api/demo-track route — state, runs, active step"
```

---

### Task 5: UI — TokenChainDemoTrackTab component

**Files:**
- Create: `demo_api_ui/src/components/TokenChainDemoTrackTab.jsx`
- Create: `demo_api_ui/src/components/TokenChainDemoTrackTab.css`
- Test: `demo_api_ui/src/components/__tests__/TokenChainDemoTrackTab.test.jsx`

**Interfaces:**
- Consumes: `GET /api/demo-track` (Task 4 shape), `POST /api/demo-track/active-step`, `POST /api/demo-track/runs`.
- Produces: default-export React component `<TokenChainDemoTrackTab />` (no props) — mounted by Task 6.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/TokenChainDemoTrackTab.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TokenChainDemoTrackTab from '../TokenChainDemoTrackTab';

const STATE = {
  track: {
    steps: [
      { stepId: 'delegated-access', act: 1, title: 'Delegated access — token exchange', capability: 'RFC 8693 · act claim', ucIds: ['UC1'], buyerStory: 'story', slots: { green: { chipText: 'show my balance', expected: ['PERMIT'] }, red: { label: 'replayed token', expected: ['BLOCKED'] } }, proved: { green: 'g', red: 'r', sayThis: 's' } },
      { stepId: 'attack-gauntlet', act: 1, title: 'Attack gauntlet', capability: 'finale', ucIds: ['UC26'], buyerStory: 'story', slots: { red: { label: 'six attacks', expected: ['BLOCKED'] } }, proved: { green: null, red: 'r', sayThis: 's' } },
      { stepId: 'pingone-mcp-admin', act: 2, title: 'PingOne MCP server', capability: 'admin', ucIds: ['UC-LEARN2'], buyerStory: 'story', slots: { green: { chipText: 'admin task', expected: ['PERMIT'] }, red: { chipText: 'denied', expected: ['DENY'] } }, proved: { green: 'g', red: 'r', sayThis: 's' } },
    ],
    gauntletSims: [{ sim: 'impersonation-no-act', ucId: 'UC16', label: 'Impersonation' }],
  },
  run: {
    runId: 'run-1', startedAt: '2026-08-03T10:00:00Z', activeStepId: 'delegated-access',
    slots: { 'delegated-access:green': { verdict: 'PERMIT', decisionId: null, via: 'get_account_balance', at: '2026-08-03T10:42:00Z' } },
    gauntlet: { 'impersonation-no-act': { blocked: true, status: 403, at: '2026-08-03T10:43:00Z' } },
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(STATE) })));
});

describe('TokenChainDemoTrackTab', () => {
  it('renders acts, steps, and a filled green slot', async () => {
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getByText(/Delegated access/)).toBeInTheDocument());
    expect(screen.getByText(/ACT 1/)).toBeInTheDocument();
    expect(screen.getByText(/ACT 2/)).toBeInTheDocument();
    expect(screen.getByText(/PERMIT ✓/)).toBeInTheDocument();
  });

  it('shows gauntlet progress from the gauntlet map', async () => {
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getByText(/1 \/ 1 blocked/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainDemoTrackTab.test.jsx`
Expected: FAIL — cannot resolve `../TokenChainDemoTrackTab`

- [ ] **Step 3: Write the component + CSS**

```jsx
// demo_api_ui/src/components/TokenChainDemoTrackTab.jsx
// Guided Demo Track — live tab content for TokenChainDisplay.
// Polls /api/demo-track while mounted; slots fill themselves from real runs.
import React, { useCallback, useEffect, useState } from "react";
import "./TokenChainDemoTrackTab.css";

const POLL_MS = 5000;

function slotBadge(stamp, slot) {
  if (!stamp) return <span className="tct-slot tct-slot--empty">{slot?.chipText || slot?.label || "pending"}</span>;
  const cls = stamp.verdict === "PERMIT" ? "tct-slot--green" : "tct-slot--red";
  const mark = stamp.verdict === "PERMIT" ? "✓" : "✕";
  const time = stamp.at ? new Date(stamp.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <span className={`tct-slot ${cls}`}>
      {stamp.verdict} {mark} {time}
      {stamp.decisionId ? <span className="tct-decision"> · {stamp.decisionId}</span> : null}
    </span>
  );
}

export default function TokenChainDemoTrackTab() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/demo-track", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
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

  const setActiveStep = useCallback(async (stepId) => {
    try {
      await fetch("/api/demo-track/active-step", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      load();
    } catch { /* next poll recovers */ }
  }, [load]);

  const startRun = useCallback(async () => {
    try {
      await fetch("/api/demo-track/runs", { method: "POST", credentials: "include" });
      load();
    } catch { /* next poll recovers */ }
  }, [load]);

  if (error) return <div className="tct-error">Demo Track unavailable — {error}</div>;
  if (!state) return <div className="tct-loading">Loading demo track…</div>;

  const { track, run } = state;
  const gauntletTotal = track.gauntletSims.length;
  const gauntletBlocked = track.gauntletSims.filter(g => run.gauntlet[g.sim]?.blocked).length;
  const filled = Object.keys(run.slots).length;

  const renderStep = (step) => {
    const green = run.slots[`${step.stepId}:green`];
    const red = run.slots[`${step.stepId}:red`];
    const isActive = run.activeStepId === step.stepId;
    const isGauntlet = step.stepId === "attack-gauntlet";
    const complete = isGauntlet ? gauntletBlocked === gauntletTotal : Boolean((step.slots.green ? green : true) && (step.slots.red ? red : true));
    return (
      <div key={step.stepId} className={`tct-step${isActive ? " tct-step--active" : ""}${complete ? " tct-step--done" : ""}`}>
        <button type="button" className="tct-step-head" onClick={() => setActiveStep(step.stepId)}>
          <span className="tct-step-title">{step.title}</span>
          <span className="tct-step-ucs">{step.ucIds.join(" · ")}</span>
        </button>
        {isGauntlet ? (
          <div className="tct-gauntlet">
            <span className="tct-gauntlet-score">{gauntletBlocked} / {gauntletTotal} blocked</span>
            {track.gauntletSims.map(g => (
              <span key={g.sim} className={`tct-tile${run.gauntlet[g.sim]?.blocked ? " tct-tile--blocked" : ""}`}>
                {g.label}{run.gauntlet[g.sim]?.blocked ? " ✓" : ""}
              </span>
            ))}
          </div>
        ) : (
          <div className="tct-slots">
            {step.slots.green && <div className="tct-slot-row"><span className="tct-tag tct-tag--g">GREEN</span>{slotBadge(green, step.slots.green)}</div>}
            {step.slots.red && <div className="tct-slot-row"><span className="tct-tag tct-tag--r">RED</span>{slotBadge(red, step.slots.red)}</div>}
          </div>
        )}
        {complete && (
          <div className="tct-proved">
            <h5>STEP PROVED</h5>
            {step.proved.green && <div className="tct-proved-line"><span className="tct-mark-g">✓</span> {step.proved.green}</div>}
            {step.proved.red && <div className="tct-proved-line"><span className="tct-mark-r">✕</span> {step.proved.red}</div>}
            <div className="tct-say">SAY THIS: {step.proved.sayThis}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="tct-root">
      <div className="tct-toolbar">
        <span className="tct-score">{filled} slots filled · gauntlet {gauntletBlocked}/{gauntletTotal}</span>
        <button type="button" className="tct-newrun" onClick={startRun}>Start new run</button>
      </div>
      <div className="tct-act">ACT 1 · THE CUSTOMER AGENT</div>
      {track.steps.filter(s => s.act === 1).map(renderStep)}
      <div className="tct-act">ACT 2 · SAME RAILS GOVERN THE ADMINS</div>
      {track.steps.filter(s => s.act === 2).map(renderStep)}
    </div>
  );
}
```

```css
/* demo_api_ui/src/components/TokenChainDemoTrackTab.css */
.tct-root { padding: 10px 4px; font-size: 13px; }
.tct-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.tct-score { font-weight: 600; color: var(--tcd-muted, #5f6b76); }
.tct-newrun { margin-left: auto; font-size: 12px; padding: 4px 10px; cursor: pointer; }
.tct-act { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; color: #5f6b76; margin: 12px 2px 6px; }
.tct-step { border: 1px solid #e3e7eb; border-radius: 8px; margin-bottom: 7px; background: #fbfcfd; }
.tct-step--active { border-color: #b3282d; background: #fff; }
.tct-step--done { border-color: #1e7b34; }
.tct-step-head { display: flex; width: 100%; align-items: center; gap: 8px; padding: 8px 10px; background: none; border: none; cursor: pointer; text-align: left; }
.tct-step-title { font-weight: 600; }
.tct-step-ucs { margin-left: auto; font-size: 11px; color: #5f6b76; }
.tct-slots { padding: 0 10px 8px; }
.tct-slot-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.tct-tag { font-size: 9px; font-weight: 800; width: 42px; text-align: center; border-radius: 4px; padding: 2px 0; }
.tct-tag--g { background: #ecf7ef; color: #1e7b34; }
.tct-tag--r { background: #fdeeee; color: #c62828; }
.tct-slot { font-size: 11.5px; }
.tct-slot--empty { color: #5f6b76; font-style: italic; }
.tct-slot--green { color: #1e7b34; font-weight: 700; }
.tct-slot--red { color: #c62828; font-weight: 700; }
.tct-decision { font-weight: 400; color: #16324f; }
.tct-gauntlet { padding: 0 10px 8px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.tct-gauntlet-score { font-weight: 700; color: #16324f; flex-basis: 100%; }
.tct-tile { font-size: 11px; border: 1px dashed #e3e7eb; border-radius: 5px; padding: 3px 8px; color: #5f6b76; }
.tct-tile--blocked { border-style: solid; border-color: #1e7b34; color: #1e7b34; font-weight: 600; }
.tct-proved { border-top: 1px solid #e3e7eb; padding: 8px 10px; }
.tct-proved h5 { font-size: 9.5px; letter-spacing: 0.1em; color: #16324f; margin: 0 0 5px; }
.tct-proved-line { display: flex; gap: 6px; margin-bottom: 3px; }
.tct-mark-g { color: #1e7b34; font-weight: 800; }
.tct-mark-r { color: #c62828; font-weight: 800; }
.tct-say { margin-top: 5px; font-size: 11px; background: #fff8e6; border-radius: 5px; padding: 5px 8px; }
.tct-error, .tct-loading { padding: 12px; color: #5f6b76; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainDemoTrackTab.test.jsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDemoTrackTab.jsx demo_api_ui/src/components/TokenChainDemoTrackTab.css demo_api_ui/src/components/__tests__/TokenChainDemoTrackTab.test.jsx
git commit -m "feat(demo-track): live Demo Track tab component"
```

---

### Task 6: Wire the tab into TokenChainDisplay

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.jsx` — two insertions:
  1. Tab button: after the Trust tab `<button>` (the block at ~line 4891–4899 ending `Trust</button>`), inside the same `.tcd-tabs` div.
  2. Tab content: after the Trust content block — find `{tab === "trust" && (() => {` (~line 5181) and its closing `})()}`; insert immediately after it.
  3. Import at the top of the file with the other component imports.

**Interfaces:**
- Consumes: `<TokenChainDemoTrackTab />` from Task 5; existing `tab` / `setTab` state (`useState("current")` at ~line 4328).

- [ ] **Step 1: Add the import**

With the other imports at the top of `TokenChainDisplay.jsx`:

```js
import TokenChainDemoTrackTab from "./TokenChainDemoTrackTab";
```

- [ ] **Step 2: Add the tab button**

Immediately after the Trust `<button>…Trust</button>` element, inside `.tcd-tabs`:

```jsx
          <button
            type="button"
            className={`tcd-tab ${tab === "demo-track" ? "active" : ""}`}
            onClick={() => setTab("demo-track")}
            title="Guided Demo Track — live step tracker"
          >
            Demo Track
          </button>
```

- [ ] **Step 3: Add the tab content**

Immediately after the `{tab === "trust" && (() => { … })()}` block:

```jsx
        {tab === "demo-track" && <TokenChainDemoTrackTab />}
```

- [ ] **Step 4: Verify — unit tests + build**

Run: `cd demo_api_ui && npm run test:unit`
Expected: PASS (including the Task 5 tests; no existing TokenChainDisplay test regressions)

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.jsx
git commit -m "feat(demo-track): Demo Track tab wired into TokenChainDisplay"
```

---

### Task 7: Full verification gate

- [ ] **Step 1: Server suite**

Run: `cd demo_api_server && CI=true npm test -- --forceExit`
Expected: green. Known flake guard: if disjoint suites fail, re-run with `--maxWorkers=4` before treating as regression.

- [ ] **Step 2: UI suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: green.

- [ ] **Step 3: Topology guard (cross-service hygiene)**

Run: `npm run topology:verify` (repo root)
Expected: no drift (this plan adds no scopes/audiences, so any failure is pre-existing — report, don't fix here).

- [ ] **Step 4: Live smoke (manual, optional if stack not running)**

With the Docker stack up and signed in at `https://local.ping-devops.com:4000`: open the Token Chain panel → Demo Track tab; run the "show my balance" chip in the agent; within one poll (≤5s) the `delegated-access` green slot stamps `PERMIT ✓`. Run an attack sim from the use-case launcher; its gauntlet tile flips to blocked.

- [ ] **Step 5: Final commit + report**

Report the three result lines (server / UI / topology) with ✅ or ❌ per repo rules.

---

## Self-review notes

- Spec coverage (Plan A scope): track definition ✓ (Task 1), run ledger + matcher + persistence ✓ (Task 2), live observation ✓ (Task 3), API ✓ (Task 4), live tab with slots / gauntlet / proved cards ✓ (Tasks 5–6). Deliberately deferred to Plans B/C: standalone page + history UI, agent dropdown, chip injection, tab live-dot polish, per-step drill-down JSON.
- Known simplifications (documented in code/comments): PERMIT slots carry `decisionId: null` in Plan A; wildcard matches only on the active step; one observation may match the earliest eligible step when several steps share a tool — the active-step rule is the disambiguator.
- Type consistency: slot stamp `{ verdict, decisionId, via, at }` used identically in service, route response, and UI; `run.gauntlet[sim] = { blocked, status, errorCode, decisionId, at }` consistent between Task 2 and Task 5.

## Post-merge residuals (final whole-branch review 2026-08-03 — approved, all can-ride; carry into Plan B)

- Gauntlet sims that run the full pipeline can restamp `fine-grained-authz:red` via the fallback scan (overwrite semantics are by design; presenter's step-3 decision ID may change after the gauntlet). Consider scoping the fallback scan or freezing completed steps in Plan B.
- UI "N slots filled" counter counts orphaned slot keys from LMDB-hydrated runs after a future config rename (cosmetic).
- Spec surface-2 polish deferred: mini token-chain strips per run line, decision-ID link into token detail views, tab live-dot — Plan B/C.
- Untested: overwrite-on-reobservation path (3-line unconditional assignment); genuine LMDB hydrate-from-disk restart path.
