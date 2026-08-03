# Stage 0 Negative-Chip Parity — Rails + 24 Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Class A vertical carries banking's three deliberate-failure chips (wrong audience, cross-vertical DENY, bad scope) — and every one of the 24 new chips actually fires and actually denies, per the spec's "must produce an actual DENY, not a 502 and not a 200".

**Architecture:** Investigation (2026-08-03) proved the spec's "replicate bk-dpop" premise false: non-banking verticals render chips through `verticalSuggestionChips` (agentChrome.js), which drops `mode`/`tool`/`denyTool`, so cloned chips dead-end. The fix is a client-side rail, zero server changes: (1) carry `mode`/`tool`/`denyTool` through `verticalSuggestionChips`; (2) in the chip-click path, dispatch `mode:'direct'` negative chips by field — synthetic tools map to the vertical-agnostic attack-sim route (`test_wrong_audience` → sim `wrong-aud`, `test_wrong_scope` → sim `insufficient-scope`, both in the route's `VALID_SIMS`), and `denyTool` chips call the real foreign tool via `callMcpTool`, which the BFF preflight denies with HTTP 403 `mcp_authorization_denied` + decisionId (`mcpToolAuthorizationService.js:996-1009`) — the exact mechanism banking's education-panel `authz_deny` showcase already uses. Then 24 manifest entries ride the rail.

**Tech Stack:** UI: React 19 + vitest (never jest). Server: config-only changes (manifest.json × 8) + jest gate updates.

**Spec:** `docs/superpowers/specs/2026-08-02-intent-routing-and-p1az-authz-design.md` §"Negative-intent parity" (pairing table lines 576-586, verified live 2026-08-03: every target `featurePage.mcpTool` exists).

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. This plan's UI adds none.
- REGRESSION_GUARD invariants (stated, binding): banking's `ACTION_GROUPS`/`API_DIRECT_CHIPS` (agentActions.js) and all existing banking chips untouched; `verticalSuggestionChips` existing output fields (`id`, `label`, `desc`, `message`, `rfcs`, `hitlTrigger`, `challenge`) unchanged — new fields are additive; no changes to auth, token exchange, session, FAB/layout code.
- Worktree branch `worktree-stage0-negative-chips`; stage explicitly (`git add <file>`), never `git add -A`.
- UI tests: `cd demo_api_ui && npx vitest run <file>`; UI gate: `npm run build` must exit 0 (regression-guard step 5).
- Server tests from worktree: `cd demo_api_server && CI=true npx jest <files> --forceExit` (if "No tests found": the verify-ai-demo2 worktree override, keep `/tests/real/` ignored).
- After manifest changes run `npm run intents:gen` then `intents:check` (script: `demo_api_server/scripts/gen-intent-topology.js`); regenerate, never hand-edit generated files.
- The two synthetic sims are already valid: `VALID_SIMS` in `demo_api_server/routes/attackSimulator.js:19-30` contains `wrong-aud` and `insufficient-scope`. POST `/api/demo/attack-sim/run` body `{ sim }`.
- Banking is grandfathered: its three chips keep their exact current ids/messages/behavior.

## Interfaces (fixed by this plan)

- Chip shape addition (agentChrome → AIAgent): `{ mode?: string, tool?: string|null, denyTool?: string|null }` added to each `verticalSuggestionChips` entry.
- Sim mapping (AIAgent): `const NEGATIVE_SIM_BY_TOOL = { test_wrong_audience: 'wrong-aud', test_wrong_scope: 'insufficient-scope' }`.
- New manifest chip ids follow banking's naming: `<px>-dpop`, `<px>-deny`, `<px>-bad-scope` where `<px>` ∈ gv, hc, inv, mf, rt, sg, un, wf.

---

### Task 1: agentChrome — carry mode/tool/denyTool through verticalSuggestionChips

**Files:**
- Modify: `demo_api_ui/src/components/agentChrome.js` (the `chips10.map` in `verticalSuggestionChips`, ~line 95)
- Test: `demo_api_ui/src/components/__tests__/agentChrome.negativeChips.test.jsx` (create)

