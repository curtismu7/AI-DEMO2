# Demo Step Verification — Banking (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable harness that runs every banking demo step (chip and free-text triggers, heuristic and LLM-only modes) and records a machine-written PASS/FAIL verdict against five checks — server error, parse error, LLM error, right response, right gate behavior (HITL/STEP_UP/DENY) — closing the gap where a hallucinated value or a mis-fired gate currently passes every existing test in the repo.

**Architecture:** A shared ledger module (`stepVerificationLedger.js`) writes one JSON file per (vertical, useCaseId, triggerType, mode) to `demo_api_server/data/step-verification/`. Two test layers write to it: a Jest suite (routing + gate-decision logic, mocked downstream, fast) and a Playwright real-login spec (live HTTP round trip against a running stack, catches actual server/LLM errors and grounds values against `/api/accounts/my`). A generator script renders the ledger into `docs/use-cases/step-verification-report.md`, auto-regenerated the same way `audit-table.md` already is. A standalone promptfoo config grades LLM narration for hallucination on a representative sample, independent of the pass/fail gate.

**Tech Stack:** Node.js, Jest 29 (`demo_api_server`), Playwright (`demo_api_ui`, `*.real.spec.js` convention), promptfoo (new dependency, MIT-licensed, no cloud account — points at the existing local `demo_llm_proxy` on `:8090`).

## Global Constraints

- **Scope: banking vertical only.** Every file/test in this plan is scoped to `vertical === 'banking'`. Do not add other verticals — that is Phase 2, a separate plan.
- **Ledger entries are machine-written only.** Never hand-edit a file under `demo_api_server/data/step-verification/` — every entry must come from a test run, or it reintroduces the stale-checkbox problem this design exists to avoid.
- **Worktree Jest gotcha:** this work happens inside a git worktree under `.claude/worktrees/`. `demo_api_server/jest.config.js` has `testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/', ...]` — any new test file's absolute path contains `.claude/worktrees/demo-step-verification-plan/...` and Jest will silently skip it under the default config. **Every Jest run in this plan must pass `--testPathIgnorePatterns='/node_modules/'` on the command line** to override the config array for that invocation (confirmed working pattern from the `verify-ai-demo2` skill), combined with a `--testPathPattern` or explicit file path so it doesn't sweep unrelated suites.
- **Existing production code is not modified.** `agentPreflightService.js`, `nlIntentParser.js`, `useCases.js`, etc. are read-only inputs to this plan — every task adds new files or small additive script/package.json lines only.
- **Ground truth is never a literal — for live-pipeline checks (Tasks 2 and 4).** Any check against a dollar amount in those two tasks must read it from the live tool payload or `/api/accounts/my` at test-run time (`runtimeData.json` is a mutable runtime store, not a static fixture — confirmed by its `createdAt` timestamp moving on server restart). **Carve-out for Task 5:** its promptfoo config is an intentionally isolated microbenchmark of LLM narration behavior, not a live-grounding check — its fixture dollar amounts are synthetic, fixed inputs by design, not a claim about live account state, so this rule does not apply to it.
- **Not a CI gate.** `check-step-verification.js` and the new npm scripts are additive to `use-cases:check`/`use-cases:gen` but follow `check-goldens.js`'s existing precedent: missing/stale coverage warns, it does not fail the build. Only malformed/orphaned ledger entries fail.

---

### Task 1: Step-verification ledger module

**Files:**
- Create: `demo_api_server/services/stepVerificationLedger.js`
- Test: `demo_api_server/tests/stepVerificationLedger.test.js`

**Interfaces:**
- Produces: `writeLedgerEntry(entry)` — `entry: {vertical, useCaseId, triggerType:'chip'|'prompt', mode:'heuristic'|'llamacpp'|'helix', status:'PASS'|'FAIL', errorClass:string|null, primaryTool:string|null, checkedAt:string, verifiedBy?:string}` → returns the absolute file path written. Throws if a required field (`vertical, useCaseId, triggerType, mode, status, checkedAt`) is missing.
- Produces: `readLedger(vertical)` → `entry[]`, `[]` if the vertical has no ledger directory yet.
- Produces: `ROOT` — absolute path constant to `demo_api_server/data/step-verification`, re-used by Tasks 2, 3, 4.

- [ ] **Step 1: Write the module**

```js
// demo_api_server/services/stepVerificationLedger.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'data', 'step-verification');

/**
 * @typedef {Object} LedgerEntry
 * @property {string} vertical
 * @property {string} useCaseId
 * @property {'chip'|'prompt'} triggerType
 * @property {'heuristic'|'llamacpp'|'helix'} mode
 * @property {'PASS'|'FAIL'} status
 * @property {string|null} errorClass one of 'server_error'|'parse_error'|'llm_error'|'wrong_response'|'wrong_gate'|null
 * @property {string|null} primaryTool
 * @property {string} checkedAt ISO timestamp
 * @property {string} [verifiedBy] optional note pointing at the test file that proved this, when no new dispatch was run
 */

const REQUIRED_FIELDS = ['vertical', 'useCaseId', 'triggerType', 'mode', 'status', 'checkedAt'];

/** @param {LedgerEntry} entry @returns {string} absolute path written */
function writeLedgerEntry(entry) {
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] == null || entry[field] === '') {
      throw new Error(`writeLedgerEntry: missing required field "${field}"`);
    }
  }
  const dir = path.join(ROOT, entry.vertical);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${entry.useCaseId}.${entry.triggerType}.${entry.mode}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return file;
}

/** @param {string} vertical @returns {LedgerEntry[]} */
function readLedger(vertical) {
  const dir = path.join(ROOT, vertical);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

module.exports = { writeLedgerEntry, readLedger, ROOT };
```

- [ ] **Step 2: Write the failing test first (prove the required-field guard is live)**

