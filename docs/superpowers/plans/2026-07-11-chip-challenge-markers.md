# Chip Challenge Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every subagent prompt MUST direct the agent to check for and use applicable skills (e.g. regression-guard) before editing.

**Goal:** Give every agent suggestion chip an honest marker for the human-in-the-loop control it triggers — 👤 consent, 👤🔑 both (consent+MFA), 🔑 MFA-spotlight — and ensure every vertical can demo both a consent chip and a both chip.

**Architecture:** A per-chip `challenge` field ("consent" | "both" | "step_up") flows from vertical manifests through `verticalSuggestionChips` into the `HitlChipMark` component, which renders emoji spans. Existing chips are tagged; three verticals gain a real new tool so a marker never advertises a gate the tool won't fire.

**Tech Stack:** Node/Express BFF (`demo_api_server`), React/Vite UI (`demo_api_ui`), Zod manifest schemas, Jest tests, `scripts/gen-vertical-tools.js` (regenerates `verticalTools.generated.ts` + reconciles `scope-topology.json` challengeType from tool `authz`), `snapshots/gen-authorize-snapshot.js` (P1AZ policy snapshot).

## Global Constraints

- **Emoji allowlist (REGRESSION_PLAN §0):** after this change the allowed set is `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑`. No other emoji anywhere.
- **Markers must match the runtime gate.** A chip may only show 👤🔑 if its tool's `authz` is `{ stepUp, consent }`; 👤 only if `{ consent }`. Never advertise a gate the tool won't fire.
- **No change to any existing tool's `authz`/gate.** Gap verticals get NEW tools only.
- **Minimal diff** (name the element, change only that). **Worktree-only edits**, stage explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` = `worktree-tag-sensitive-chip-hitl` before each commit.
- **Engine semantics:** step-up = consent + MFA; classifier is highest-gate-wins, one gate fires (`authorizeObligations.js:95`).

---

## File Structure

- `REGRESSION_PLAN.md`, `CLAUDE.md`, `.cursor/rules/emoji-allowlist.mdc` — allowlist docs (add 👤 🔑).
- `demo_api_server/services/verticalManifest/schema.js` — add `challenge` to `ChipSchema`.
- `demo_api_ui/src/components/agentChrome.js` — carry `challenge` in `verticalSuggestionChips`; rewrite `HitlChipMark(props)`.
- `demo_api_ui/src/components/AIAgent.js:7202,8607` — pass `challenge`, render mark when `challenge` set.
- `demo_api_ui/src/components/agentActions.js` — banking chips: add `challenge`.
- `demo_api_server/config/verticals/<v>/manifest.json` (9 verticals) — add `challenge` to chips.
- `demo_api_server/config/verticals/{investment,retail,sporting-goods}/tools.js` — new tool def + handler.
- Generated (via scripts, do not hand-edit): `scope-topology.json`, `demo_mcp_server/src/tools/handlers/verticalTools.generated.ts`, `mcp-tool-schemas.json`, `snapshots/*.snapshot.json`.
- Tests: `demo_api_ui/src/**/agentChrome.test.js`, `demo_api_server/tests/chipSchemaContract.test.js` (existing, must stay green), new `demo_api_server/tests/chipChallengeCoverage.test.js`.

---

## PHASE 1 — Display (no authz change)

### Task 1: Expand the emoji allowlist

**Files:**
- Modify: `REGRESSION_PLAN.md:12-15`
- Modify: `CLAUDE.md` (§0 Emoji rule bullet)
- Modify: `.cursor/rules/emoji-allowlist.mdc`

- [ ] **Step 1: Edit REGRESSION_PLAN.md §0.** Change the allowed list line to include the two new glyphs and their meaning. Replace:

```
  `🔐` (security/lock — HITL trigger chips), `✕` (close / dismiss), and `✓`
  (check / confirm). Everything else is plain text or CSS icons / semantic HTML.
```
with:
```
  `🔐` (security/lock — HITL trigger chips), `✕` (close / dismiss), `✓`
  (check / confirm), `👤` (HITL consent marker), and `🔑` (step-up / MFA
  marker). Everything else is plain text or CSS icons / semantic HTML.