**Interfaces:**
- Produces: each chip object additionally carries `mode: c.mode || null`, `tool: c.tool || null`, `denyTool: c.denyTool || null`. Existing fields byte-identical.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/agentChrome.negativeChips.test.jsx
import { describe, it, expect } from 'vitest';
import { verticalSuggestionChips } from '../agentChrome';

const MANIFEST = {
  dashboard: {
    chips10: [
      { id: 'gv-direct', label: 'Permits', message: 'view my permits' },
      { id: 'gv-dpop', label: 'DPoP / replay defense', message: 'fire a token with the wrong audience at the gateway', mode: 'direct', tool: 'test_wrong_audience' },
      { id: 'gv-deny', label: 'Authz DENY', message: "show a patient's health record", mode: 'direct', denyTool: 'show_health_record' },
    ],
  },
};

describe('verticalSuggestionChips negative-chip fields', () => {
  it('carries mode, tool and denyTool through; nulls when absent', () => {
    const chips = verticalSuggestionChips(MANIFEST);
    expect(chips[0]).toMatchObject({ id: 'gv-direct', mode: null, tool: null, denyTool: null });
    expect(chips[1]).toMatchObject({ mode: 'direct', tool: 'test_wrong_audience', denyTool: null });
    expect(chips[2]).toMatchObject({ mode: 'direct', tool: null, denyTool: 'show_health_record' });
  });

  it('does not disturb existing fields', () => {
    const chips = verticalSuggestionChips(MANIFEST);
    expect(chips[0]).toMatchObject({ label: 'Permits', message: 'view my permits', desc: 'view my permits', hitlTrigger: false, challenge: null });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd demo_api_ui && npx vitest run src/components/__tests__/agentChrome.negativeChips.test.jsx`. Expected: FAIL (`mode` undefined).

- [ ] **Step 3: Implement** — inside the existing `chips10.map((c) => ({ ... }))` add three lines after `challenge`:

```js
    // Negative-chip rail: mode 'direct' + tool/denyTool drive client dispatch
    // (attack-sim for synthetic tools, real foreign-tool call for denyTool).
    mode: c.mode || null,
    tool: c.tool || null,
    denyTool: c.denyTool || null,
```

- [ ] **Step 4: Run to verify pass** — same command. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/agentChrome.js demo_api_ui/src/components/__tests__/agentChrome.negativeChips.test.jsx
git commit -m "feat(chips): carry mode/tool/denyTool through verticalSuggestionChips"
```

---

### Task 2: AIAgent — generic negative-chip dispatch

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` — the discovery/suggestion chip click handler (locate where a chip produced by `verticalSuggestionChips` currently sends `chip.message` into the NL pipeline; grep `verticalSuggestionChips(` usage and follow its `onClick`)
- Test: `demo_api_ui/src/components/__tests__/AIAgent.negativeChipDispatch.test.jsx` (create)

**Interfaces:**
- Consumes: Task 1's `mode`/`tool`/`denyTool` chip fields; existing `callMcpTool(toolName, params, opts)` and the existing attack-sim POST pattern (`AIAgent.js:3600-3639` posts `/api/demo/attack-sim/run` with `{ sim }` via apiClient — reuse the same call/render helper, do NOT duplicate the banking `runAction` cases).
- Produces: new module `demo_api_ui/src/components/negativeChipDispatch.js` (see Step 1/3) exporting `NEGATIVE_SIM_BY_TOOL = { test_wrong_audience: 'wrong-aud', test_wrong_scope: 'insufficient-scope' }`, `isNegativeChip(chip)` (true only for `mode === 'direct'` with a mapped synthetic `tool` or a `denyTool`), and `dispatchNegativeChip(chip, { vertical, callMcpTool, postSim, say })`. Behavior contract: echo the chip message first (`say('user', chip.message)`); synthetic-tool chips → `postSim(NEGATIVE_SIM_BY_TOOL[chip.tool], { vertical, useCaseId: chip.useCaseId || null, sourceLabel: chip.label })`; denyTool chips → `callMcpTool(chip.denyTool, {}, { vertical, useCaseId: chip.useCaseId || null })`, treating HTTP 403 / `error: 'mcp_authorization_denied'` (also accept `mcp_scope_denied`) as SUCCESS-of-the-control, rendering `Denied as designed — <error code>, decision <decisionId>`; a 2xx renders `⚠️ Expected a DENY but the call succeeded — this control is broken`; network/5xx falls through to the normal failure sentence. Response-shape reference: the education-panel `authz_deny` branch (`AIAgent.js:1208-1257`) — parameterized, never hardcoded. AIAgent supplies `postSim` by extracting a thin wrapper around its EXISTING attack-sim POST + verdict rendering (extract, don't fork the banking `runAction` cases).

- [ ] **Step 1: Write the failing test** — mock `apiClient`; render nothing heavy: test the two helpers + the dispatch branch through the exported component is impractical (AIAgent is huge), so structure the rail as a small exported module instead: create `demo_api_ui/src/components/negativeChipDispatch.js` exporting `NEGATIVE_SIM_BY_TOOL`, `isNegativeChip(chip)`, `dispatchNegativeChip(chip, { vertical, callMcpTool, postSim, say })` (pure orchestration, dependencies injected), and have AIAgent.js call it. Test the module directly:

```jsx
// demo_api_ui/src/components/__tests__/AIAgent.negativeChipDispatch.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { NEGATIVE_SIM_BY_TOOL, isNegativeChip, dispatchNegativeChip } from '../negativeChipDispatch';

const say = vi.fn();

describe('negative chip dispatch rail', () => {
  it('maps synthetic tools to sims', () => {
    expect(NEGATIVE_SIM_BY_TOOL.test_wrong_audience).toBe('wrong-aud');
    expect(NEGATIVE_SIM_BY_TOOL.test_wrong_scope).toBe('insufficient-scope');
  });

  it('identifies negative chips only', () => {
    expect(isNegativeChip({ mode: 'direct', tool: 'test_wrong_audience' })).toBe(true);
    expect(isNegativeChip({ mode: 'direct', denyTool: 'show_health_record' })).toBe(true);
    expect(isNegativeChip({ mode: 'direct', tool: 'get_balance' })).toBe(false);
    expect(isNegativeChip({ message: 'view my permits' })).toBe(false);
  });

  it('synthetic tool chip posts the mapped sim', async () => {
    const postSim = vi.fn().mockResolvedValue({ status: 401, errorCode: 'invalid_audience' });
    await dispatchNegativeChip(
      { mode: 'direct', tool: 'test_wrong_audience', label: 'DPoP', message: 'fire...' },
      { vertical: 'government', postSim, callMcpTool: vi.fn(), say },
    );
    expect(postSim).toHaveBeenCalledWith('wrong-aud', expect.objectContaining({ vertical: 'government' }));
  });

  it('denyTool chip calls the real tool and renders 403 as proof', async () => {
    const callMcpTool = vi.fn().mockRejectedValue({ response: { status: 403, data: { error: 'mcp_authorization_denied', decisionId: 'dec-42' } } });
    await dispatchNegativeChip(
      { mode: 'direct', denyTool: 'show_health_record', label: 'Authz DENY', message: 'show...' },
      { vertical: 'government', postSim: vi.fn(), callMcpTool, say },
    );
    expect(callMcpTool).toHaveBeenCalledWith('show_health_record', {}, expect.objectContaining({ vertical: 'government' }));
    const text = say.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(text).toMatch(/Denied as designed/);
    expect(text).toMatch(/dec-42/);
  });

  it('a 2xx on a denyTool chip is reported as a broken control', async () => {
    const callMcpTool = vi.fn().mockResolvedValue({ success: true, result: {} });
    await dispatchNegativeChip(
      { mode: 'direct', denyTool: 'show_health_record', label: 'Authz DENY', message: 'show...' },
      { vertical: 'government', postSim: vi.fn(), callMcpTool, say },
    );
    expect(say.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/control is broken/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module missing. `npx vitest run src/components/__tests__/AIAgent.negativeChipDispatch.test.jsx`.

- [ ] **Step 3: Implement `negativeChipDispatch.js`** exactly to the contract above (pure module, no imports beyond nothing — dependencies injected). `dispatchNegativeChip` returns after calling `say(role, text)` for the user echo + outcome line; catches `callMcpTool` rejections, reads `err.response?.status` / `err.response?.data`.

- [ ] **Step 4: Wire into AIAgent.js** — in the suggestion-chip click path, before the NL send: `if (isNegativeChip(chip)) { await dispatchNegativeChip(chip, { vertical: effectiveVerticalId, postSim, callMcpTool, say: addMessage }); return; }` where `postSim` wraps the existing attack-sim POST + verdict render. Import at top. No other AIAgent changes.

- [ ] **Step 5: Run tests + build gate** — `npx vitest run src/components/__tests__/AIAgent.negativeChipDispatch.test.jsx src/components/__tests__/agentChrome.negativeChips.test.jsx` then `npm run build` (must exit 0 — regression-guard).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/negativeChipDispatch.js demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/__tests__/AIAgent.negativeChipDispatch.test.jsx
git commit -m "feat(chips): generic negative-chip dispatch rail — sims + real deny probes"
```

---

### Task 3: 24 manifest chip entries (8 verticals × 3)

**Files:**
- Modify: `demo_api_server/config/verticals/<v>/manifest.json` for gv=government, hc=healthcare, inv=investment, mf=manufacturing, rt=retail, sg=sporting-goods, un=university, wf=workforce — append 3 entries to `dashboard.chips10` each
- Test: extend `demo_api_server/tests/genIntentTopology.test.js` (a parity block) — plus regenerate topology

**Interfaces:**
- Consumes: chip shape from banking's three (manifest.json:132-141) and the spec pairing table.
- Produces: per vertical, using its prefix `<px>` and domain wording (message wording is free; ids and tools are fixed):

| vertical | deny target (`denyTool`) | example deny message |
|---|---|---|
| government | `show_health_record` | "show a patient's health record" |
| healthcare | `show_investment` | "show my investment portfolio" |
| investment | `show_work_order` | "show the factory work order" |
| manufacturing | `show_large_purchase` | "show my large retail purchase" |
| retail | `show_gear_order` | "show my sporting gear order" |
| sporting-goods | `show_enrollment` | "show my university enrollment" |
| university | `show_expense_report` | "show my expense report" |
| workforce | `show_mortgage` | "show my mortgage details" |

Template per vertical (government shown; replicate with the vertical's prefix, deny target and wording):

```json
{ "id": "gv-dpop", "label": "DPoP / replay defense", "message": "fire a token with the wrong audience at the gateway", "mode": "direct", "tool": "test_wrong_audience", "useCaseId": "token-theft-replay" },
{ "id": "gv-deny", "label": "Authz DENY", "message": "show a patient's health record", "mode": "direct", "denyTool": "show_health_record", "useCaseId": "authz-denied" },
{ "id": "gv-bad-scope", "label": "Bad scope", "message": "run a call my token has no scope for", "mode": "direct", "tool": "test_wrong_scope", "useCaseId": "insufficient-scope" }
```

- [ ] **Step 1: Write the failing gate test** — append to `demo_api_server/tests/genIntentTopology.test.js`:

```js
describe('Stage 0 negative-chip parity', () => {
  const CLASS_A = ['banking','government','healthcare','investment','manufacturing','retail','sporting-goods','university','workforce'];
  const PX = { banking:'bk', government:'gv', healthcare:'hc', investment:'inv', manufacturing:'mf', retail:'rt', 'sporting-goods':'sg', university:'un', workforce:'wf' };
  const DENY_TARGET = { banking:'show_health_record', government:'show_health_record', healthcare:'show_investment', investment:'show_work_order', manufacturing:'show_large_purchase', retail:'show_gear_order', 'sporting-goods':'show_enrollment', university:'show_expense_report', workforce:'show_mortgage' };

  test.each(CLASS_A)('%s declares all three negative chips with correct tools', (v) => {
    const manifest = require(`../config/verticals/${v}/manifest.json`);
    const chips = manifest.dashboard.chips10;
    const px = PX[v];
    const dpop = chips.find((c) => c.id === `${px}-dpop`);
    const deny = chips.find((c) => c.id === `${px}-deny`);
    const bad = chips.find((c) => c.id === `${px}-bad-scope`);
    expect(dpop).toMatchObject({ mode: 'direct', tool: 'test_wrong_audience' });
    expect(deny.denyTool).toBe(DENY_TARGET[v]);
    expect(deny.tool).toBeUndefined();
    expect(bad).toMatchObject({ tool: 'test_wrong_scope' });
    for (const c of [dpop, deny, bad]) expect(typeof c.message).toBe('string');
  });
});
```

(Banking passes already — `bk-bad-scope` is mode `both`, so the assertion deliberately checks only `tool`, not `mode`, for the bad-scope chip.)

- [ ] **Step 2: Run to verify failure** — `cd demo_api_server && CI=true npx jest tests/genIntentTopology.test.js --forceExit`. Expected: 8 failures (banking passes).

- [ ] **Step 3: Add the 24 entries** — append to each of the 8 manifests, message wording in each vertical's domain voice. Do not touch any existing entry, and do not touch the `groups` section of any manifest (another agent owns group-policy work there today).

- [ ] **Step 4: Regenerate + full gates**

```bash
cd demo_api_server && npm run intents:gen && npm run intents:check
CI=true npx jest tests/genIntentTopology.test.js tests/chipSchemaContract.test.js tests/useCases.primaryTool.test.js tests/useCases.verticalChipCoverage.test.js --forceExit
```

All green. If `chipSchemaContract.test.js` rejects an unknown field, extend its schema additively for `mode`/`tool`/`denyTool` on non-banking verticals (banking's own chips already use these fields — expect it to pass unchanged).

- [ ] **Step 5: Commit** (manifests + regenerated topology + test)

```bash
git add demo_api_server/config/verticals/*/manifest.json demo_api_server/tests/genIntentTopology.test.js demo_api_server/config/intent-topology.json 2>/dev/null || true
git status --short   # stage ONLY intended files; never add -A
git commit -m "feat(chips): 24 negative chips — wrong-aud, cross-vertical deny, bad scope in all Class A verticals"
```

(If `intents:gen` writes the topology elsewhere, stage that path; `git status --short` reveals it.)

---

### Task 4: Verification gate + regression log

**Files:**
- Modify: `REGRESSION_PLAN.md` §4 (one reverse-chron entry)

- [ ] **Step 1: Full UI gate** — `cd demo_api_ui && npm run test:unit && npm run build`. Both must pass; build exit 0 is the regression-guard gate. Note the 5 pre-existing vitest failures were fixed on main by #1337 — expect a clean run; if anything fails, it must be new and must be fixed.

- [ ] **Step 2: Server suites** — `cd demo_api_server && CI=true npm test -- --forceExit` (worktree override if needed).

- [ ] **Step 3: Live smoke, 2 verticals** (stack must be running; UI serves main checkout so this runs AFTER merge+deploy — record it as a post-merge step in the PR body, do not block the branch on it):
  - government `gv-deny` click → chat shows "Denied as designed — mcp_authorization_denied, decision <id>" with a non-null decision id.
  - retail `rt-dpop` click → attack-sim verdict rendered BLOCKED (and Demo Track gauntlet observes `wrong-aud` — free integration with #1319).

- [ ] **Step 4: REGRESSION_PLAN §4 entry** — Files changed / What was broken (24 negative cells missing; cloned chips would dead-end — renderer dropped tool fields) / What was fixed (rail + 24 chips) / Do not break (`verticalSuggestionChips` additive fields; `negativeChipDispatch` treats 403 as control-success) / Verify (the two vitest files + gate test).

- [ ] **Step 5: Commit + paste evidence lines in the final report.**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): log negative-chip rail + Stage 0 parity fill"
```

---

## Deliberately out of scope

- Banking's dead `bk-dpop`/`bk-deny` manifest-render paths (grandfathered; live demo uses agentActions/education panel).
- `admin_get_all_users` ghost target of banking's `test_wrong_scope` (banking-coupled; new chips use the sim instead).
- Step-verification ledger entries for the three useCaseIds (they collide with unrelated UC5/UC6/UC12 entries — reconciling that taxonomy is its own task).
- The other Stage 0 gaps: `llm` chips (retail, sporting-goods), `groups` blocks (owned by the group-policy agent today), tiers, a2a intents.