```js
// demo_api_server/tests/stepVerificationLedger.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { writeLedgerEntry, readLedger, ROOT } = require('../services/stepVerificationLedger');

describe('stepVerificationLedger', () => {
  const vertical = 'banking';
  const testFile = path.join(ROOT, vertical, 'UC-TEST.chip.heuristic.json');

  afterEach(() => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  test('throws when a required field is missing', () => {
    expect(() => writeLedgerEntry({ vertical, useCaseId: 'UC-TEST' })).toThrow(/missing required field/);
  });

  test('writes a well-formed entry to the expected deterministic path', () => {
    const written = writeLedgerEntry({
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(written).toBe(testFile);
    const saved = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(saved.status).toBe('PASS');
  });

  test('readLedger returns every entry written for a vertical', () => {
    writeLedgerEntry({
      vertical,
      useCaseId: 'UC-TEST',
      triggerType: 'chip',
      mode: 'heuristic',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: '2026-07-22T00:00:00.000Z',
    });
    const entries = readLedger(vertical);
    expect(entries.some((e) => e.useCaseId === 'UC-TEST')).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, confirm all three pass on first run (the module already exists from Step 1 — this run is the "prove the test is live" check: temporarily rename `REQUIRED_FIELDS` to `REQUIRED_FIELDSX` in the module, re-run, confirm the first test's `toThrow` assertion now fails differently / the second test throws unexpectedly — then revert the rename and re-run to confirm green.)**

Run: `cd demo_api_server && npx jest tests/stepVerificationLedger.test.js --testPathIgnorePatterns='/node_modules/' --forceExit --verbose`
Expected after the deliberate typo: FAIL (module throws `REQUIRED_FIELDSX is not defined` or similar on require)
Expected after reverting: 3 passed, 0 failed

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/services/stepVerificationLedger.js demo_api_server/tests/stepVerificationLedger.test.js
git commit -m "feat(step-verification): add ledger read/write module"
```

---

### Task 2: Banking chip routing + amount-gate decision tests (checks 2 and 5, heuristic mode)

**Files:**
- Create: `demo_api_server/tests/helpers/actionToTool.js`
- Modify: `demo_api_server/tests/useCases.primaryTool.test.js` (replace its local `ACTION_TO_TOOL` const with a require of the new helper — same values, one source of truth)
- Create: `demo_api_server/tests/stepVerification.banking.test.js`

