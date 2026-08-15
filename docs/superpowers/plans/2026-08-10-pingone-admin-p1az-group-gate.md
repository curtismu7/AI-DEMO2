# PingOne Admin group gate via P1AZ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pingOneAdminAccessService.checkAccess` decide PingOne Admin vertical access via a real PingOne Authorize (P1AZ) decision instead of a JS `groups.includes(requiredGroup)` check.

**Architecture:** `checkAccess` still resolves `requiredGroup` and does a live PingOne directory read for the caller's groups (PIP role, unchanged). It computes `inRequiredGroup` from that read, then calls `pingOneAuthorizeService.evaluateMcpToolDelegation({...})` — the already-built, already-deployed Scenario 1 group-policy evaluator other verticals use — and maps its `PERMIT`/`DENY`/`INDETERMINATE`/throw outcome onto the existing `{ allowed, error, status, requiredGroup }` return contract. No route or UI changes.

**Tech Stack:** Node 22, CommonJS, Jest 29.7, `demo_api_server`.

## Global Constraints

- No changes to `routes/adminAgentRoutes.js` — both call sites (lines 49, 120) already consume `{ allowed, error, status, requiredGroup }` and must keep working unmodified.
- Do not turn on `ff_authorize_group_policy` (process-wide flag; would affect banking's tier-ceiling enforcement — see spec's "Why not just flip the flag" section).
- Do not pass a `userGroups` array to `evaluateMcpToolDelegation` — PingOne rejects array-typed `UserGroups` params with `INVALID_VALUE` (documented in `pingOneAuthorizeService.js:708-711`). Only the pre-resolved `requiredGroup` string and `inRequiredGroup` boolean are sent.
- `INDETERMINATE` decisions fail closed (treated as `DENY`), never as `PERMIT`.
- Test convention: `CI=true npm test -- --forceExit --maxWorkers=4` (from worktree, jest needs the ignore-pattern override — see `verify-ai-demo2` skill — plus `--maxWorkers=4` to avoid known worker-contention flake).
- Spec: `docs/superpowers/specs/2026-08-10-pingone-admin-p1az-group-gate-design.md`.

---

## Task 1: Route `checkAccess`'s decision through `evaluateMcpToolDelegation`

**Files:**
- Modify: `demo_api_server/services/pingOneAdminAccessService.js`
- Modify: `demo_api_server/tests/pingOneAdminAccessService.test.js`

**Interfaces:**
- Consumes: `pingOneAuthorizeService.evaluateMcpToolDelegation(opts)` — existing function, `services/pingOneAuthorizeService.js:849`. Signature: takes an object with (at minimum for this use) `userId`, `toolName`, `verticalId`, `requiredGroup`, `inRequiredGroup`; returns `Promise<{ decision: 'PERMIT'|'DENY'|'INDETERMINATE', decisionId, raw, ... }>` or rejects with an `Error` (may carry `.status`/`.code`).
- Produces: `checkAccess({ username, pingOneUserId })` — same signature and return shape as before: `Promise<{ allowed: boolean, error: string|null, status: number, requiredGroup: string|null, username?: string, groups?: string[] }>`. This is consumed by `routes/adminAgentRoutes.js#requirePingOneAdminGroup` (lines 49, 120) — unchanged, not touched by this task.

**Current file for reference** (`demo_api_server/services/pingOneAdminAccessService.js`):

```js
'use strict';

const groupPolicy = require('./groupPolicy');
const membershipService = require('./pingOneGroupMembershipService');

const VERTICAL_ID = 'pingone-admin';
const GROUP_CATEGORY = 'privileged';

async function checkAccess({ username, pingOneUserId }) {
  const requiredGroup = groupPolicy.groupNameForCategory(VERTICAL_ID, GROUP_CATEGORY);
  if (!requiredGroup) {
    return {
      allowed: false,
      error: 'pingone_admin_group_not_configured',
      status: 500,
      requiredGroup: null,
    };
  }
  if (!pingOneUserId || !membershipService.isReady()) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const groups = await membershipService.listUserGroupNamesForVertical(
    pingOneUserId,
    VERTICAL_ID,
  );
  if (!Array.isArray(groups)) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  return {
    allowed: groups.includes(requiredGroup),
    error: groups.includes(requiredGroup) ? null : 'pingone_admin_group_required',
    status: groups.includes(requiredGroup) ? 200 : 403,
    requiredGroup,
    username,
    groups,
  };
}

module.exports = { checkAccess, VERTICAL_ID, GROUP_CATEGORY };
```