```

- [ ] **Step 2: Edit CLAUDE.md** §0 Emoji rule bullet the same way — append `` `👤` `🔑` `` to the allowed set and note "(chip challenge markers)".

- [ ] **Step 3: Edit `.cursor/rules/emoji-allowlist.mdc`** — add `👤` and `🔑` to its allowed list with the same meanings.

- [ ] **Step 4: Verify** all three contain both glyphs:

Run: `grep -l "👤" REGRESSION_PLAN.md CLAUDE.md .cursor/rules/emoji-allowlist.mdc && grep -l "🔑" REGRESSION_PLAN.md CLAUDE.md .cursor/rules/emoji-allowlist.mdc`
Expected: all three paths listed twice.

- [ ] **Step 5: Commit**

```bash
git add REGRESSION_PLAN.md CLAUDE.md .cursor/rules/emoji-allowlist.mdc
git commit -m "chore(§0): allow 👤 (consent) and 🔑 (step-up) emoji for chip markers"
```

---

### Task 2: Add `challenge` to the manifest chip schema

**Files:**
- Modify: `demo_api_server/services/verticalManifest/schema.js:10`
- Test: `demo_api_server/tests/verticalManifest/schema.test.js` (existing)

**Interfaces:**
- Produces: `ChipSchema` accepts `challenge?: "consent" | "both" | "step_up"`.

- [ ] **Step 1: Write the failing test.** Append to `demo_api_server/tests/verticalManifest/schema.test.js`:

```js
const { ChipSchema } = require('../../services/verticalManifest/schema');
describe('ChipSchema challenge', () => {
  it('accepts a valid challenge value', () => {
    expect(ChipSchema.parse({ id: 'x', label: 'X', message: 'x', challenge: 'both' }).challenge).toBe('both');
  });
  it('rejects an invalid challenge value', () => {
    expect(() => ChipSchema.parse({ id: 'x', label: 'X', message: 'x', challenge: 'nope' })).toThrow();
  });
});
```

(If `ChipSchema` is not exported, add it to `module.exports` in `schema.js`.)

- [ ] **Step 2: Run, verify fail.** Run: `cd demo_api_server && npx jest --runTestsByPath tests/verticalManifest/schema.test.js --testPathIgnorePatterns "/node_modules/"`. Expected: FAIL (`challenge` stripped / not exported).

- [ ] **Step 3: Implement.** In `schema.js`, after line 10 (`hitlTrigger: z.boolean().optional(),`) add:

```js
  challenge: z.enum(['consent', 'both', 'step_up']).optional(),
```
Ensure `ChipSchema` is exported: `module.exports = { ...existing, ChipSchema };`

- [ ] **Step 4: Run, verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/schema.js demo_api_server/tests/verticalManifest/schema.test.js
git commit -m "feat(manifest): add optional chip 'challenge' field (consent|both|step_up)"
```

---

### Task 3: Render markers in `HitlChipMark`

**Files:**
- Modify: `demo_api_ui/src/components/agentChrome.js:99-139`
- Modify: `demo_api_ui/src/components/AIAgent.js:7202,8607`
- Test: `demo_api_ui/src/components/agentChrome.test.js` (create)

**Interfaces:**
- Consumes: chip objects with optional `challenge`.
- Produces: `HitlChipMark({ challenge })` renders `👤` (consent), `👤🔑` (both), `🔑` (step_up); `verticalSuggestionChips` output carries `challenge`.

- [ ] **Step 1: Write the failing test.** Create `demo_api_ui/src/components/agentChrome.test.js`:

```js
import React from 'react';
import { render } from '@testing-library/react';
import { HitlChipMark, verticalSuggestionChips } from './agentChrome';

test('consent → 👤 only', () => {
  const { container } = render(<HitlChipMark challenge="consent" />);
  expect(container.textContent).toContain('👤');
  expect(container.textContent).not.toContain('🔑');
});
test('both → 👤🔑', () => {
  const { container } = render(<HitlChipMark challenge="both" />);
  expect(container.textContent).toContain('👤');
  expect(container.textContent).toContain('🔑');
});
test('step_up → 🔑 only', () => {
  const { container } = render(<HitlChipMark challenge="step_up" />);
  expect(container.textContent).toContain('🔑');
  expect(container.textContent).not.toContain('👤');
});
test('verticalSuggestionChips carries challenge', () => {
  const chips = verticalSuggestionChips({ dashboard: { chips10: [{ id: 'a', label: 'A', message: 'a', challenge: 'both' }] } });
  expect(chips[0].challenge).toBe('both');
});
```