**Interfaces:**
- Consumes: `writeLedgerEntry` from Task 1 (`../services/stepVerificationLedger`); `ACTION_TO_TOOL` from `./helpers/actionToTool.js` (this task's Step 1, below).
- **Do not** `require()` a `*.test.js` file from another test file to share code — Jest's `describe`/`test` are bound to whichever test file is currently executing, not to the file that textually contains the call, so requiring one test file from another re-registers (and re-runs) its entire suite inside the requiring file. `ACTION_TO_TOOL` must live in a plain module outside the `*.test.js` naming pattern.
- Consumes (existing, unmodified): `USE_CASES`, `resolveUseCase` from `../config/useCases.js`; `parseHeuristic(text, vertical, ctx, options)`, `resolveVerticalCtx(vertical)` from `../services/nlIntentParser`; `evaluate({req, tool, params, hitlChallengeId})` from `../services/agentPreflightService`, which internally calls `evaluateMcpFirstToolGate({req, tool, agentToken, userSub, userAcr, toolParams, hitlChallengeId})` from `../services/mcpToolAuthorizationService` — this task mocks that call.
- Produces: one ledger file per banking `works`-maturity chip use case (routing) plus one per `{UC6, UC7, UC8}` (gate decision) plus reference entries for `{UC22, UC27}`.

**Design notes (why this scope, not more):**
- Routing check (2) runs against every `works`-maturity banking chip with a stored `primaryTool` — this is safe for ANY chip because it only asserts "does the trigger text route to the declared tool," independent of gate outcome.
- Gate-decision check (5) is scoped to exactly `UC6` (DENY, canonical $2500 tier), `UC7` (STEP_UP, canonical $600 tier), `UC8` (HITL, canonical $300 tier) — these three share the identical amount-gated mechanism confirmed in `agentPreflightService.js` (`errCode === 'mcp_step_up_required' → STEP_UP`, `'mcp_hitl_required' → HITL`, otherwise `→ DENY`), so a single amount-keyed mock of `evaluateMcpFirstToolGate` is a faithful model of the real gate.
- `UC27`'s chip trigger text is byte-identical to `UC7`'s ("transfer $600 from checking to savings") but tests a different mechanism entirely — a forged `consentGiven`/fake `hitlChallengeId` bypass attempt, not a plain amount evaluation. That mechanism is already fully covered by `demo_api_server/tests/hitlBypass.regression.test.js` (referenced directly in UC27's own `codeRefs`). Re-testing it here with the simple amount-mock would silently misreport it (the mock has no concept of a bypass attempt). This task records UC27 as a **reference-only** ledger entry pointing at that existing suite instead of duplicating it.
- `UC22` (CIBA) is `maturity: 'flag:ff_ciba'` — excluded from the `works`-only routing sweep, and its mechanism (amount-independent, out-of-band `bc-authorize` polling) is not modeled by the amount-mock either. Already covered by `demo_api_server/src/__tests__/{ciba,cibaService,cibaSimulatedService}.test.js`. Recorded the same way, by reference.

- [ ] **Step 1: Extract `ACTION_TO_TOOL` into a shared helper module**

Create `demo_api_server/tests/helpers/actionToTool.js`:

```js
'use strict';

/**
 * Heuristic ACTION -> dispatched TOOL where they differ. Vertical plugin actions
 * ARE their tool names (identity fallback). Shared by useCases.primaryTool.test.js
 * and stepVerification.banking.test.js — one source of truth, not two copies.
 */
const ACTION_TO_TOOL = {
  transfer: 'create_transfer',
  transfer_600_test: 'create_transfer',
  deposit: 'create_deposit',
  withdraw: 'create_withdrawal',
  balance: 'get_account_balance',
  accounts: 'get_my_accounts',
  transactions: 'get_my_transactions',
  branch_hours: 'get_branch_hours',
};

module.exports = { ACTION_TO_TOOL };
```

In `demo_api_server/tests/useCases.primaryTool.test.js`, replace its local declaration:
```js
const ACTION_TO_TOOL = {
  transfer: 'create_transfer',
  transfer_600_test: 'create_transfer',
  deposit: 'create_deposit',
  withdraw: 'create_withdrawal',
  balance: 'get_account_balance',
  accounts: 'get_my_accounts',
  transactions: 'get_my_transactions',
  branch_hours: 'get_branch_hours',
};
```
with:
```js
const { ACTION_TO_TOOL } = require('./helpers/actionToTool');
```
(same comment block above it can stay, or move into the new helper file — either is fine, no behavior change either way.)

Run the existing suite to confirm this is a no-op refactor:
`cd demo_api_server && npx jest tests/useCases.primaryTool.test.js --testPathIgnorePatterns='/node_modules/' --forceExit --verbose`
Expected: identical pass/fail outcome to before this change (this repo has one pre-existing, unrelated failure here — `chip dollar amounts are canonical threshold tiers` — do not attempt to fix it, it is out of scope for this plan; confirm no *new* failures appeared and the routing `test.each` cases still pass).

- [ ] **Step 2: Write the test file**

```js
// demo_api_server/tests/stepVerification.banking.test.js
'use strict';

/**
 * Step verification — banking, heuristic mode.
 * Writes one ledger entry per case to
 * demo_api_server/data/step-verification/banking/<useCaseId>.<triggerType>.<mode>.json
 *
 * Check 2 (parse/route): every works-maturity banking chip routes to its own
 * stored primaryTool.
 * Check 5 (gate decision): UC6/UC7/UC8's amount-gated transfer resolves to the
 * DENY/STEP_UP/HITL decision agentPreflightService.evaluate() actually returns
 * for that amount tier.
 * UC22 (CIBA) and UC27 (HITL bypass attempt) are recorded by reference — see
 * the design notes in the implementation plan for why they are not
 * re-dispatched here.
 */

const { USE_CASES, resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');

const _cfg = { ff_authorize_fail_open: 'true' };
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => _cfg[k] ?? null),
  getEffective: jest.fn((k) => _cfg[k] ?? null),
}));

jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
    token: 'fake-token',
    userSub: 'user-sub',
    tokenEvents: [],
  })),
  decodeJwtClaims: jest.fn(() => ({ claims: { sub: 'user-sub' } })),
}));

jest.mock('../services/hitlServiceClient', () => ({
  createChallenge: jest.fn(async () => ({ challengeId: 'ch-test-001', expiresAt: '2099-01-01T00:00:00Z' })),
  getChallengeStatus: jest.fn(async () => {
    const err = new Error('not found');
    err.status = 404;
    throw err;
  }),
  verifyHitlReceipt: jest.fn(() => ({ ok: false, message: 'not approved' })),
}));

// Faithful model of the real gate: agentPreflightService.js branches on
// errCode 'mcp_step_up_required' -> STEP_UP, 'mcp_hitl_required' -> HITL,
// any other block -> DENY. Thresholds match UC7's match:{amountMin:500,
// amountMax:2000} and UC8's match:{amountMin:0.01,amountMax:499.99}.
jest.mock('../services/mcpToolAuthorizationService', () => ({
  evaluateMcpFirstToolGate: jest.fn(async ({ toolParams }) => {
    const amount = toolParams && toolParams.amount;
    if (typeof amount !== 'number') return { ran: false };
    if (amount >= 2000) return { ran: true, block: { body: { error: 'mcp_denied' } } };
    if (amount >= 500) return { ran: true, block: { body: { error: 'mcp_step_up_required' } } };
    return { ran: true, block: { body: { error: 'mcp_hitl_required' } } };
  }),
}));

const { evaluate } = require('../services/agentPreflightService');
const { ACTION_TO_TOOL } = require('./helpers/actionToTool');

const fakeReq = () => ({
  session: { user: { role: 'user', acr: 'urn:acme:Bronze', email: 'test@example.com' } },
  correlationId: 'corr-step-verification-banking',
});

const A2A_UNROUTABLE = /specialist/i;

/** Every works-maturity banking chip with a stored primaryTool. */
function bankingWorksChipCases() {
  const out = [];
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, 'banking') || u;
    if (uc.maturity !== 'works') continue;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text || A2A_UNROUTABLE.test(t.text)) continue;
    if (!uc.primaryTool) continue;
    out.push({ id: uc.id, text: t.text, primaryTool: uc.primaryTool });
  }
  return out;
}

describe('step verification — banking chip routing (check 2: parse/route)', () => {
  const cases = bankingWorksChipCases();

  test('at least one works-maturity banking chip is covered', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases.map((c) => [c.id, c]))('%s: chip routes to its stored primaryTool', (_id, c) => {
    const ctx = resolveVerticalCtx('banking');
    const parsed = parseHeuristic(c.text, 'banking', ctx, {});
    const action = parsed ? (parsed.banking?.action ?? parsed.action ?? null) : null;
    const tool = ACTION_TO_TOOL[action] || action;

    const status = tool === c.primaryTool ? 'PASS' : 'FAIL';
    const errorClass = status === 'FAIL' ? (action ? 'wrong_response' : 'parse_error') : null;

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: c.id,
      triggerType: 'chip',
      mode: 'heuristic',
      status,
      errorClass,
      primaryTool: c.primaryTool,
      checkedAt: new Date().toISOString(),
    });

    expect(tool).toBe(c.primaryTool);
  });
});

describe('step verification — banking amount-gated decisions (check 5)', () => {
  test.each([
    ['UC6', 2500, 'DENY'],
    ['UC7', 600, 'STEP_UP'],
    ['UC8', 300, 'HITL'],
  ])('%s: $%i transfer resolves to decision %s', async (id, amount, expectedDecision) => {
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: { amount } });
    const status = result.decision === expectedDecision ? 'PASS' : 'FAIL';

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: id,
      triggerType: 'chip',
      mode: 'heuristic',
      status,
      errorClass: status === 'FAIL' ? 'wrong_gate' : null,
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
    });

    expect(result.decision).toBe(expectedDecision);
  });
});

describe('step verification — reference-only banking use cases', () => {
  const REFERENCE_ONLY = [
    {
      id: 'UC22',
      primaryTool: 'create_transfer',
      verifiedBy:
        'demo_api_server/src/__tests__/ciba.test.js, cibaService.test.js, cibaSimulatedService.test.js',
    },
    {
      id: 'UC27',
      primaryTool: 'create_transfer',
      verifiedBy: 'demo_api_server/tests/hitlBypass.regression.test.js',
    },
  ];

  test.each(REFERENCE_ONLY.map((r) => [r.id, r]))(
    '%s: gate behavior already proven by an existing suite',
    (_id, r) => {
      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: r.id,
        triggerType: 'chip',
        mode: 'heuristic',
        status: 'PASS',
        errorClass: null,
        primaryTool: r.primaryTool,
        checkedAt: new Date().toISOString(),
        verifiedBy: r.verifiedBy,
      });
      expect(r.verifiedBy).toBeTruthy();
    },
  );
});
```

- [ ] **Step 3: Run it once, confirm it's live (deliberately break one expected value)**

Temporarily change the UC8 case's expected decision from `'HITL'` to `'STEP_UP'` in the `test.each` table.

Run: `cd demo_api_server && npx jest tests/stepVerification.banking.test.js --testPathIgnorePatterns='/node_modules/' --forceExit --verbose`
Expected: FAIL — `UC8: $300 transfer resolves to decision STEP_UP` fails with `expected 'STEP_UP', received 'HITL'`

Revert the change back to `'HITL'`.

- [ ] **Step 4: Run it again, confirm it passes**

Run: `cd demo_api_server && npx jest tests/stepVerification.banking.test.js --testPathIgnorePatterns='/node_modules/' --forceExit --verbose`
Expected: all tests pass (exact count depends on how many `works`-maturity banking chips exist today — verify the count is `>= 15` given the audit table lists 20 `works` banking-track entries across foundations/controls/hitl/attacks, some of which are non-chip/no-primaryTool and correctly excluded by the filter).

- [ ] **Step 5: Inspect the ledger output**

Run: `ls demo_api_server/data/step-verification/banking/`
Expected: one `.json` file per case (e.g. `UC1.chip.heuristic.json`, `UC6.chip.heuristic.json`, `UC22.chip.heuristic.json`, ...), each with `status: "PASS"`.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/tests/helpers/actionToTool.js demo_api_server/tests/useCases.primaryTool.test.js demo_api_server/tests/stepVerification.banking.test.js demo_api_server/data/step-verification/
git commit -m "refactor(tests): share ACTION_TO_TOOL; add banking chip routing + gate-decision suite"
```

---

### Task 3: Ledger check gate + auto-generated report

**Files:**
- Create: `scripts/check-step-verification.js`
- Create: `scripts/gen-step-verification-report.js`
- Modify: `demo_api_server/package.json` (add 3 scripts, append to 2 existing composite scripts)

**Interfaces:**
- Consumes: ledger files under `demo_api_server/data/step-verification/` (Task 1/2's output), `USE_CASES` from `../demo_api_server/config/useCases.js`.
- Produces: `docs/use-cases/step-verification-report.md` (auto-generated, mirrors `audit-table.md`'s generate/check contract).

- [ ] **Step 1: Write `scripts/check-step-verification.js`**

```js
#!/usr/bin/env node
'use strict';
/**
 * check-step-verification.js — drift/staleness gate for the step-verification
 * ledger (demo_api_server/data/step-verification/<vertical>/<useCaseId>.<triggerType>.<mode>.json).
 *
 * Rules (mirrors check-goldens.js):
 *   - ORPHAN (fail): a ledger entry's useCaseId no longer exists in the catalog.
 *   - MALFORMED (fail): missing required fields.
 *   - STALE (warn only): checkedAt older than MAX_AGE_DAYS.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_ROOT = path.join(ROOT, 'demo_api_server', 'data', 'step-verification');
const REQUIRED = ['vertical', 'useCaseId', 'triggerType', 'mode', 'status', 'checkedAt'];
const MAX_AGE_DAYS = Number(process.env.STEP_VERIFICATION_MAX_AGE_DAYS || 30);

function catalogUseCaseIds() {
  const { USE_CASES } = require(path.join(ROOT, 'demo_api_server', 'config', 'useCases.js'));
  return new Set(USE_CASES.map((u) => u.id));
}

function checkStepVerification() {
  const failures = [];
  const warnings = [];
  let oldestDays = 0;
  const ids = catalogUseCaseIds();
  let total = 0;

  if (fs.existsSync(LEDGER_ROOT)) {
    for (const vertical of fs.readdirSync(LEDGER_ROOT)) {
      const dir = path.join(LEDGER_ROOT, vertical);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        total++;
        const key = `${vertical}/${f}`;
        let entry;
        try {
          entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        } catch (e) {
          failures.push(`[malformed] ${key}: ${e.message}`);
          continue;
        }
        for (const field of REQUIRED) {
          if (entry[field] == null || entry[field] === '') failures.push(`[malformed] ${key}: missing "${field}"`);
        }
        if (entry.useCaseId && !ids.has(entry.useCaseId)) {
          failures.push(`[orphan] ${key}: useCaseId "${entry.useCaseId}" no longer in useCases.js — delete or fix`);
        }
        const days = (Date.now() - Date.parse(entry.checkedAt)) / 86400000;
        if (Number.isFinite(days)) {
          oldestDays = Math.max(oldestDays, Math.floor(days));
          if (days > MAX_AGE_DAYS) {
            warnings.push(`[age] ${key}: checked ${Math.floor(days)}d ago (> ${MAX_AGE_DAYS}d) — re-run before the next demo`);
          }
        }
      }
    }
  }

  return { failures, warnings, oldestDays, total };
}

if (require.main === module) {
  const { failures, warnings, oldestDays, total } = checkStepVerification();
  console.log(`[check-step-verification] ${total} ledger entries` + (total ? `; oldest check ${oldestDays}d ago` : ''));
  for (const w of warnings) console.warn('  ' + w);
  if (failures.length) {
    console.error('[check-step-verification] FAILED:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }
  console.log('[check-step-verification] OK — no orphaned or malformed ledger entries.');
}

module.exports = { checkStepVerification, LEDGER_ROOT };
```

- [ ] **Step 2: Run it against Task 2's real ledger data, confirm it passes**

Run: `node scripts/check-step-verification.js`
Expected: `[check-step-verification] OK — no orphaned or malformed ledger entries.` (prints entry count first)

- [ ] **Step 3: Prove the orphan gate is live**

Temporarily copy any ledger file to `demo_api_server/data/step-verification/banking/UC-DOES-NOT-EXIST.chip.heuristic.json`, editing its `useCaseId` field to `"UC-DOES-NOT-EXIST"`.

Run: `node scripts/check-step-verification.js`
Expected: exits 1, prints `[orphan] banking/UC-DOES-NOT-EXIST.chip.heuristic.json: useCaseId "UC-DOES-NOT-EXIST" no longer in useCases.js — delete or fix`

Delete the temporary file, re-run, confirm it passes again.

- [ ] **Step 4: Write `scripts/gen-step-verification-report.js`**

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'docs/use-cases/step-verification-report.md');
const LEDGER_ROOT = path.join(ROOT, 'demo_api_server/data/step-verification');

function loadLedger() {
  const rows = [];
  if (!fs.existsSync(LEDGER_ROOT)) return rows;
  for (const vertical of fs.readdirSync(LEDGER_ROOT)) {
    const dir = path.join(LEDGER_ROOT, vertical);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      rows.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    }
  }
  return rows;
}

function buildReport() {
  const rows = loadLedger().sort(
    (a, b) =>
      a.vertical.localeCompare(b.vertical) ||
      a.useCaseId.localeCompare(b.useCaseId) ||
      a.triggerType.localeCompare(b.triggerType) ||
      a.mode.localeCompare(b.mode),
  );

  const lines = [
    '<!-- AUTO-GENERATED by scripts/gen-step-verification-report.js — do not hand-edit -->',
    '',
    '# Demo Step Verification Report',
    '',
    '> Machine-written from `demo_api_server/data/step-verification/`. A row only',
    '> exists because a test run wrote it — this table cannot be hand-ticked.',
    '> Regenerate: `npm run step-verification:gen` (from `demo_api_server/`).',
    '',
    '| Vertical | Use Case | Trigger | Mode | Status | Error Class | Checked At |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const r of rows) {
    const glyph = r.status === 'PASS' ? '✅' : '❌';
    lines.push(
      `| ${r.vertical} | ${r.useCaseId} | ${r.triggerType} | ${r.mode} | ${glyph} ${r.status} | ${r.errorClass || ''} | ${r.checkedAt} |`,
    );
  }
  lines.push('');

  const total = rows.length;
  const passing = rows.filter((r) => r.status === 'PASS').length;
  lines.push('## Summary', '', `${passing}/${total} checks passing.`, '');

  return lines.join('\n');
}

const [, , mode] = process.argv;

if (mode === 'generate') {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buildReport(), 'utf8');
  console.log(`[gen-step-verification-report] written: ${OUT_PATH}`);
} else if (mode === 'check') {
  const fresh = buildReport();
  let existing = '';
  try {
    existing = fs.readFileSync(OUT_PATH, 'utf8');
  } catch (_) {
    /* file absent */
  }
  if (fresh !== existing) {
    console.error('[gen-step-verification-report] DRIFT DETECTED: docs/use-cases/step-verification-report.md is out of date.');
    console.error('Run: npm run step-verification:gen (from demo_api_server/)');
    process.exit(1);
  }
  console.log('[gen-step-verification-report] OK — report is current.');
} else {
  console.error('Usage: gen-step-verification-report.js generate|check');
  process.exit(1);
}
```

- [ ] **Step 5: Generate the report and inspect it**

Run: `cd demo_api_server && node ../scripts/gen-step-verification-report.js generate`
Expected: `[gen-step-verification-report] written: .../docs/use-cases/step-verification-report.md`

Run: `cat docs/use-cases/step-verification-report.md` (from repo root) — confirm one row per Task 2 ledger entry, all `✅ PASS`.

- [ ] **Step 6: Wire the two new scripts into `demo_api_server/package.json`**

Add these three lines next to the existing `use-cases:*` scripts (same block, alongside `use-cases:audit:gen`):

```json
"step-verification:check": "node ../scripts/check-step-verification.js",
"step-verification:gen": "node ../scripts/gen-step-verification-report.js generate",
"step-verification:report:check": "node ../scripts/gen-step-verification-report.js check"
```

Modify the existing `use-cases:gen` line from:
```json
"use-cases:gen": "npm run use-cases:audit:gen && npm run use-cases:docs:gen && node ../scripts/gen-demo-runbook.js generate",
```
to:
```json
"use-cases:gen": "npm run use-cases:audit:gen && npm run use-cases:docs:gen && node ../scripts/gen-demo-runbook.js generate && node ../scripts/gen-step-verification-report.js generate",
```

Modify the existing `use-cases:check` line from:
```json
"use-cases:check": "npm run use-cases:audit:check && npm run use-cases:docs:check && node ../scripts/check-use-cases-maturity.js && node ../scripts/gen-demo-runbook.js check && node ../scripts/check-goldens.js"
```
to:
```json
"use-cases:check": "npm run use-cases:audit:check && npm run use-cases:docs:check && node ../scripts/check-use-cases-maturity.js && node ../scripts/gen-demo-runbook.js check && node ../scripts/check-goldens.js && node ../scripts/check-step-verification.js"
```

- [ ] **Step 7: Run the composite check, confirm it passes**

Run: `cd demo_api_server && npm run use-cases:check`
Expected: every sub-check prints OK, ends with `[check-step-verification] OK — no orphaned or malformed ledger entries.` and exit code 0. (Note: `use-cases:audit:check`/`use-cases:docs:check` will fail here only if `audit-table.md`/the docs table are stale for unrelated reasons predating this task — if so, run `npm run use-cases:gen` first, matching existing repo convention, then re-check.)

- [ ] **Step 8: Commit**

```bash
git add scripts/check-step-verification.js scripts/gen-step-verification-report.js demo_api_server/package.json docs/use-cases/step-verification-report.md
git commit -m "feat(step-verification): add ledger check gate + auto-generated report"
```

---

### Task 4: Live-stack Playwright spec (checks 1, 3, 4, 5-live; chip + free-text, heuristic + LLM-only)

**Files:**
- Create: `demo_api_ui/tests/e2e/stepVerification.banking.real.spec.js`

**Interfaces:**
- Consumes: `loginAsCustomer`, `requireRealLoginEnv` from `./helpers/realLogin` (existing); `writeLedgerEntry` from `../../../demo_api_server/services/stepVerificationLedger` (Task 1); `USE_CASES`, `resolveUseCase` from `../../../demo_api_server/config/useCases.js` — both plain Node modules, safe to `require` across the package boundary since they have no dependencies beyond `fs`/`path`.
- Live endpoints used (all confirmed real, existing routes):
  - `POST /api/demo-agent/nl` — body `{message, provider, vertical}`, response `{source, result}` (banking: `result.banking.action`).
  - `POST /api/mcp/tool` (`demo_api_server/server.js:1725`) — body `{tool, params}`, response is `res.status(outcome.httpStatus).json(outcome.body)` where `outcome.body.result` is the tool's actual output data (confirmed via the route's streaming branch, which explicitly sends `{type:'result', data: outcome.body.result, ...}` — same `outcome.body.result` field, just also wrapped for the JSON path).
  - `GET /api/accounts/my` — response `{accounts: [{id, userId, accountType, balance, ...}]}` (same endpoint `hitl-transfer.real.spec.js` already uses for ground truth).
  - `PATCH /api/admin/feature-flags` — body `{updates: {ff_heuristic_enabled: boolean}}`.

- [ ] **Step 1: Write the spec**

```js
// demo_api_ui/tests/e2e/stepVerification.banking.real.spec.js
/**
 * @file stepVerification.banking.real.spec.js
 * Live-stack step verification for banking: chip dispatch (heuristic mode)
 * and free-text dispatch (LLM-only mode), writing PASS/FAIL ledger entries
 * for checks 1 (server error), 3 (LLM error), 4 (right response — values vs
 * /api/accounts/my), 5 (right gate — via `source`).
 *
 * Prerequisites: stack running (./run.sh), E2E_CUSTOMER_USERNAME/PASSWORD set.
 * Run:
 *   cd demo_api_ui
 *   E2E_BASE_URL=https://api.ping.demo:4000 npx playwright test \
 *     tests/e2e/stepVerification.banking.real.spec.js --config=playwright.real.config.js
 */
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { writeLedgerEntry } = require('../../../demo_api_server/services/stepVerificationLedger');
const { USE_CASES, resolveUseCase } = require('../../../demo_api_server/config/useCases.js');