Only the final `return` block (after `groups` is resolved) changes — everything above it (the `requiredGroup` not configured branch, and the membership-unavailable branch) is untouched, since those are still 500/503 conditions that must short-circuit before any P1AZ call.

**Deviation from the spec's literal call-shape example:** the spec's illustrative snippet includes `userRole` as a passed field. `checkAccess({ username, pingOneUserId })` has no `userRole` input, and both its call sites (`adminAgentRoutes.js:49,120`) — explicitly out of scope for this change — don't supply one either. `userRole` is omitted from the actual call below rather than threading a new parameter through an out-of-scope file.

- [ ] **Step 1: Update the test file's mocks to add `pingOneAuthorizeService`**

Replace the top of `demo_api_server/tests/pingOneAdminAccessService.test.js` (the `jest.mock` calls and requires) with:

```js
'use strict';

jest.mock('../services/groupPolicy', () => ({
  groupNameForCategory: jest.fn(() => 'pingone-admin'),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(),
  listUserGroupNamesForVertical: jest.fn(),
}));
jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const { checkAccess } = require('../services/pingOneAdminAccessService');

beforeEach(() => {
  jest.clearAllMocks();
  membershipService.isReady.mockReturnValue(true);
});
```

- [ ] **Step 2: Update the "permits" test to mock a PERMIT decision**

Replace the existing `test('permits a live pingone-admin member', ...)` with:

```js
test('permits a live pingone-admin member', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'PERMIT' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: true,
    status: 200,
    requiredGroup: 'pingone-admin',
  });

  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'user-1',
      requiredGroup: 'pingone-admin',
      inRequiredGroup: true,
      verticalId: 'pingone-admin',
    }),
  );
});
```

- [ ] **Step 3: Update the "denies" test to mock a DENY decision**

Replace the existing `test('denies a user outside the live pingone-admin group', ...)` with:

```js
test('denies a user outside the live pingone-admin group', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue([]);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'DENY' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });

  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalledWith(
    expect.objectContaining({ inRequiredGroup: false }),
  );
});
```

- [ ] **Step 4: Add a new test for `INDETERMINATE` failing closed**

Add after the "denies" test:

```js
test('fails closed on an INDETERMINATE PingOne Authorize decision', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue([]);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'INDETERMINATE' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });
});
```

- [ ] **Step 5: Add a new test for `evaluateMcpToolDelegation` throwing**

Add after the `INDETERMINATE` test:

```js
test('fails closed with 503 when PingOne Authorize is unreachable', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockRejectedValue(
    new Error('PingOne Authorize decision endpoint evaluation failed (503): timeout'),
  );

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });
});
```

The existing `test('fails closed when live membership cannot be verified', ...)` test is left as-is — that branch returns before any call to `evaluateMcpToolDelegation`, so it needs no change (the new `jest.mock` for `pingOneAuthorizeService` from Step 1 covers it automatically, unused).

- [ ] **Step 6: Run the test file and confirm the new/changed tests fail**

```bash
cd demo_api_server && CI=true npx jest tests/pingOneAdminAccessService.test.js --forceExit
```

Expected: FAIL — `pingOneAuthorizeService.evaluateMcpToolDelegation` is mocked but `checkAccess` never calls it yet; the "permits"/"denies" tests fail their `toHaveBeenCalledWith` assertions (or their outer `toMatchObject`, since the real code still short-circuits on `groups.includes`).

- [ ] **Step 7: Implement the change in `pingOneAdminAccessService.js`**

Replace the whole file with:

```js
'use strict';

const groupPolicy = require('./groupPolicy');
const membershipService = require('./pingOneGroupMembershipService');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');

const VERTICAL_ID = 'pingone-admin';
const GROUP_CATEGORY = 'privileged';

async function checkAccess({ username, pingOneUserId }) {
  const requiredGroup = groupPolicy.groupNameForCategory(VERTICAL_ID, GROUP_CATEGORY);
  if (!requiredGroup) {
    return {
      allowed: false,
      error: 'pingone_admin_group_not_configured',
      status: 500,
      requiredGroup: null,
    };
  }
  if (!pingOneUserId || !membershipService.isReady()) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const groups = await membershipService.listUserGroupNamesForVertical(
    pingOneUserId,
    VERTICAL_ID,
  );
  if (!Array.isArray(groups)) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const inRequiredGroup = groups.includes(requiredGroup);

  // Decision is made by PingOne Authorize (Scenario 1 group-policy rule),
  // not in JS. inRequiredGroup is a pre-resolved input (the snapshot DSL has
  // no array-contains) — the PDP still decides PERMIT/DENY/INDETERMINATE.
  // Calling evaluateMcpToolDelegation directly (rather than flipping
  // ff_authorize_group_policy) keeps this scoped to this vertical only —
  // see docs/superpowers/specs/2026-08-10-pingone-admin-p1az-group-gate-design.md.
  let decision;
  try {
    ({ decision } = await pingOneAuthorizeService.evaluateMcpToolDelegation({
      userId: pingOneUserId,
      toolName: 'pingone_admin_access',
      verticalId: VERTICAL_ID,
      requiredGroup,
      inRequiredGroup,
    }));
  } catch (err) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const allowed = decision === 'PERMIT';
  return {
    allowed,
    error: allowed ? null : 'pingone_admin_group_required',
    status: allowed ? 200 : 403,
    requiredGroup,
    username,
    groups,
  };
}

module.exports = { checkAccess, VERTICAL_ID, GROUP_CATEGORY };
```

- [ ] **Step 8: Run the test file again and confirm everything passes**

```bash
cd demo_api_server && CI=true npx jest tests/pingOneAdminAccessService.test.js --forceExit
```

Expected: PASS — all 6 tests (3 original + 3 new/updated) green.

- [ ] **Step 9: Run the full BFF suite**

```bash
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
```

Expected: PASS (or the same pre-existing rotating live-integration flakes this suite already has — do not chase those; only investigate failures that mention `pingOneAdminAccessService`, `adminAgentRoutes`, or `pingOneAuthorizeService`).

- [ ] **Step 10: Commit**