- [ ] **Step 2: Run, verify fail.** Run: `cd demo_api_ui && npx jest src/components/agentChrome.test.js`. Expected: FAIL (`HitlChipMark` ignores prop; `challenge` not carried).

- [ ] **Step 3: Implement.** In `agentChrome.js`, add `challenge: c.challenge || null,` inside the object returned by `verticalSuggestionChips` (after the `hitlTrigger` line). Replace the `HitlChipMark` function (lines ~112-139) with:

```jsx
// Chip challenge markers (REGRESSION_PLAN §0 allows 👤 and 🔑):
//   consent → 👤 (HITL approval)   both → 👤🔑 (consent + step-up/MFA)
//   step_up → 🔑 (MFA spotlight, showcase chips)
const CHALLENGE_MARK = {
  consent: { text: '👤', label: 'Requires human approval (consent)' },
  both: { text: '👤🔑', label: 'Requires consent and step-up (MFA)' },
  step_up: { text: '🔑', label: 'Requires step-up authentication (MFA)' },
};
export function HitlChipMark({ challenge = 'both' } = {}) {
  const m = CHALLENGE_MARK[challenge] || CHALLENGE_MARK.both;
  return (
    <span className="ba-chip-hitl-mark" role="img" title={m.label} aria-label={m.label}>
      {m.text}
    </span>
  );
}
```

- [ ] **Step 4: Update call sites.** In `AIAgent.js` line 7202 replace `{action.hitlTrigger && <HitlChipMark />}` with `{(action.challenge || action.hitlTrigger) && <HitlChipMark challenge={action.challenge || 'both'} />}`. Line 8607 replace `{chip.hitlTrigger && <HitlChipMark />}` with `{(chip.challenge || chip.hitlTrigger) && <HitlChipMark challenge={chip.challenge || 'both'} />}`.

- [ ] **Step 5: Run, verify pass.** Run: `cd demo_api_ui && npx jest src/components/agentChrome.test.js`. Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/agentChrome.js demo_api_ui/src/components/agentChrome.test.js demo_api_ui/src/components/AIAgent.js
git commit -m "feat(ui): HitlChipMark renders 👤/👤🔑/🔑 from chip challenge"
```

---

### Task 4: Tag existing chips with `challenge` (all verticals)

**Files:** Modify the 9 `demo_api_server/config/verticals/<v>/manifest.json` and `demo_api_ui/src/components/agentActions.js`.
**Test:** `demo_api_server/tests/chipSchemaContract.test.js` (existing) stays green.

Apply these exact edits (add `"challenge": "<value>"` immediately before `"tool":` on each chip line; for showcase chips likewise). Values from the spec coverage table:

- [ ] **Step 1: Primary + a2a chips → challenge.**
  - banking `manifest.json` `bk-hitl` → `both`.
  - government `gv5` → `both`; `gv-a2a` → `consent`.
  - investment `inv-hitl` → `both`.
  - healthcare `hc5` → `both`; `hc-a2a` → `consent` **and revert its label from `"🔐 Sensitive records"` back to `"Sensitive records"` and remove the `"hitlTrigger": true` I added** (challenge now drives the mark).
  - manufacturing `mf5` → `both`; `mf-a2a` → `consent`.
  - university `un5` → `both`; `un-a2a` → `consent`.
  - retail `rt4` → `consent`.
  - workforce `wf4` → `both`; `wf5` → `consent`.
  - sporting-goods `sg3` → `consent`.

- [ ] **Step 2: Showcase chips → challenge (every vertical with a `securityShowcase`).** For each: `sec_mfa_otp` → `step_up`, `sec_mfa_fido` → `step_up`, `sec_hitl` → `consent`.

- [ ] **Step 3: Banking `agentActions.js`.** On the two `hitlTrigger: true` chips: the transfer chip(s) → add `challenge: 'both'`; the sensitive-account chip → add `challenge: 'consent'`.

- [ ] **Step 4: Verify JSON + contract.**

Run: `for v in banking government investment healthcare manufacturing university retail workforce sporting-goods; do node -e "JSON.parse(require('fs').readFileSync('demo_api_server/config/verticals/$v/manifest.json'))" || echo "BAD $v"; done`
Then: `cd demo_api_server && npx jest --runTestsByPath tests/chipSchemaContract.test.js --testPathIgnorePatterns "/node_modules/"`
Expected: no BAD lines; contract PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/verticals/*/manifest.json demo_api_ui/src/components/agentActions.js
git commit -m "feat(chips): tag all paused chips with challenge (consent/both/step_up)"
```