/** First works-maturity banking chip whose primaryTool reads accounts/balance. */
function findBankingReadChip() {
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, 'banking') || u;
    if (uc.maturity !== 'works') continue;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text) continue;
    if (uc.primaryTool === 'get_my_accounts' || uc.primaryTool === 'get_account_balance') {
      return { id: uc.id, text: t.text, primaryTool: uc.primaryTool };
    }
  }
  return null;
}

async function callMcpTool(page, tool, params) {
  return page.evaluate(
    async ({ tool, params }) => {
      const r = await fetch('/api/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tool, params }),
      });
      const body = await r.json().catch(() => ({}));
      return { status: r.status, body };
    },
    { tool, params },
  );
}

const AMOUNT_CASES = [
  {
    useCaseId: 'UC8',
    chipText: 'transfer $300 from checking to savings',
    freeText: 'please move three hundred dollars out of my checking into my savings',
  },
  {
    useCaseId: 'UC7',
    chipText: 'transfer $600 from checking to savings',
    freeText: 'please move six hundred dollars out of my checking into my savings',
  },
  {
    useCaseId: 'UC6',
    chipText: 'transfer $2500 from checking to savings',
    freeText: 'please move twenty-five hundred dollars out of my checking into my savings',
  },
];

const LLM_ERROR_SIGNATURES = [
  'unknown provider in reasonOnce',
  'exceeds the available context size',
  'ProviderClient httpx errored',
];

