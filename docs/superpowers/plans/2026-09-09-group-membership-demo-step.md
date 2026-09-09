# Group-membership demo step (UC9 / UC21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PingOne group the thing that decides UC9 and UC21, identically in all 12 eligible verticals, so both cards produce the outcome they declare.

**Architecture:** A declarative `requiresGroup: 'in' | 'out'` catalog lever (mirroring the existing `stepUpMethod` precedent) is read at Run time and armed through the **existing** `POST /api/groups/membership/toggle`, which writes to PingOne and reads membership back. Each eligible vertical's sensitive tool is re-pointed from `privileged` to a new `premiumTier` gate. Neither use case involves a dollar amount, which is what removes the threshold and seed-state collisions.

**Tech Stack:** Node 22 CommonJS (BFF), React 19 + Vitest (UI), Jest + supertest (server), PingOne Management API via `pingOneGroupMembershipService` / `pingOneGroupProvisionService`.

**Spec:** `docs/superpowers/specs/2026-09-09-group-membership-demo-step.md`

## Global Constraints

- **Worktree only.** A hard-block hook denies `Write`/`Edit` in the main checkout. Stage explicitly (`git add <paths>`), never `git add -A`.
- **`CI=true` is mandatory** for every jest run. Do **not** pass `--testPathIgnorePatterns` — it replaces the ignore list and will run live-stack suites.
- **Emoji allowlist** (`REGRESSION_PLAN.md` §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚 🔧 ☀️ 🌙` plus the product icon set. Everything else is plain text.
- **UI HTTP goes through `apiClient`** — never raw `axios` in a component.
- **Never conclude from a piped command's exit status.** Redirect to a file and read it, or check `${PIPESTATUS[0]}`.
- **Eligible verticals (12):** banking, sporting-goods, healthcare, retail, abercrombie-fitch, investment, manufacturing, government, university, workforce, admin, airlines.
- **Ineligible (3):** `admin-console`, `oauth-teaching` (no `groups` block), `pingone-admin` (empty `restrictedTools`, demoUser not a member).
- **Airlines uses `sensitive_passenger_record`** (decision #2).
- **UC9 declares `DENY_403`** (decision #4). `EXPECTED_OUTCOME_FAMILY` folds it to family `DENY`, so this is equivalent to `DENY` for `computeVerdict` and only differs in what a reader sees.

---

### Task 1: Make `premiumTier` the gate in all 12 manifests

**Files:**
- Modify: `demo_api_server/config/verticals/<v>/manifest.json` — 12 files
- Test: `demo_api_server/tests/groupPolicy.premiumTierGate.test.js` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: every eligible manifest has `groups.categories.premiumTier`, its single `restrictedTools` entry maps to `"premiumTier"`, and `demoUser` is a member of `premiumTier`. Task 2 and Task 3 rely on `groupPolicy.groupNameForCategory(vertical, 'premiumTier')` resolving for all 12.

**Group naming — DECIDED: one group per vertical.** The code addresses groups by
**category key** (`groupNameForCategory(verticalId, 'premiumTier')`), so the name
is invisible to the lever — but it decides the **blast radius of a UC9 run**.

A shared group (the way `AI_Demo_Privileged` works today) means toggling the demo
user OUT in one vertical removes them from the single group behind all 12, so the
sensitive tool denies **everywhere** until restore runs — and UC2/UC37 break in
every vertical, not just the one being demoed. Per-vertical groups contain the
denial to the vertical you ran it in.

Banking's existing `Banking_PremiumTier` is the naming template and needs **no
change**. Use `<PascalCaseVertical>_PremiumTier`:

| vertical | group name | vertical | group name |
|---|---|---|---|
| banking | `Banking_PremiumTier` (exists) | government | `Government_PremiumTier` |
| sporting-goods | `SportingGoods_PremiumTier` | university | `University_PremiumTier` |
| healthcare | `Healthcare_PremiumTier` | workforce | `Workforce_PremiumTier` |
| retail | `Retail_PremiumTier` | manufacturing | `Manufacturing_PremiumTier` |
| abercrombie-fitch | `AbercrombieFitch_PremiumTier` | admin | `Admin_PremiumTier` |
| investment | `Investment_PremiumTier` | airlines | `Airlines_PremiumTier` |

`POST /api/groups/provision` creates all of them from the manifests, so 12 groups
cost no more effort than 1.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/groupPolicy.premiumTierGate.test.js`:

```js
'use strict';
const { verticalManifest } = require('../services/verticalManifest');

const ELIGIBLE = [
  'banking', 'sporting-goods', 'healthcare', 'retail', 'abercrombie-fitch',
  'investment', 'manufacturing', 'government', 'university', 'workforce',
  'admin', 'airlines',
];

describe('premiumTier is the gate in every eligible vertical', () => {
  beforeAll(() => { verticalManifest.init(); });

  test.each(ELIGIBLE)('%s declares premiumTier and gates its sensitive tool on it', (v) => {
    const groups = verticalManifest.resolver.resolve(v)?.groups;
    expect(groups).toBeTruthy();
    expect(groups.categories.premiumTier).toBeTruthy();
    expect(typeof groups.categories.premiumTier.name).toBe('string');
    expect(groups.categories.premiumTier.name).toMatch(/_PremiumTier$/);

    const restricted = Object.entries(groups.restrictedTools || {});
    expect(restricted.length).toBeGreaterThan(0);
    for (const [tool, category] of restricted) {
      expect(`${tool}:${category}`).toBe(`${tool}:premiumTier`);
    }
  });

  // Per-vertical, not shared: a shared group would make a UC9 run in one vertical
  // deny the sensitive tool in all twelve until restore ran.
  test('every eligible vertical has its OWN premiumTier group', () => {
    const names = ELIGIBLE.map(
      (v) => verticalManifest.resolver.resolve(v).groups.categories.premiumTier.name,
    );
    expect(new Set(names).size).toBe(ELIGIBLE.length);
  });

  // Load-bearing: sensitive_membership_details is also UC2/UC37's primaryTool.
  // Re-pointing the gate without seeding membership makes those A2A cards deny.
  test.each(ELIGIBLE)('%s seeds demoUser into premiumTier', (v) => {
    const groups = verticalManifest.resolver.resolve(v)?.groups;
    expect(groups.userMemberships.demoUser).toContain('premiumTier');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd demo_api_server && CI=true npx jest tests/groupPolicy.premiumTierGate.test.js --forceExit
```

Expected: FAIL — 11 verticals have no `premiumTier` category, and all 12 map their restricted tool to `"privileged"`.

- [ ] **Step 3: Edit the 12 manifests**

For each eligible vertical, in `groups`:

1. Add to `categories` (banking already has this — do not touch banking's):

```json
"premiumTier": {
  "name": "<PascalCaseVertical>_PremiumTier",
  "description": "Entitlement tier that gates this vertical's sensitive tool (UC21 permits, UC9 denies). Scoped to this vertical so a UC9 run does not deny the other eleven."
}
```

Use the exact name from the table above — do not reuse one name across verticals,
which is the whole point of the decision.

2. Change the `restrictedTools` value from `"privileged"` to `"premiumTier"`. Airlines has two entries — re-point **both**, since the tool the chip uses (`sensitive_passenger_record`) and its sibling should not disagree about which tier gates them.

3. Add `"premiumTier"` to `userMemberships.demoUser` (and to `demoAdmin`, matching banking's shape). Leave `demoDelegate` alone.

Leave `privileged` defined and untouched everywhere — it simply stops being this tool's gate.

- [ ] **Step 4: Run the test and the per-vertical suites**

```bash
cd demo_api_server && CI=true npx jest tests/groupPolicy.premiumTierGate.test.js --forceExit
```

Expected: PASS (25 assertions).

```bash
cd demo_api_server && CI=true npx jest tests/stepVerification --forceExit > /tmp/sv.log 2>&1; echo "exit=$?"; tail -6 /tmp/sv.log
```

Expected: exit 0. These 16 suites are the cross-vertical gate.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/verticals/*/manifest.json demo_api_server/tests/groupPolicy.premiumTierGate.test.js
git commit -m "feat(groups): gate each vertical's sensitive tool on premiumTier"
```

---

### Task 2: Catalog lever and honest UC9 / UC21 entries

**Files:**
- Modify: `demo_api_server/config/useCases.js`
- Test: `demo_api_server/tests/useCases.groupRequirement.test.js` (create)

**Interfaces:**
- Consumes: Task 1's `premiumTier` gate.
- Produces: `getUseCaseGroupRequirement(slug) -> 'in' | 'out' | null`, exported from `demo_api_server/config/useCases.js`. Task 3 imports it by that exact name.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/useCases.groupRequirement.test.js`:

```js
'use strict';
const {
  USE_CASES, resolveUseCase, getUseCaseGroupRequirement,
} = require('../config/useCases');

const ELIGIBLE = [
  'banking', 'sporting-goods', 'healthcare', 'retail', 'abercrombie-fitch',
  'investment', 'manufacturing', 'government', 'university', 'workforce',
  'admin', 'airlines',
];

test('the lever reads in/out and ignores anything else', () => {
  expect(getUseCaseGroupRequirement('entitlement-tiered-capability')).toBe('in');
  expect(getUseCaseGroupRequirement('group-entitlement-check')).toBe('out');
  expect(getUseCaseGroupRequirement('delegated-access-with-proof')).toBeNull();
  expect(getUseCaseGroupRequirement(null)).toBeNull();
});

test('UC9 declares DENY_403 and UC21 declares PERMIT', () => {
  expect(USE_CASES.find((u) => u.id === 'UC9').expectedOutcome).toBe('DENY_403');
  expect(USE_CASES.find((u) => u.id === 'UC21').expectedOutcome).toBe('PERMIT');
});

// The whole point: no amount, so no threshold gate can pre-empt the group
// decision and no payment can consume the single seeded bill UC22 needs.
test.each(ELIGIBLE)('%s: neither trigger carries a dollar amount', (v) => {
  for (const id of ['UC9', 'UC21']) {
    const uc = USE_CASES.find((u) => u.id === id);
    const text = (resolveUseCase(id, v) || uc).trigger.text;
    expect(text).not.toMatch(/\$\s?\d/);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd demo_api_server && CI=true npx jest tests/useCases.groupRequirement.test.js --forceExit
```

Expected: FAIL — `getUseCaseGroupRequirement is not a function`.

- [ ] **Step 3: Add the accessor**

In `demo_api_server/config/useCases.js`, beside `getUseCaseStepUpMethod`:

```js
/**
 * Per-use-case group requirement. Mirrors getUseCaseStepUpMethod: one catalog
 * field the Run path reads to arm state before firing the chip.
 * @returns {'in'|'out'|null}
 */
function getUseCaseGroupRequirement(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const uc = USE_CASES.find((u) => u.useCaseId === slug);
  return (uc && (uc.requiresGroup === 'in' || uc.requiresGroup === 'out'))
    ? uc.requiresGroup
    : null;
}
```

Add `getUseCaseGroupRequirement` to the `module.exports` list.

- [ ] **Step 4: Rewrite the UC9 and UC21 entries**

Follow the existing per-vertical convention (`READ_PRIMARY_TOOL_BY_VERTICAL` /
`A2A_PRIMARY_TOOL_BY_VERTICAL` + `chipOverrides`, `useCases.js:88-260`). Add:

```js
/** The group-gated sensitive tool per vertical — mirrors each manifest's
 *  restrictedTools entry, which Task 1 re-pointed to premiumTier. Duplicates
 *  across verticals are deliberate (isolation over DRY): editing one vertical's
 *  entry must never change another's. */
const GROUP_TOOL_BY_VERTICAL = {
  banking: 'get_sensitive_account_details',
  'sporting-goods': 'sensitive_membership_details',
  healthcare: 'sensitive_patient_records',
  retail: 'sensitive_order_history',
  'abercrombie-fitch': 'sensitive_order_history',
  investment: 'sensitive_holdings',
  manufacturing: 'sensitive_supplier_contract',
  government: 'sensitive_tax_record',
  university: 'sensitive_student_finance',
  workforce: 'sensitive_payroll_details',
  admin: 'sensitive_customer_identity',
  airlines: 'sensitive_passenger_record',
};

/** Verticals with no group gate — declared, not silently skipped, same shape as
 *  REQUEST_ONLY_NOT_APPLICABLE (useCases.js:187). */
const GROUP_GATE_NOT_APPLICABLE = {
  'admin-console': 'No groups block in the manifest — nothing to gate on.',
  'oauth-teaching': 'No groups block in the manifest — nothing to gate on.',
  'pingone-admin': 'Declares a privileged category but no restrictedTools, and demoUser is not a member.',
};
```

On UC21 (`entitlement-tiered-capability`): add `requiresGroup: 'in'`, keep
`expectedOutcome: 'PERMIT'`, delete `perVertical: AMOUNT_PER_VERTICAL(600)` and
the `match` amount band, and give it a `perVertical` built from
`GROUP_TOOL_BY_VERTICAL` via `chipOverrides` + `withPrimaryTool`.

On UC9 (`group-entitlement-check`): add `requiresGroup: 'out'`, set
`expectedOutcome: 'DENY_403'`, same treatment.

**Trigger text — do not invent phrases.** Each trigger must actually parse to
that vertical's sensitive tool through the vertical's own heuristics, and must be
distinct from UC2's phrase (`show my sensitive membership details` in
sporting-goods), which already routes to the same tool for the A2A cards. Reuse
the phrasing the vertical already uses for its sensitive read and differentiate
UC9/UC21 by wording, e.g. `check my tier access` (UC21) and
`check my group entitlement` (UC9). **Whatever you choose, step 5's offline
trigger audit is the gate — it must print `all triggers match` before you
continue.**

Per-vertical tools (Task 1 pinned these): banking `get_sensitive_account_details`, sporting-goods `sensitive_membership_details`, healthcare `sensitive_patient_records`, retail and abercrombie-fitch `sensitive_order_history`, investment `sensitive_holdings`, manufacturing `sensitive_supplier_contract`, government `sensitive_tax_record`, university `sensitive_student_finance`, workforce `sensitive_payroll_details`, admin `sensitive_customer_identity`, airlines `sensitive_passenger_record`.

Declare the 3 ineligible verticals N/A the way `REQUEST_ONLY_NOT_APPLICABLE` (`useCases.js:187`) does it — a named map with a reason string, not a silent omission.

- [ ] **Step 5: Run the new test plus the whole catalog gate**

First, the offline trigger audit (seconds, no stack needed) — it proves every
chip phrase in every vertical still parses to an intent:

```bash
cd demo_api_server && node -e "
const {parseHeuristic,resolveVerticalCtx}=require('./services/nlIntentParser');
const {USE_CASES,VERTICALS,resolveUseCase}=require('./config/useCases.js');
let f=[];for(const v of VERTICALS){const c=resolveVerticalCtx(v);for(const u of USE_CASES){const t=(resolveUseCase(u.id,v)||u).trigger;if(!t||t.type!=='chip')continue;const r=parseHeuristic(t.text,v,c,{});if(!r||r.kind==='none')f.push(v+' '+u.id+' \"'+t.text+'\"')}}
console.log(f.length?f.join('\n'):'all triggers match');"
```

Expected: `all triggers match`.

```bash
cd demo_api_server && CI=true npx jest tests/useCases.groupRequirement.test.js tests/useCaseConformance.test.js tests/useCases.primaryTool.test.js tests/useCases.chipCompletes.test.js tests/useCaseMatchReachability.test.js tests/useCases.scenarioDistinctness.test.js tests/useCases.verticalChipCoverage.test.js tests/useCases.secondaryTools.test.js --forceExit > /tmp/cat.log 2>&1; echo "exit=$?"; tail -6 /tmp/cat.log
```

Expected: exit 0. `useCases.chipCompletes` is the specific proof that removing the amounts fixed the UC22 collision.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/config/useCases.js demo_api_server/tests/useCases.groupRequirement.test.js
git commit -m "feat(use-cases): group-requirement lever; UC9/UC21 decided by group, not amount"
```

---

### Task 3: Arm membership at Run time, gated on `verified`

**Files:**
- Modify: `demo_api_ui/src/utils/requiredDemoFlags.js`
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js:782-797` (inside `handleRun`)
- Modify: `demo_api_server/services/demoStepPrerequisites.js`
- Test: `demo_api_ui/src/utils/__tests__/groupRequirement.test.js` (create)

**Interfaces:**
- Consumes: `getUseCaseGroupRequirement` (Task 2), `premiumTier` gate (Task 1).
- Produces: `groupRequirementForUseCase(uc) -> 'in' | 'out' | null` exported from `demo_api_ui/src/utils/requiredDemoFlags.js`. Task 4 imports it by that name.

**The critical difference from flag arming.** The existing flag arming at line 788 deliberately swallows failure (`catch { console.warn }`) — a flag that fails to arm still lets the run proceed. **Group arming must not.** If the toggle did not verifiably take effect, the chip's verdict is meaningless, so the run aborts and says why.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/utils/__tests__/groupRequirement.test.js`:

```js
import { groupRequirementForUseCase } from '../requiredDemoFlags';

test('mirrors the server lever', () => {
  expect(groupRequirementForUseCase({ useCaseId: 'entitlement-tiered-capability', requiresGroup: 'in' })).toBe('in');
  expect(groupRequirementForUseCase({ useCaseId: 'group-entitlement-check', requiresGroup: 'out' })).toBe('out');
  expect(groupRequirementForUseCase({ useCaseId: 'delegated-access-with-proof' })).toBeNull();
  expect(groupRequirementForUseCase(null)).toBeNull();
  expect(groupRequirementForUseCase({ requiresGroup: 'sideways' })).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd demo_api_ui && npx vitest run src/utils/__tests__/groupRequirement.test.js
```

Expected: FAIL — `groupRequirementForUseCase is not a function`.

- [ ] **Step 3: Add the client mirror**

In `demo_api_ui/src/utils/requiredDemoFlags.js` (kept in sync with `demo_api_server/services/demoStepPrerequisites.js`, per that file's stated contract):

```js
/**
 * Client mirror of getUseCaseGroupRequirement (demo_api_server/config/useCases.js).
 * @returns {'in'|'out'|null}
 */
export function groupRequirementForUseCase(uc) {
  if (!uc || typeof uc !== 'object') return null;
  return (uc.requiresGroup === 'in' || uc.requiresGroup === 'out') ? uc.requiresGroup : null;
}
```

- [ ] **Step 4: Arm membership in `handleRun`**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, directly after the existing flag-arming block (which ends at line 797) and before `apiClient.post('/api/use-cases/demo/run', ...)`:

```js
// Group-gated use cases (UC9/UC21) need the demo user really in or out of the
// vertical's premiumTier group before the chip fires. Unlike flag arming above,
// this MUST block: the endpoint reads membership back from PingOne precisely so
// a write that did nothing cannot report success, and a chip fired against
// unverified membership produces a verdict that proves nothing.
const groupReq = groupRequirementForUseCase(uc);
if (groupReq) {
  try {
    const { data: m } = await apiClient.post(
      '/api/groups/membership/toggle',
      { inGroup: groupReq === 'in', category: 'premiumTier' },
      { _noAuthBanner: true },
    );
    if (m?.verified !== true || m?.inGroup !== (groupReq === 'in')) {
      throw new Error(`membership not verified (wanted inGroup=${groupReq === 'in'}, got ${m?.inGroup})`);
    }
  } catch (e) {
    const detail = e?.response?.data?.message || e.message;
    setChipRun({ id: uc.id, state: 'error', message: `Could not set group membership: ${detail}` });
    return;
  }
}
```

Add `groupRequirementForUseCase` to the existing `requiredDemoFlags` import at line 40.

- [ ] **Step 5: Report satisfiability server-side**

In `demo_api_server/services/demoStepPrerequisites.js`, inside `checkChipPrerequisites`, before the `return`:

```js
  // A group-gated chip needs live PingOne worker credentials to move membership;
  // without them the toggle 503s and the run cannot demonstrate what it claims.
  if (uc && (uc.requiresGroup === 'in' || uc.requiresGroup === 'out')) {
    const groupPolicy = require('./groupPolicy');
    if (!groupPolicy.isEnabled(cfg)) {
      errors.push('ff_authorize_group_policy is off, so group membership decides nothing');
    }
    if (!groupPolicy.groupNameForCategory(vertical, 'premiumTier')) {
      errors.push(`vertical '${vertical}' declares no premiumTier group`);
    }
  }
```

- [ ] **Step 6: Run the UI tests and the build gate**

```bash
cd demo_api_ui && npx vitest run src/utils/__tests__/groupRequirement.test.js && npm run build > /tmp/build.log 2>&1; echo "exit=$?"; tail -3 /tmp/build.log
```

Expected: test PASS, build exit 0.

```bash
cd demo_api_server && CI=true npx jest tests/stepVerification --forceExit > /tmp/sv2.log 2>&1; echo "exit=$?"; tail -6 /tmp/sv2.log
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/utils/requiredDemoFlags.js demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_server/services/demoStepPrerequisites.js demo_api_ui/src/utils/__tests__/groupRequirement.test.js
git commit -m "feat(launcher): arm group membership before a group-gated run, gated on verified"
```

---

### Task 4: Restore membership — after the run, and on session end

**Files:**
- Create: `demo_api_ui/src/utils/restoreGroupMembership.js`
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js` (call after the run resolves)
- Modify: `demo_api_server/routes/auth.js` (logout path)
- Test: `demo_api_ui/src/utils/__tests__/restoreGroupMembership.test.js` (create)

**Interfaces:**
- Consumes: `groupRequirementForUseCase` (Task 3).
- Produces: `restoreGroupMembership()` — idempotent, safe to call when membership is already correct.

**Why the backstop is the point.** A post-run restore misses exactly the case that strands the shared cluster: the browser closed, the session expired, or an error thrown between toggle and restore. `sensitive_membership_details` is UC2's and UC37's tool, so a stranded `out` breaks those cards for everyone, and `/group-policy` reads red.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/utils/__tests__/restoreGroupMembership.test.js`:

```js
import { vi } from 'vitest';
import apiClient from '../../services/apiClient';
import { restoreGroupMembership } from '../restoreGroupMembership';

vi.mock('../../services/apiClient', () => ({
  default: { post: vi.fn() },
}));

beforeEach(() => { apiClient.post.mockReset(); });

test('restores the demo user into premiumTier', async () => {
  apiClient.post.mockResolvedValue({ data: { verified: true, inGroup: true } });
  await restoreGroupMembership();
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/groups/membership/toggle',
    { inGroup: true, category: 'premiumTier' },
    expect.anything(),
  );
});

// Restore runs on paths that are already failing (abandoned run, logout). It must
// never throw a second error over the first one.
test('never throws, even when the toggle fails', async () => {
  apiClient.post.mockRejectedValue(new Error('503 live_lookup_unavailable'));
  await expect(restoreGroupMembership()).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd demo_api_ui && npx vitest run src/utils/__tests__/restoreGroupMembership.test.js
```

Expected: FAIL — cannot resolve `../restoreGroupMembership`.

- [ ] **Step 3: Implement it**

Create `demo_api_ui/src/utils/restoreGroupMembership.js`:

```js
import apiClient from '../services/apiClient';

/**
 * Put the demo user back into the vertical's premiumTier group.
 *
 * Idempotent, and deliberately swallows every error: this runs on paths that are
 * already unhappy (an abandoned run, a logout), and a throw here would mask the
 * original failure. A stranded `out` state breaks UC2/UC37 — which share the
 * gated tool — and reddens /group-policy for everyone on a shared cluster, so
 * best-effort restore beats no restore.
 */
export async function restoreGroupMembership() {
  try {
    await apiClient.post(
      '/api/groups/membership/toggle',
      { inGroup: true, category: 'premiumTier' },
      { _noAuthBanner: true },
    );
  } catch (e) {
    console.warn('[restoreGroupMembership] could not restore membership:', e.message);
  }
}
```

- [ ] **Step 4: Call it after a group-gated run**

In `UseCaseLauncherPage.js`, in the `handleRun` promise chain, restore whenever `groupReq === 'out'` — on both the success and the failure path, so an error between toggle and navigation cannot strand it. Import from `../utils/restoreGroupMembership`.

- [ ] **Step 5: Add the session-end backstop**

In `demo_api_server/routes/auth.js`, on the logout path, **before** the session is
destroyed (the user id and vertical are read from it):

```js
// Backstop for an abandoned group-gated run. The client restores membership
// after a UC9 run, but a closed tab or a thrown error between toggle and restore
// strands the demo user OUTSIDE premiumTier — which breaks UC2/UC37 (they share
// the gated tool) and reddens /group-policy for everyone on a shared cluster.
// Best-effort only: logout must never fail because a group write failed.
try {
  const groupPolicy = require('../services/groupPolicy');
  const pingOneGroupMembershipService = require('../services/pingOneGroupMembershipService');
  const verticalId = req.session?.activeVertical || 'banking';
  const groupName = groupPolicy.groupNameForCategory(verticalId, 'premiumTier');
  if (groupName && pingOneGroupMembershipService.isReady()) {
    await pingOneGroupMembershipService.setUserGroupMembership({
      username: req.session?.user?.username || null,
      pingOneUserId: req.session?.user?.id || null,
      groupName,
      inGroup: true,
    });
  }
} catch (err) {
  console.warn('[auth] premiumTier restore on logout failed:', err.message);
}
```

Confirm the session field naming against the surrounding handler before pasting —
`resolveVerticalId(req)` in `routes/groupMembership.js` is the canonical reader if
`req.session.activeVertical` is not how this route already resolves it.

- [ ] **Step 6: Run the tests**

```bash
cd demo_api_ui && npx vitest run src/utils/__tests__/ && npm run build > /tmp/build2.log 2>&1; echo "exit=$?"; tail -3 /tmp/build2.log
```

Expected: tests PASS, build exit 0.

```bash
cd demo_api_server && CI=true npx jest tests/auth --forceExit > /tmp/auth.log 2>&1; echo "exit=$?"; tail -6 /tmp/auth.log
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/utils/restoreGroupMembership.js demo_api_ui/src/utils/__tests__/restoreGroupMembership.test.js demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_server/routes/auth.js
git commit -m "feat(groups): restore premiumTier membership after a run and on session end"
```

---

### Task 5: Provision the groups and verify live

**Files:** none — this task changes no code.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Provision the new groups in PingOne**

Signed in as an admin, `POST /api/groups/provision` with an empty body to cover every vertical. This runs `provisionVerticalGroupsFromManifest` and needs no bootstrap. **Until this runs, every re-pointed tool denies for want of a group that does not exist yet** — which looks exactly like a broken feature.

- [ ] **Step 2: Verify the pair in Super Sports**

Run UC21, then UC9, in sporting-goods. Expected: UC21 `verified` (PERMIT), UC9 `denied-as-expected` (the `DENY_403` family). Confirm the proof strip renders a verdict for both.

- [ ] **Step 3: Verify the regression that Task 1 risks**

Run **UC2 and UC37** in sporting-goods — they share `sensitive_membership_details` with UC9/UC21. Expected: both still `verified`. If either denies, `demoUser` was not seeded into `premiumTier` (Task 1, step 3) or the groups were not provisioned (step 1 above).

- [ ] **Step 4: Verify restore, including the abandoned-run path**

After the UC9 run, confirm membership is back (`GET /api/groups/membership`). Then start a UC9 run and close the tab before it finishes; log out; confirm membership is restored by the backstop.

- [ ] **Step 5: Confirm the board still reads correctly**

Load `/group-policy`. Every row should read PERMIT for a restored user. Nothing on that page was changed by this work, so a red row means membership is stranded, not that the board broke.