---

### Task 5: Coverage test — every vertical has a consent AND a both chip

**Files:** Test: `demo_api_server/tests/chipChallengeCoverage.test.js` (create)

- [ ] **Step 1: Write the test.**

```js
'use strict';
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'config', 'verticals');
const VERTICALS = ['banking','government','investment','healthcare','manufacturing','university','retail','workforce','sporting-goods'];
function chipsOf(m){ const out=[]; (function w(o){ if(!o||typeof o!=='object')return; if(Array.isArray(o))return o.forEach(w); if(o.id&&o.challenge)out.push(o); Object.values(o).forEach(w);})(m); return out; }
describe('chip challenge coverage', () => {
  for (const v of VERTICALS) {
    it(`${v} can demo consent AND both`, () => {
      const m = JSON.parse(fs.readFileSync(path.join(base, v, 'manifest.json'), 'utf8'));
      const kinds = new Set(chipsOf(m).map(c => c.challenge));
      expect(kinds.has('consent')).toBe(true);
      expect(kinds.has('both')).toBe(true);
    });
  }
});
```

- [ ] **Step 2: Run.** Run: `cd demo_api_server && npx jest --runTestsByPath tests/chipChallengeCoverage.test.js --testPathIgnorePatterns "/node_modules/"`. Expected: FAIL for `investment`, `retail`, `sporting-goods` (their missing-class chips don't exist yet). This defines Phase 2's done-condition.

- [ ] **Step 3: Commit (red test allowed — it's the Phase 2 gate).**

```bash
git add demo_api_server/tests/chipChallengeCoverage.test.js
git commit -m "test(chips): coverage gate — each vertical needs consent + both chip"
```

---

## PHASE 2 — Gap-fill tools (real gates, so markers stay honest)

Pattern for each new tool: add the tool def (with `authz`, `required: []`) and a handler `case` returning `{ result, render }` with defaulted params; add a dashboard chip with `challenge`; regenerate artifacts; add a decision test.

### Task 6: investment `sensitive_holdings` (consent → 👤)

**Files:**
- Modify: `demo_api_server/config/verticals/investment/tools.js` (tools array ~line 30; execute switch ~line 64)
- Modify: `demo_api_server/config/verticals/investment/manifest.json`
- Generated: `scope-topology.json`, `verticalTools.generated.ts`, `mcp-tool-schemas.json`
- Test: `demo_authz_server/tests/decision.test.js`

- [ ] **Step 1: Add the tool def.** In the `tools` array add:

```js
    { name: 'sensitive_holdings', description: 'Access sensitive holdings detail including cost basis and tax lots. Requires explicit user consent.', inputSchema: { type: 'object', properties: {}, required: [] }, scopes: ['read'], authz: { consent: true } },
```

- [ ] **Step 2: Add the handler case** in `execute`'s switch (before `default`):

```js
      case 'sensitive_holdings':
        return { result: { holdings: store.get(userId).holdings, note: 'Sensitive cost-basis / tax-lot detail' }, render: 'text' };
```

- [ ] **Step 3: Add the dashboard chip** to `investment/manifest.json` `dashboard.chips10` (next to `inv-hitl`):

```json
      { "id": "inv-a2a", "label": "Sensitive holdings", "message": "access my sensitive holdings", "mode": "both", "challenge": "consent", "tool": "sensitive_holdings" },
```
Add a matching heuristic if the vertical requires one to route the message (mirror `hc-a2a`'s heuristic in `investment/index.js`).

- [ ] **Step 4: Regenerate.** Run: `node scripts/gen-vertical-tools.js generate`. Expected: reports `sensitive_holdings` added to `verticalTools.generated.ts` + `scope-topology.json` with `challengeType: consent`.

- [ ] **Step 5: Add decision test** to `demo_authz_server/tests/decision.test.js`:

```js
test('sensitive_holdings (consent tool, no amount) -> INDETERMINATE reason=HITL_CONSENT', async () => {
  const result = await decide(consentOnlyParams({ ToolName: 'sensitive_holdings' }));
  assert.strictEqual(result.decision, 'INDETERMINATE');
  assert.strictEqual(result.reason, 'HITL_CONSENT');
});
```

- [ ] **Step 6: Run** the coverage + decision + contract tests.

Run: `cd demo_api_server && npx jest --runTestsByPath tests/chipChallengeCoverage.test.js tests/chipSchemaContract.test.js --testPathIgnorePatterns "/node_modules/"` — investment now passes coverage.
Run: `node --test demo_authz_server/tests/decision.test.js` (or the repo's authz test runner) — new test PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/config/verticals/investment/ scope-topology.json demo_mcp_server/src/tools/handlers/verticalTools.generated.ts mcp-tool-schemas.json demo_authz_server/tests/decision.test.js
git commit -m "feat(investment): add sensitive_holdings consent tool + chip (👤)"
```

### Task 7: retail `cash_out_store_credit` (both → 👤🔑)

**Files:** as Task 6 but retail; step-up tool.

- [ ] **Step 1: Tool def** in `retail/tools.js` tools array:

```js
    { name: 'cash_out_store_credit', description: 'Pay the store-credit balance out to an external bank account (requires step-up + consent).', inputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: [] }, scopes: ['write'], authz: { stepUp: true, consent: true } },
```

- [ ] **Step 2: Handler case** in retail `execute`:

```js
      case 'cash_out_store_credit': {
        const _amt = (params && params.amount != null) ? params.amount : 50;
        return { result: { cashedOut: _amt, to: 'external bank ••1234', status: 'pending step-up' }, render: 'text' };
      }
```

- [ ] **Step 3: Dashboard chip** in `retail/manifest.json` chips10:

```json
      { "id": "rt-mfa", "label": "Cash out store credit", "message": "cash out my store credit", "mode": "both", "challenge": "both", "tool": "cash_out_store_credit" },
```
Add a routing heuristic in `retail/index.js` mirroring an existing write action.

- [ ] **Step 4: Regenerate.** Run: `node scripts/gen-vertical-tools.js generate`. Expected: `cash_out_store_credit` added with `challengeType: step_up`.

- [ ] **Step 5: Regenerate P1AZ snapshot** (new step-up tool must join `RequiresMcpStepUp`). Run: `npm run snapshot:generate`. Expected: snapshot updated; `cash_out_store_credit` appears in the RequiresMcpStepUp condition.

- [ ] **Step 6: Decision test** in `decision.test.js`:

```js
test('cash_out_store_credit (step-up tool, no amount) -> INDETERMINATE reason=STEP_UP', async () => {
  const result = await decide(consentOnlyParams({ ToolName: 'cash_out_store_credit' }));
  assert.strictEqual(result.decision, 'INDETERMINATE');
  assert.strictEqual(result.reason, 'STEP_UP');
});
```

- [ ] **Step 7: Run** coverage + contract + decision tests (retail now passes coverage).

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/config/verticals/retail/ scope-topology.json demo_mcp_server/src/tools/handlers/verticalTools.generated.ts mcp-tool-schemas.json snapshots/ demo_authz_server/tests/decision.test.js
git commit -m "feat(retail): add cash_out_store_credit step-up tool + chip (👤🔑)"
```

### Task 8: sporting-goods `transfer_membership` (both → 👤🔑)

Identical shape to Task 7, sporting-goods.

- [ ] **Step 1: Tool def** in `sporting-goods/tools.js`:

```js
    { name: 'transfer_membership', description: 'Transfer this membership to another person (requires step-up + consent).', inputSchema: { type: 'object', properties: { recipient: { type: 'string' } }, required: [] }, scopes: ['write'], authz: { stepUp: true, consent: true } },
```

- [ ] **Step 2: Handler case:**

```js
      case 'transfer_membership': {
        const _to = (params && params.recipient) || 'a family member';
        return { result: { transferredTo: _to, status: 'pending step-up' }, render: 'text' };
      }
```

- [ ] **Step 3: Dashboard chip** in `sporting-goods/manifest.json`:

```json
      { "id": "sg-mfa", "label": "Transfer membership", "message": "transfer my membership", "mode": "both", "challenge": "both", "tool": "transfer_membership" },
```
Add routing heuristic in `sporting-goods/index.js`.

- [ ] **Step 4: Regenerate.** Run: `node scripts/gen-vertical-tools.js generate` → `transfer_membership` with `challengeType: step_up`.
- [ ] **Step 5: Snapshot.** Run: `npm run snapshot:generate`.
- [ ] **Step 6: Decision test:**

```js
test('transfer_membership (step-up tool, no amount) -> INDETERMINATE reason=STEP_UP', async () => {
  const result = await decide(consentOnlyParams({ ToolName: 'transfer_membership' }));
  assert.strictEqual(result.decision, 'INDETERMINATE');
  assert.strictEqual(result.reason, 'STEP_UP');
});
```

- [ ] **Step 7: Run** coverage (all 9 now green) + contract + decision.
- [ ] **Step 8: Commit**

```bash
git add demo_api_server/config/verticals/sporting-goods/ scope-topology.json demo_mcp_server/src/tools/handlers/verticalTools.generated.ts mcp-tool-schemas.json snapshots/ demo_authz_server/tests/decision.test.js
git commit -m "feat(sporting-goods): add transfer_membership step-up tool + chip (👤🔑)"
```

---

## PHASE 3 — Gates & regression

### Task 9: Topology, snapshot, and full-suite verification

- [ ] **Step 1: Topology gate.** Run: `npm run topology:verify`. Expected: OK (generated artifacts consistent with tools.js/scope-topology).
- [ ] **Step 2: Chip contract + coverage + schema.** Run: `cd demo_api_server && npx jest --runTestsByPath tests/chipSchemaContract.test.js tests/chipChallengeCoverage.test.js tests/verticalManifest/schema.test.js --testPathIgnorePatterns "/node_modules/"`. Expected: all PASS.
- [ ] **Step 3: UI unit tests.** Run: `cd demo_api_ui && npx jest src/components/agentChrome.test.js`. Expected: PASS.
- [ ] **Step 4: Update e2e screenshot snapshots** that assert the old "MFA" circle (healthcare/retail screenshot specs referenced earlier). Run the screenshot specs; if they diff only on the new marker, refresh their snapshots per the repo's snapshot-update command (`cd demo_api_ui && npx playwright test <spec> --update-snapshots` or the project equivalent). Do NOT blanket-update; inspect each diff is marker-only.
- [ ] **Step 5: Restart the running api-server** so the live demo picks up the new manifests/tools (bind-mount reload): `docker restart ai-demo-api-server`, wait for `/health` healthy.
- [ ] **Step 6: Manual smoke (verify skill).** In each of the 3 gap verticals, confirm the new chip shows the right marker and clicking it drives the expected gate (consent for investment; step-up for retail/sporting). Confirm a previously-tagged vertical (healthcare) shows 👤 on Sensitive records and 👤🔑 on Release my records.
- [ ] **Step 7: Commit any snapshot updates**

```bash
git add demo_api_ui/tests/e2e/**/__snapshots__ 2>/dev/null || true
git commit -m "test(e2e): refresh chip-marker screenshot snapshots" || echo "no snapshot changes"
```

---

## Self-Review notes

- **Spec coverage:** allowlist (T1), schema (T2), marker+plumbing (T3), tagging incl. showcase + banking agentActions (T4), coverage gate (T5), 3 gap tools with topology+snapshot+decision tests (T6-T8), verify gates (T9). Supersede of commit `a6e54e9c5` handled in T4 step 1.
- **Type consistency:** `challenge` values `consent|both|step_up` identical in schema (T2), component map (T3), tags (T4), coverage test (T5). `HitlChipMark({ challenge })` prop matches call sites (T3 step 4).
- **Open item for implementer:** confirm each gap vertical's `index.js` heuristic list needs a routing entry for the new chip message (mirror the vertical's existing write-action heuristic); the chip's `message` must parse to its `tool`. `chipSchemaContract` will fail loudly if it doesn't.