/** Best-effort — some environments don't have docker access from the test runner. */
function grepDockerLogsForLlmErrors(sinceSeconds) {
  try {
    const out = execSync(`docker logs --since ${sinceSeconds}s ai-demo-agent-service 2>&1 | tail -200`, {
      encoding: 'utf8',
    });
    return LLM_ERROR_SIGNATURES.filter((sig) => out.includes(sig));
  } catch (_) {
    return null;
  }
}

async function dispatchNl(page, message, provider) {
  return page.evaluate(
    async ({ message, provider }) => {
      const r = await fetch('/api/demo-agent/nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, provider, vertical: 'banking' }),
      });
      const body = await r.json().catch(() => ({}));
      return { status: r.status, body };
    },
    { message, provider },
  );
}

test.describe('Step verification — banking (real login, live stack)', () => {
  test.skip(!requireRealLoginEnv(), 'Skipped: set E2E_CUSTOMER_USERNAME and E2E_CUSTOMER_PASSWORD');

  test.beforeEach(async ({ page }) => {
    await loginAsCustomer(page);
  });

  for (const c of AMOUNT_CASES) {
    test(`${c.useCaseId} chip (heuristic): "${c.chipText}"`, async ({ page }) => {
      const { status, body } = await dispatchNl(page, c.chipText, 'llamacpp');

      let checkStatus = 'PASS';
      let errorClass = null;
      if (status !== 200) {
        checkStatus = 'FAIL';
        errorClass = 'server_error';
      } else if (body.source !== 'heuristic') {
        checkStatus = 'FAIL';
        errorClass = 'parse_error';
      }

      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: c.useCaseId,
        triggerType: 'chip',
        mode: 'heuristic',
        status: checkStatus,
        errorClass,
        primaryTool: 'create_transfer',
        checkedAt: new Date().toISOString(),
      });

      expect(status).toBe(200);
      expect(body.source).toBe('heuristic');
    });
  }

  test('accounts/balance chip: values match /api/accounts/my (check 4: right response)', async ({ page }) => {
    const readChip = findBankingReadChip();
    test.skip(!readChip, 'No works-maturity banking chip routes to an accounts/balance read tool');

    const liveAccounts = await page.evaluate(async () => {
      const r = await fetch('/api/accounts/my', { credentials: 'include' });
      if (!r.ok) throw new Error(`accounts/my -> ${r.status}`);
      const data = await r.json();
      return data.accounts || [];
    });

    const { status, body } = await callMcpTool(page, readChip.primaryTool, {});

    let checkStatus = 'PASS';
    let errorClass = null;

    if (status !== 200) {
      checkStatus = 'FAIL';
      errorClass = 'server_error';
    } else {
      const resultText = JSON.stringify(body.result ?? {});
      const anyBalanceGrounded = liveAccounts.some((a) => resultText.includes(String(a.balance)));
      if (!anyBalanceGrounded) {
        checkStatus = 'FAIL';
        errorClass = 'wrong_response';
      }
    }

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: readChip.id,
      triggerType: 'chip',
      mode: 'heuristic',
      status: checkStatus,
      errorClass,
      primaryTool: readChip.primaryTool,
      checkedAt: new Date().toISOString(),
    });

    expect(status).toBe(200);
    expect(checkStatus).toBe('PASS');
  });

  test.describe('free-text prompts (LLM-only mode)', () => {
    test.beforeAll(async ({ request, baseURL }) => {
      await request.patch(`${baseURL}/api/admin/feature-flags`, {
        data: { updates: { ff_heuristic_enabled: false } },
      });
    });

    test.afterAll(async ({ request, baseURL }) => {
      await request.patch(`${baseURL}/api/admin/feature-flags`, {
        data: { updates: { ff_heuristic_enabled: true } },
      });
    });

    for (const c of AMOUNT_CASES) {
      test(`${c.useCaseId} free-text (llamacpp): "${c.freeText}"`, async ({ page }) => {
        const { status } = await dispatchNl(page, c.freeText, 'llamacpp');

        let checkStatus = 'PASS';
        let errorClass = null;
        if (status !== 200) {
          checkStatus = 'FAIL';
          errorClass = 'server_error';
        } else {
          const llmErrors = grepDockerLogsForLlmErrors(30);
          if (llmErrors && llmErrors.length) {
            checkStatus = 'FAIL';
            errorClass = 'llm_error';
          }
        }

        writeLedgerEntry({
          vertical: 'banking',
          useCaseId: c.useCaseId,
          triggerType: 'prompt',
          mode: 'llamacpp',
          status: checkStatus,
          errorClass,
          primaryTool: 'create_transfer',
          checkedAt: new Date().toISOString(),
        });

        expect(status).toBe(200);
      });
    }
  });
});
```

- [ ] **Step 2: Confirm prerequisites, then run it once and expect it to catch nothing (green baseline)**

```bash
set -a && . /Users/cmuir/Development/AI-DEMO2/demo_api_server/.env && set +a
cd demo_api_ui
E2E_BASE_URL="https://api.ping.demo:4000" \
E2E_CUSTOMER_USERNAME="$DEMO_USER_USERNAME" E2E_CUSTOMER_PASSWORD="$DEMO_USER_PASSWORD" \
npx playwright test tests/e2e/stepVerification.banking.real.spec.js --config=playwright.real.config.js --reporter=line
```
Expected: all 7 tests pass (3 amount-tier chip + 1 accounts/balance value-grounding chip + 3 free-text). Requires the stack running (`./run.sh`) and `ff_heuristic_enabled` restored to `true` afterward — the `afterAll` hook does this, but if the run is interrupted, manually `PATCH /api/admin/feature-flags {"updates":{"ff_heuristic_enabled":true}}` before doing anything else, since it's global state on a live stack.

- [ ] **Step 3: Prove the check is live — temporarily assert the wrong `source`**

Change the chip test's assertion from `expect(body.source).toBe('heuristic')` to `expect(body.source).toBe('llamacpp_fallback')`.

Run the same command as Step 2, scoped to one test: add `-g "UC8 chip"` to the Playwright command.
Expected: FAIL — `expected 'llamacpp_fallback', received 'heuristic'`.

Revert the assertion, re-run, confirm PASS.

- [ ] **Step 4: Prove the value-grounding check is live**

In the check-4 test, temporarily change `liveAccounts.some((a) => resultText.includes(String(a.balance)))` to `liveAccounts.some((a) => resultText.includes(String(a.balance + 1)))` (an offset that can never match a real balance).

Run the same command as Step 2, scoped to this test: add `-g "check 4"`.
Expected: FAIL — `checkStatus` computes to `'FAIL'` / `errorClass: 'wrong_response'`, and the final `expect(checkStatus).toBe('PASS')` fails.

Revert the change, re-run, confirm PASS.

- [ ] **Step 5: Inspect the ledger**

Run: `ls /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/demo-step-verification-plan/demo_api_server/data/step-verification/banking/`
Expected: `UC6.chip.heuristic.json`, `UC7.chip.heuristic.json`, `UC8.chip.heuristic.json` now also carry `UC6.prompt.llamacpp.json`, `UC7.prompt.llamacpp.json`, `UC8.prompt.llamacpp.json` (the chip-mode files get overwritten in place with the live-verified result — same filename as Task 2 wrote from the mocked run, now updated with the live-run status; this is expected and correct, the live check is the stronger proof), plus one new file for whichever use case `findBankingReadChip()` resolved to (e.g. `UC1.chip.heuristic.json` if UC1 is the accounts/balance read chip).

- [ ] **Step 6: Regenerate the report and commit**

```bash
cd demo_api_server && node ../scripts/gen-step-verification-report.js generate
cd ..
git add demo_api_ui/tests/e2e/stepVerification.banking.real.spec.js demo_api_server/data/step-verification/ docs/use-cases/step-verification-report.md
git commit -m "test(step-verification): add live-stack banking chip + free-text spec"
```

---

### Task 5: promptfoo narration/hallucination microbenchmark

**Files:**
- Create: `demo_api_server/promptfoo/step-narration.config.yaml`
- Modify: `demo_api_server/package.json` (add devDependency + 1 script)

**Interfaces:**
- Provider target: `http://localhost:8090/v1` (the existing `demo_llm_proxy`, confirmed OpenAI-compatible passthrough — any path including `/v1/chat/completions` is forwarded untouched to whichever llama-server tier is selected).
- This is a standalone, self-contained microbenchmark of the LLM's narration behavior given a representative tool-result JSON — it does **not** replicate the full authenticated pipeline (that's Task 4's job). It answers "given this exact grounded data, does the model state it correctly or invent a different number," independent of routing/auth.