```bash
git add demo_api_server/services/pingOneAdminAccessService.js demo_api_server/tests/pingOneAdminAccessService.test.js
git commit -m "$(cat <<'EOF'
fix(admin): decide pingone-admin group gate via PingOne Authorize

checkAccess still does the live PingOne directory read (PIP role) but the
PERMIT/DENY decision now comes from evaluateMcpToolDelegation's Scenario 1
group-policy rule, not a JS groups.includes check. Calls the evaluator
directly rather than flipping the process-wide ff_authorize_group_policy
flag, per the UC9 precedent in useCaseDemoBehaviors.js.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Live-verify against the real PingOne Authorize decision endpoint

This task requires the running Docker stack and a live PingOne admin session — it cannot be done by an isolated subagent without access to the browser/deployed environment. If you are an autonomous worker without that access, stop after Task 1 and hand this task back for manual/interactive execution.

**Files:** none (verification only), plus optionally `REGRESSION_PLAN.md` (§4 log entry — exempt from the worktree-write restriction, see root `CLAUDE.md`).

- [ ] **Step 1: Deploy the change**

Follow this repo's standing rule: deploy-live after every merge, targeted restart only (see project memory `feedback-deploy-live-after-every-merge`). For the BFF specifically: pull the merged change into the main checkout, then restart (not full-rebuild) the `demo-api-server` container, e.g.:

```bash
docker compose restart demo-api-server
```

- [ ] **Step 2: Confirm the signed-in admin currently has the required group**

Ask a live PingOne MCP tool call (or the PingOne admin console) for the `pingone-admin` vertical's required group name (whatever `groupNameForCategory('pingone-admin', 'privileged')` resolves to in the live manifest) and confirm the demo admin user is currently a member.

- [ ] **Step 3: Exercise the admin agent and confirm PERMIT**

From the `/admin` console, run any PingOne Admin demo step (e.g. ADMIN1 "List applications"). Confirm it succeeds (200, real data returned).

Then check the BFF logs for the `[BFF→P1AZ]` request/response lines emitted by `_postDecisionEndpoint` (`services/pingOneAuthorizeService.js:463-475`):

```bash
docker logs ai-demo-api-server --since 5m 2>&1 | grep -A1 "BFF→P1AZ"
```

Confirm the logged `REQUEST` parameters include `RequiredGroup` and `InRequiredGroup: true`, and the `RESPONSE` reflects a `PERMIT`-equivalent effect from the real decision endpoint (not a `policy_not_found` or unexpected shape).

- [ ] **Step 4: Remove the group and confirm real DENY**

Remove the demo admin user from the required group in PingOne (console or Management API), then immediately (no new login, no new token) run the same admin demo step again. Confirm it now returns `403 pingone_admin_group_required`.

Check the `[BFF→P1AZ]` log lines again: confirm `InRequiredGroup: false` was sent and the decision endpoint's `RESPONSE` reflects an actual `DENY` effect (not the BFF short-circuiting before ever calling P1AZ, and not a `policy_not_found`/`INDETERMINATE` masquerading as the expected DENY — if the policy doesn't recognize `ToolName: 'pingone_admin_access'`, this step is where that surfaces per the spec's "Open risk" section).

If the decision comes back `policy_not_found` or unexpectedly `INDETERMINATE` for a reason unrelated to group membership: **stop here** — this means the deployed policy needs a rule adjustment (out of scope for this plan; the fix is picking a different `toolName`/attribute value, not re-architecting `checkAccess`, per the spec).

- [ ] **Step 5: Add the group back and confirm PERMIT again**

Re-add the demo admin user to the required group, run the demo step once more, confirm `200`/success with no new login.

- [ ] **Step 6: Add a `REGRESSION_PLAN.md` §4 entry**

Prepend (reverse-chronological, newest first) a new entry after `## §4 — Bug Fix Log` / `Reverse-chronological, newest first.` and before the existing `### 2026-08-10 — MCP_AUTH_DISABLED...` entry:

```markdown
### 2026-08-10 — PingOne Admin group gate was a BFF check, not a PingOne Authorize decision

**Files changed:** `demo_api_server/services/pingOneAdminAccessService.js`, its test

**What was broken:** `checkAccess` decided PERMIT/DENY itself in JS
(`groups.includes(requiredGroup)`) after a live PingOne directory read. Real
and demoable (live read at decision time), but not a PingOne Authorize
decision — see `docs/superpowers/specs/2026-08-10-admin-demo-stories-design.md`'s
"What the gate actually is" section, which named this gap and deferred fixing
it.

**What was fixed:** `checkAccess` now calls `pingOneAuthorizeService.evaluateMcpToolDelegation`
directly (Scenario 1 group-policy rule, already deployed and used by other
verticals) instead of deciding in JS. Called directly rather than via the
process-wide `ff_authorize_group_policy` flag, per the UC9 precedent
(`useCaseDemoBehaviors.js`) — avoids affecting banking's tier-ceiling
enforcement, which shares that flag.

**Do not break:** `routes/adminAgentRoutes.js`'s two `checkAccess` call sites
(lines 49, 120) must keep receiving the same `{ allowed, error, status,
requiredGroup }` shape — this fix does not touch that file.

**Verify:** `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`;
live: remove the group → real `403` from the decision endpoint (`[BFF→P1AZ]`
log lines) → add it back → `200`, no new login.
```

- [ ] **Step 7: Commit the REGRESSION_PLAN.md update**

```bash
git add REGRESSION_PLAN.md
git commit -m "$(cat <<'EOF'
docs: log the pingone-admin P1AZ group-gate fix in REGRESSION_PLAN §4

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