- [ ] **Step 1: Install promptfoo**

Run: `cd demo_api_server && npm install --save-dev promptfoo`
Expected: `promptfoo` appears under `devDependencies` in `demo_api_server/package.json` with whatever version npm resolves (do not hand-write a version number).

- [ ] **Step 2: Write the config**

```yaml
# demo_api_server/promptfoo/step-narration.config.yaml
description: "Banking step narration — LLM grounding/hallucination check (Phase 1, banking)"

providers:
  - id: openai:chat:phi-4-mini-instruct
    config:
      apiBaseUrl: http://localhost:8090/v1
      apiKey: not-needed
  - id: openai:chat:gpt-oss-20b
    config:
      apiBaseUrl: http://localhost:8090/v1
      apiKey: not-needed

prompts:
  - |
    You are the banking demo's narration assistant. A tool call just returned
    the following JSON result for the user's request. Reply with ONE short
    sentence describing the result. Use ONLY the numbers present in the JSON
    below — never estimate, round, or invent a different figure.

    Tool result: {{tool_result}}

tests:
  - vars:
      tool_result: '{"action":"get_account_balance","accountType":"CHECKING","balance":2857.48}'
    assert:
      - type: contains
        value: "2857.48"
      - type: llm-rubric
        value: "The reply does not state any dollar figure other than 2857.48."
  - vars:
      tool_result: '{"action":"create_transfer","status":"HITL_REQUIRED","amount":300,"fromAccountType":"CHECKING","toAccountType":"SAVINGS"}'
    assert:
      - type: contains
        value: "300"
      - type: llm-rubric
        value: "The reply says the transfer requires human approval/consent before it runs — it does not claim the transfer already completed."
  - vars:
      tool_result: '{"action":"create_transfer","status":"DENY","amount":2500,"reason":"exceeds_transfer_limit"}'
    assert:
      - type: contains
        value: "2500"
      - type: llm-rubric
        value: "The reply clearly states the transfer was denied/blocked — it does not claim the transfer succeeded."
```

- [ ] **Step 3: Add the npm script**

Add to `demo_api_server/package.json` scripts (near the other `test:*` entries):
```json
"promptfoo:step-narration": "promptfoo eval -c promptfoo/step-narration.config.yaml"
```

- [ ] **Step 4: Run it against the live local LLM proxy, confirm it passes**

Prerequisite: `demo_llm_proxy` running and healthy — `curl -s http://localhost:8090/health` should show `"status":"healthy"`.

Run: `cd demo_api_server && npm run promptfoo:step-narration`
Expected: promptfoo prints a pass/fail table; all 6 assertions (2 per test case × 3 cases, × however many providers configured) pass.

- [ ] **Step 5: Prove the rubric assertion is live**

Temporarily change the DENY test case's `tool_result` amount from `2500` to `999999` while leaving the `contains: "2500"` assertion unchanged.

Run: `npm run promptfoo:step-narration`
Expected: the `contains: "2500"` assertion for that case now FAILS (the model narrates `999999`, not `2500`).

Revert the change, re-run, confirm it passes again.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/promptfoo/step-narration.config.yaml demo_api_server/package.json demo_api_server/package-lock.json
git commit -m "test(step-verification): add promptfoo narration/hallucination microbenchmark"
```

---

### Task 6: Docs link + final full-sweep regeneration

**Files:**
- Modify: `docs/use-cases/README.md`

**Interfaces:** None new — this task only links the Task 3 output and re-runs the full generator sweep so every auto-generated doc is in sync after Tasks 1–5 landed real ledger data.

- [ ] **Step 1: Add a "See also" link**

In `docs/use-cases/README.md`, change:
```markdown
See also: [Audit Table](./audit-table.md)
```
to:
```markdown
See also: [Audit Table](./audit-table.md), [Step Verification Report](./step-verification-report.md)
```

- [ ] **Step 2: Re-run the full Jest suite for this plan's new files together (confirms no cross-file interference)**

```bash
cd demo_api_server
npx jest tests/stepVerificationLedger.test.js tests/stepVerification.banking.test.js \
  --testPathIgnorePatterns='/node_modules/' --forceExit --verbose
```
Expected: all tests from Tasks 1 and 2 pass together.

- [ ] **Step 3: Regenerate every use-case doc and confirm the composite check is green**

```bash
cd demo_api_server
npm run use-cases:gen
npm run use-cases:check
```
Expected: `use-cases:check` ends with exit code 0.

- [ ] **Step 4: Commit**

```bash
git add docs/use-cases/README.md docs/use-cases/step-verification-report.md
git commit -m "docs(step-verification): link the step verification report"
```

---

## After this plan

Phase 2 (separate plan, not started here): parameterize Tasks 2 and 4 by vertical and widen from banking to the remaining 8 verticals — the `bankingWorksChipCases()` filter, the ledger schema, and the check/report scripts are already vertical-parameterized (`vertical: 'banking'` is the only hard-coded value in Tasks 1–4), so that widening is mechanical, not a redesign.
