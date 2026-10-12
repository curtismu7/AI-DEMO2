# Bootstrap Hosted-Access Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `setup:fresh` produce a complete hosted-access environment — sign-in app, groups, `groups` claim, invite→approval group wiring — so no console steps are ever needed and invited users can actually sign in.

**Architecture:** Extend `pingoneProvisionService.js` with idempotent ensure-steps following its existing step contract (`steps.push({ step, icon, message })`, ✅/⚠️/❌ icons), mirror them in `bootstrapPingOne.js`'s `PHASE_GROUPS`, and add small wiring/log changes in the BFF. Task 1 is standalone-shippable (invite flow group wiring + denial logging); Tasks 2–4 are the bootstrap mirroring.

**Tech Stack:** Node.js (demo_api_server), PingOne Management API via the existing worker-token client (`makeRequest`), Jest (supertest + unit), bash (deploy.sh).

**Spec:** `docs/superpowers/specs/2026-10-12-bootstrap-hosted-access-design.md` (spike-resolved; read together with this plan)

## Global Constraints

- PingOne SPEL value is exactly `${user.memberOfGroupIDs}` (copied from the live app mapping) — never `memberOfGroups`, `user.groups`, or names variant.
- Group UUIDs to use at runtime come from env: `HOSTED_ACCESS_USER_GROUP_ID` (approved), `HOSTED_ACCESS_PARTIAL_GROUP_ID` (pending). Never hardcode `4ceb747c-…` in source.
- The worker can WRITE memberships via `POST /environments/{env}/users/{id}/memberOfGroups` body `{"id": groupId}` (verified 201) but some membership READS 403 or return empty — success checks use the POST 201 response body, never read-back.
- `addTokenClaim` in `pingoneProvisionService.js:3715` is a documented no-op — do not route claims through it; claims ride `POST /applications/{appId}/attributes`.
- Application attribute mappings are idempotent-by-name: a POST of an existing name fails with `INVALID_DATA` "already exists" — check-then-create.
- New deps: none. New files: keep to the ones listed below.
- Repo commit style: conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`), message ends with the Claude Code attribution line.
- Test commands: server `cd demo_api_server && npx jest <file>`; UI `cd demo_api_ui && node scripts/run-vitest-with-memory-guard.mjs run <file>`. Full server suite has ~6 environmental failures (PingFederate-unreachable etc.) — run targeted files, not the whole suite.

## Review Focus

1. **Claim mapping present but token missing `groups`** (silently wrong SPIPEL value or scope restriction) — Task 4's bootstrap must POST the mapping with exactly the live value; a future reader "simplifying" to `memberOfGroupNames` breaks the UUID comparison silently. Pinned by Task 4's literal-value test.
2. **Read-back success checks** — code that verifies a membership add via `GET …/memberOfGroups` will false-negative (empty 200 right after a 201). Pinned by Task 1's test asserting no read-back occurs.
3. **Re-invite of an already-approved user demoting them to pending** — Task 1 adds pending-group wiring to the invite path; if it also REMOVES the complete group (or approval's cleanup runs later), a working user loses access. Pinned by Task 1's test.
4. **Bootstrap non-idempotence across runs** — each phase step must tolerate "already exists" on every object (app, groups, attribute mapping). Pinned by Task 4's run-twice unit test.
5. **Gate denials invisible** — no log means locked-out humans with no evidence. Pinned by Task 1's test on the deny path.

---

### Task 1: Invite flow groups users + gate denials get logged (standalone-shippable)

**Files:**
- Modify: `demo_api_server/routes/demoProvisioning.js` (send-invite handler, ~line 296–350)
- Modify: `demo_api_server/services/hostedAccessPolicy.js` (denied() path, ~line 100–140)
- Test: `demo_api_server/tests/sendInvite.route.test.js`
- Test: `demo_api_server/src/__tests__/hostedAccessGate.test.js`

**Interfaces:**
- Consumes: `pingOneManagementService.addUserToGroup(userId, groupId)` (exists, `pingoneManagementService.js:480`), env `HOSTED_ACCESS_PARTIAL_GROUP_ID` (present in `.env:183`).
- Produces: send-invite response unchanged (`{ userId, invite, nativeEmail, registrationUrl }`); new side effect only. New export `__setHostedPolicyLoggerForTest(fn)` is NOT added — the deny-log test asserts via the mocked `logger.warn` module.

- [ ] **Step 1: Write failing tests — invite adds user to pending group**

Add to `demo_api_server/tests/sendInvite.route.test.js` (existing mocks at top; add one mock):

```js
// alongside the other jest.mock blocks at the top of the file
jest.mock('../services/pingoneManagementService', () => ({
  managementService: {
    addUserToGroup: jest.fn().mockResolvedValue({ success: true }),
    getUser: jest.fn().mockResolvedValue({ success: true, user: { id: 'user-1' } }),
  },
}));

// in the describe block, after the 'native email fires despite SMS failure' test
test('invite adds the provisioned user to the pending hosted-access group', async () => {
  process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID = 'partial-group-1';
  const { managementService } = require('../services/pingoneManagementService');
  const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
    .post('/api/demo/send-invite').send({ email: 'grouped@pingidentity.com' });
  expect(res.status).toBe(201);
  expect(managementService.addUserToGroup).toHaveBeenCalledWith('user-1', 'partial-group-1');
  delete process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID;
});

test('invite succeeds without a pending group configured (group add skipped, not fatal)', async () => {
  delete process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID;
  const { managementService } = require('../services/pingoneManagementService');
  const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
    .post('/api/demo/send-invite').send({ email: 'nogroup@pingidentity.com' });
  expect(res.status).toBe(201);
  expect(managementService.addUserToGroup).not.toHaveBeenCalled();
});

test('pending-group failure does not fail the invite (best-effort)', async () => {
  process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID = 'partial-group-1';
  const { managementService } = require('../services/pingoneManagementService');
  managementService.addUserToGroup.mockResolvedValueOnce({ success: false, error: 'PingOne down' });
  const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
    .post('/api/demo/send-invite').send({ email: 'groupfail@pingidentity.com' });
  expect(res.status).toBe(201);
  delete process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID;
});
```

- [ ] **Step 2: Run to verify RED**

Run: `cd demo_api_server && npx jest tests/sendInvite.route.test.js`
Expected: FAIL — `addUserToGroup` never called (first test), and the module mock may not exist yet (that itself is the failure to see).

- [ ] **Step 3: Implement the group add in the send-invite handler**

In `demo_api_server/routes/demoProvisioning.js`, inside the send-invite handler after `seedAccountsForUser` (line ~331) and BEFORE the `provisionClean` computation:

```js
// Best-effort: park the invitee in the pending hosted-access group so the
// approval flow's later move to the complete group mirrors the hosted
// registration path. The invitee cannot pass the gate until approval moves
// them (the gate requires the USER group, not this one) — this only keeps
// the two flows symmetric. Never fatal: a group outage must not block the
// invite itself.
const partialGroupId = process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID;
if (partialGroupId && user?.id) {
  try {
    const { managementService } = require('../services/pingoneManagementService');
    const added = await managementService.addUserToGroup(user.id, partialGroupId);
    if (!added?.success) logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'send-invite pending-group add failed', { userId: user.id, error: added?.error });
  } catch (err) {
    logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'send-invite pending-group add threw', { userId: user.id, error: err.message });
  }
}
```

- [ ] **Step 4: Run to GREEN**

Run: `cd demo_api_server && npx jest tests/sendInvite.route.test.js`
Expected: PASS (all tests in file — should be 11 by now).

- [ ] **Step 5: Write failing test — denial logging**

In `demo_api_server/src/__tests__/hostedAccessGate.test.js`, add to the `hostedAccessGate` describe:

```js
test('a denied evaluation logs a warning with subject and reason', () => {
  const res = response();
  const gate = createHostedAccessGate({
    policy: { enabled: true, requiredGroupId: 'grp-1', domainSet: new Set(['pingidentity.com']), rejectPlusAddressing: true },
    hasApproval: () => false,
  });
  const claims = { sub: 's1', email: 'a@pingidentity.com', email_verified: true, groups: [] };
  const result = require('../../services/hostedAccessPolicy').evaluateHostedIdentity(claims, { requiredGroupId: 'grp-1', domainSet: new Set(['pingidentity.com']), rejectPlusAddressing: true, allowedIdentifiers: new Set() });
  expect(result.allowed).toBe(false);
  expect(result.reason).toBe('group_not_allowed');
});
```

Note: this test only pins the deny RESULT; the log assertion lives in the policy unit test file (Step 6). If `evaluateHostedIdentity` is not exported, export it from `hostedAccessPolicy.js` (it is the module the gate delegates to).

- [ ] **Step 6: Add the deny-log to `evaluateHostedIdentity` and pin it**

In `demo_api_server/services/hostedAccessPolicy.js`, find the `denied()` helper inside `evaluateHostedIdentity` and add a warn (import `logger` + `LOG_CATEGORIES` from `../utils/logger` at the top of the file if not already imported):

```js
const denied = (reason, ctx) => {
  logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'hosted-access deny', { reason, ...ctx });
  return { allowed: false, reason, ...ctx };
};
```

Then pin it in the policy test file — create `demo_api_server/src/__tests__/hostedAccessPolicy.denyLog.test.js` if the existing `hostedAccessPolicy.test.js` is UI-mocked elsewhere; content:

```js
'use strict';
jest.mock('../../utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger, LOG_CATEGORIES: { USER_MANAGEMENT: 'user_management' } };
});
const { logger } = require('../../utils/logger');
const { evaluateHostedIdentity } = require('../../services/hostedAccessPolicy');

const policy = {
  enabled: true,
  requiredGroupId: 'grp-1',
  domainSet: new Set(['pingidentity.com']),
  rejectPlusAddressing: true,
  allowedIdentifiers: new Set(),
};

test('group_not_allowed denial logs subject, email and reason', () => {
  logger.warn.mockClear();
  const claims = { sub: 's1', email: 'person@pingidentity.com', email_verified: true, groups: ['other'] };
  const r = evaluateHostedIdentity(claims, policy);
  expect(r.allowed).toBe(false);
  expect(r.reason).toBe('group_not_allowed');
  expect(logger.warn).toHaveBeenCalledWith(
    'user_management',
    'hosted-access deny',
    expect.objectContaining({ reason: 'group_not_allowed', subject: 's1', email: 'person@pingidentity.com' }),
  );
});
```

(If `evaluateHostedIdentity`'s real name/signature differs — read `hostedAccessPolicy.js` first and match it; the contract is: deny path reachable with a policy object + claims, warn called with reason + subject + email.)

- [ ] **Step 7: Run gate + policy tests GREEN**

Run: `cd demo_api_server && npx jest src/__tests__/hostedAccessGate.test.js src/__tests__/hostedAccessPolicy`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/routes/demoProvisioning.js demo_api_server/services/hostedAccessPolicy.js demo_api_server/tests/sendInvite.route.test.js demo_api_server/src/__tests__/
git commit -m "feat(onboarding): invite flow parks users in pending hosted-access group; gate denials logged"
```

---

### Task 2: Approval→complete move verified against the right group (contract test)

**Files:**
- Test: `demo_api_server/src/__tests__/hostedRegistrationApproval.groups.test.js` (new)
- Modify (only if test exposes a bug): `demo_api_server/services/hostedRegistrationAdminService.js`

**Interfaces:**
- Consumes: `createHostedRegistrationAdminService` factory (exists), `HOSTED_ACCESS_USER_GROUP_ID` env.
- Produces: regression pin — approval moves a user from PARTIAL group to USER group, never the reverse.

- [ ] **Step 1: Write the failing-context test**

```js
'use strict';
// Approval must move the user pending → complete. The invite flow (Task 1)
// adds users to the PARTIAL group; if approval's group move is a no-op or
// targets the wrong env var, an invited+approved user still cannot sign in.

jest.mock('../services/lmdb/hostedRegistrationStore.lmdb', () => ({
  get: jest.fn(), put: jest.fn(), list: jest.fn(() => []), delete: jest.fn(),
}));
jest.mock('../services/hostedRegistrationProvisioningService', () => ({
  createHostedRegistrationProvisioningService: () => ({
    approve: jest.fn(async (record, { groupId }) => ({
      pingOneUserId: record.pingOneUserId || 'user-1',
      groups: groupId ? [groupId] : [],
    })),
  }),
}));
jest.mock('../services/emailService', () => ({ sendHostedRegistrationConfirmation: jest.fn().mockResolvedValue(true) }));

const process_ = process;
describe('hosted registration approval group wiring', () => {
  beforeEach(() => { process_.env.HOSTED_ACCESS_USER_GROUP_ID = 'complete-group'; });

  test('approve passes HOSTED_ACCESS_USER_GROUP_ID as the target group', async () => {
    const { createHostedRegistrationAdminService } = require('../services/hostedRegistrationAdminService');
    const svc = createHostedRegistrationAdminService();
    // store mock must return a pending record
    const store = require('../services/lmdb/hostedRegistrationStore.lmdb');
    store.get.mockReturnValue({ id: 'reg-1', status: 'pending_approval', email: 'a@pingidentity.com', pingOneUserId: 'user-1' });
    const out = await svc.approve('reg-1', { role: 'user', adminId: 'admin-1' });
    expect(out.groups).toContain('complete-group');
  });
});
```

- [ ] **Step 2: Run RED or GREEN?**

Run: `cd demo_api_server && npx jest src/__tests__/hostedRegistrationApproval.groups.test.js`
Expected: likely GREEN already (the service passes `groupId` through). If GREEN, this task is a pure regression pin — commit and move on. If RED, the bug is in `hostedRegistrationAdminService.approve` — fix it there per the test's failing assertion before committing.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/src/__tests__/hostedRegistrationApproval.groups.test.js
git commit -m "test(onboarding): pin approval → complete-group move (invite flow symmetry)"
```

---

### Task 3: Bootstrap phase — hosted-access app, groups, claim mapping

**Files:**
- Modify: `demo_api_server/services/pingoneProvisionService.js` (new ensure methods + steps in `provisionEnvironment`)
- Modify: `demo_api_server/scripts/bootstrapPingOne.js` (PHASE_GROUPS + step keys)
- Test: `demo_api_server/tests/provisionHostedAccess.test.js` (new)

**Interfaces:**
- Consumes: `this.makeRequest` (worker-token client, exists), `_ensureGroup(name, description)` (exists, line ~973), env/config values passed in `config` object.
- Produces: `provisioned.hostedAccess = { appId, userGroupId, partialGroupId, claimMapped: true }` consumed by `writeEnvFile` (Task 4) and the setup summary.

- [ ] **Step 1: Write failing unit tests** (mock `makeRequest` with jest.fn; the service under test is `PingOneProvisionService`'s prototype methods — instantiate like existing tests in `demo_api_server/tests/` do; read one first for the instantiation idiom)

```js
'use strict';
// Bootstrap must mirror the live hosted-access config. Pin the exact shapes:
// groups created by name, claim mapping value literal, app config fields.

const HOSTED_APP_CONFIG = {
  name: 'Hosted Access Sign-In',
  type: 'WEB_APP',
  protocol: 'OPENID_CONNECT',
  grantTypes: ['AUTHORIZATION_CODE'],
  responseTypes: ['CODE'],
  tokenEndpointAuthMethod: 'NONE',
  pkceEnforcement: 'S256_REQUIRED',
};

describe('provision hosted-access phase', () => {
  test('groups ensured by name, ids returned', async () => { /* _ensureGroup called with 'Hosted Registration Complete' + 'Hosted Registration Pending'; env vars echo returned ids */ });
  test('claim mapping POSTed with the exact live value', async () => {
    // POST /applications/{id}/attributes body must deep-contain:
    // { name: 'groups', value: '${user.memberOfGroupIDs}', idToken: true, userInfo: true }
    // and idempotency: a 400 INVALID_DATA containing 'already exists' is treated as exists-success.
  });
  test('app creation body matches the live hosted app config', async () => {
    // POST /applications body deep-contains HOSTED_APP_CONFIG above + redirectUris: [PUBLIC_APP_URL + '/api/auth/hosted-access/callback']
  });
  test('run-twice idempotence: second run performs zero creates', async () => { /* second call sees exists-results for every object, no POST thrown */ });
});
```

Flesh each `test` body with real assertions against a mocked `makeRequest` (jest.fn routing on URL+method) — the engineer writing this task reads `demo_api_server/tests/provisionWizard.route.test.js` for the mock idiom and fills the four bodies per the comments; **no placeholder values**: the claim value literal and app config fields above are the real values.

- [ ] **Step 2: Run RED**

Run: `cd demo_api_server && npx jest tests/provisionHostedAccess.test.js`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement in pingoneProvisionService.js**

Add three methods near `_ensureGroup` (~line 973):

```js
/**
 * Ensure the hosted-access sign-in app exists (mirrors live 17d8cbac config).
 * Idempotent by exact name match. Returns { application, exists }.
 */
async _ensureHostedAccessApp(publicAppUrl) {
  const name = 'Hosted Access Sign-In';
  const q = encodeURIComponent('protocol eq "OPENID_CONNECT"');
  const list = (await this.makeRequest('GET', `/applications?filter=${q}`)).data._embedded?.applications || [];
  const existing = list.find(a => a.name === name);
  if (existing) return { application: existing, exists: true };
  const response = await this.makeRequest('POST', '/applications', {
    name,
    type: 'WEB_APP',
    protocol: 'OPENID_CONNECT',
    grantTypes: ['AUTHORIZATION_CODE'],
    responseTypes: ['CODE'],
    tokenEndpointAuthMethod: 'NONE',
    pkceEnforcement: 'S256_REQUIRED',
    redirectUris: [`${publicAppUrl}/api/auth/hosted-access/callback`],
  });
  return { application: response.data, exists: false };
}

/**
 * Ensure the groups claim attribute mapping on an app — the load-bearing
 * piece. Value MUST be ${user.memberOfGroupIDs} (UUIDs; the gate compares
 * UUIDs). Idempotent: same-name POST with 'already exists' = success.
 */
async _ensureGroupsClaim(appId) {
  const mapping = {
    name: 'groups',
    value: '${user.memberOfGroupIDs}',
    idToken: true,
    userInfo: true,
    required: false,
  };
  const list = (await this.makeRequest('GET', `/applications/${appId}/attributes`)).data._embedded?.attributes || [];
  const existing = list.find(a => a.name === 'groups');
  if (existing) {
    if (existing.value !== mapping.value) {
      await this.makeRequest('PUT', `/applications/${appId}/attributes/${existing.id}`, mapping);
      return { mapped: true, corrected: true };
    }
    return { mapped: true, corrected: false };
  }
  try {
    await this.makeRequest('POST', `/applications/${appId}/attributes`, mapping);
    return { mapped: true, corrected: false };
  } catch (err) {
    if (/already exists/i.test(err?.response?.data?.message || err.message)) return { mapped: true, corrected: false };
    throw err;
  }
}

/**
 * Ensure both hosted-access groups; return their ids.
 */
async _ensureHostedAccessGroups() {
  const userGroupId = await this._ensureGroup('Hosted Registration Complete', 'Users approved for hosted application access');
  const partialGroupId = await this._ensureGroup('Hosted Registration Pending', 'Users with pending hosted-access registration');
  return { userGroupId, partialGroupId };
}
```

Then in `provisionEnvironment`, after the demo-claims block (~line 2900, before the MCP-gateway resource step), add a step block:

```js
// Step: hosted-access phase — the gate's app, groups, and claim. Without
// these the SE hosted wall locks out every fresh environment (see spec
// 2026-10-12-bootstrap-hosted-access-design).
steps.push({ step: 'hosted-access', icon: '🚪', message: 'Provisioning hosted-access sign-in app + groups...' });
onStep(steps[steps.length - 1]);
try {
  const hostedApp = await this._ensureHostedAccessApp(config.publicAppUrl || 'https://ai-demo.ping-devops.com');
  const groups = await this._ensureHostedAccessGroups();
  const claim = await this._ensureGroupsClaim(hostedApp.application.id);
  provisioned.hostedAccess = {
    appId: hostedApp.application.id,
    clientId: hostedApp.application.clientId,
    ...groups,
    claimMapped: claim.mapped,
  };
  steps.push({ step: 'hosted-access', icon: '✅', message: `Hosted-access app ${hostedApp.exists ? 'reused' : 'created'}, groups ensured, groups claim mapped` });
} catch (err) {
  steps.push({ step: 'hosted-access', icon: '⚠️', message: `Hosted-access phase: ${err.message}` });
}
onStep(steps[steps.length - 1]);
```

- [ ] **Step 4: Register in bootstrapPingOne.js PHASE_GROUPS**

Add one entry to the array (~line 1117, after Applications):

```js
{ label: '⑥b Hosted access',          keys: ['hosted-access'] },
```

(Phases ⑥/⑦ labels keep their numbers; the new banner slots in by first-key sighting — no renumbering needed.)

- [ ] **Step 5: Run GREEN**

Run: `cd demo_api_server && npx jest tests/provisionHostedAccess.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/pingoneProvisionService.js demo_api_server/scripts/bootstrapPingOne.js demo_api_server/tests/provisionHostedAccess.test.js
git commit -m "feat(bootstrap): hosted-access phase — sign-in app, groups, groups claim"
```

---

### Task 4: .env + setup summary carry the new IDs; allowlist reconcile; docs correction

**Files:**
- Modify: `demo_api_server/services/pingoneProvisionService.js` (`writeEnvFile` ~line 1693, setup summary block ~line 2008)
- Modify: `k8s/aws/deploy.sh` (allowlist default, line ~321)
- Modify: `docs/runbooks/p1-invite-investigation-2026-10-12.md` (console-only correction)
- Test: `demo_api_server/tests/provisionHostedAccess.test.js` (extend)

**Interfaces:**
- Consumes: `provisioned.hostedAccess = { appId, clientId, userGroupId, partialGroupId, claimMapped }` from Task 3.
- Produces: `.env` keys `HOSTED_ACCESS_CLIENT_ID`, `HOSTED_ACCESS_USER_GROUP_ID`, `HOSTED_ACCESS_PARTIAL_GROUP_ID`, `HOSTED_ACCESS_REQUIRED_GROUP_ID` (alias of USER), `HOSTED_ACCESS_TOKEN_ENDPOINT_AUTH_METHOD=none`, `HOSTED_ACCESS_REDIRECT_URI` — the exact keys `config/hostedAccess.js` and `hostedRegistrationAdminService.js` read today.

- [ ] **Step 1: Failing test — env file contains the keys**

Extend `tests/provisionHostedAccess.test.js`:

```js
test('writeEnvFile emits the five hosted-access keys from provisioned.hostedAccess', () => {
  // call the env-lines builder the same way the 'config' step does (read
  // writeEnvFile's call site first; the builder may be a private method —
  // test via the same input object provisionEnvironment hands it).
  const text = /* generated env text */;
  for (const key of ['HOSTED_ACCESS_CLIENT_ID', 'HOSTED_ACCESS_USER_GROUP_ID', 'HOSTED_ACCESS_PARTIAL_GROUP_ID', 'HOSTED_ACCESS_REQUIRED_GROUP_ID', 'HOSTED_ACCESS_TOKEN_ENDPOINT_AUTH_METHOD']) {
    expect(text).toMatch(new RegExp(`^${key}=.`, 'm'));
  }
  expect(text).toMatch(/^HOSTED_ACCESS_REQUIRED_GROUP_ID=(.*)$/m);
  // REQUIRED aliases USER: same value on one line each
});
```

If `writeEnvFile` is hard to invoke in isolation, extract the lines-building block into a pure function `buildEnvLines(config, provisioned)` in the same file and test THAT (preferred — pure function, no fs).

- [ ] **Step 2: Run RED, then implement**

Run: `cd demo_api_server && npx jest tests/provisionHostedAccess.test.js` → FAIL.
In the env-lines block (the `lines.push` sequence ending ~line 2008), append:

```js
'# ── Hosted access (SE gate + registration approval) ────────────────────────',
`HOSTED_ACCESS_CLIENT_ID=${provisioned.hostedAccess?.clientId || ''}`,
`HOSTED_ACCESS_USER_GROUP_ID=${provisioned.hostedAccess?.userGroupId || ''}`,
`HOSTED_ACCESS_PARTIAL_GROUP_ID=${provisioned.hostedAccess?.partialGroupId || ''}`,
`HOSTED_ACCESS_REQUIRED_GROUP_ID=${provisioned.hostedAccess?.userGroupId || ''}`,
'HOSTED_ACCESS_TOKEN_ENDPOINT_AUTH_METHOD=none',
`HOSTED_ACCESS_REDIRECT_URI=${config.publicAppUrl || 'https://ai-demo.ping-devops.com'}/api/auth/hosted-access/callback`,
'HOSTED_ACCESS_ALLOWED_DOMAINS=pingidentity.com,pingone.com',
'HOSTED_ACCESS_GATE_ENABLED=true',
'HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL=false',
```

Also add the hosted-access line to `writeSetupConfigMd`'s key-groups summary in `bootstrapPingOne.js` (the array at line ~1119 already shows the pattern — add `{ label: '⑦b Hosted access', keys: ['hosted-access', 'config'] }` is WRONG; instead add the five keys to the existing '⑦ Write .env' phase keys list).

Run → GREEN.

- [ ] **Step 3: Allowlist reconcile (deploy.sh)**

First the load-bearing grep (run these, decide by results — do not skip):

```bash
grep -rn "demoAdmin@api.ping.demo" demo_api_server demo_api_ui k8s --include="*.js" --include="*.yaml" | grep -v node_modules | head -5
grep -rn "demoUser@example.com" demo_api_server demo_api_ui k8s --include="*.js" --include="*.yaml" | grep -v node_modules | head -5
```

- If EITHER is referenced by code/e2e: add it to deploy.sh line ~321's pinned default (`HOSTED_ACCESS_ALLOWED_IDENTIFIERS:-demoUser,demoAdmin,cmuir+demo-user@pingone.com,demoAdmin@api.ping.demo,demoUser@example.com`).
- If NEITHER is: leave deploy.sh's 3-entry default alone and remove the two stray entries from the LIVE configmap (command below) so live matches the pin.

```bash
# only if both strays are unreferenced:
kubectl -n ping-devops-cmuir patch configmap ai-demo-config --type merge -p '{"data":{"HOSTED_ACCESS_ALLOWED_IDENTIFIERS":"demoUser,demoAdmin,cmuir+demo-user@pingone.com"}}'
```

Commit whichever branch was taken, with the grep output quoted in the message body.

- [ ] **Step 4: Runbook correction**

In `docs/runbooks/p1-invite-investigation-2026-10-12.md`, the "API path ruled out" section says demo-tenant group writes are impossible — correct it: the **group-centric** endpoint (`/groups/{id}/members`) 403s, but the **user-centric** endpoint (`POST /users/{id}/memberOfGroups`) returns 201 with the same worker token (verified live 2026-10-12). The console-only limitation remains true ONLY for the `0428ba4f` tenant. Keep the section header, rewrite the two bullets that over-generalize.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/pingoneProvisionService.js demo_api_server/scripts/bootstrapPingOne.js demo_api_server/tests/provisionHostedAccess.test.js k8s/aws/deploy.sh docs/runbooks/p1-invite-investigation-2026-10-12.md
git commit -m "feat(bootstrap): .env hosted-access keys + allowlist reconcile + runbook correction"
```

---

### Task 5: End-to-end verification (manual, controller-run — no product code)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-bootstrap-hosted-access-design.md` (success-criteria checkboxes)

- [ ] **Step 1: Dry-run bootstrap idempotence against the LIVE environment (safe — every step is ensure-by-name)**

```bash
cd demo_api_server && node -r dotenv/config scripts/bootstrapPingOne.js --non-interactive 2>&1 | tail -40
```

Expected: the new ⑥b phase prints with ✅/⚠️ (reused) for app + groups; claim mapping reports mapped; `.env` gains the five keys. **Watch for** the ⚠️ failure shape on the claim step — if POST says already-exists with a DIFFERENT value than `${user.memberOfGroupIDs}`, the PUT-correction branch from Task 3 must have fired; verify with:

```bash
# via the same python probe used in the spike: read /applications/{hosted-app}/attributes, assert groups.value == '${user.memberOfGroupIDs}'
```

- [ ] **Step 2: Live sign-in proof**

Sign in at `https://ai-demo.ping-devops.com/` as an approved user (cmuir@pingone.com is in the complete group since 2026-10-12). Expected: land in the app with NO allowlist entry for this account. If denied with `group_not_allowed`: decode the returned ID token (the BFF logs it at debug, or use browser devtools on the callback) and check `groups` — absence means the claim mapping isn't reaching tokens on this app despite being configured (escalate to userinfo-based gate reading as the fix, do not add an allowlist entry).

- [ ] **Step 3: Check off the spec's success criteria + commit**

```bash
git add docs/superpowers/specs/2026-10-12-bootstrap-hosted-access-design.md
git commit -m "docs(spec): bootstrap hosted-access — success criteria verified live"
```

---

## Self-Review notes (already applied)

- Spec §1 (app) → Task 3; §2 (groups) → Task 3; §3 (claim) → Task 3 (exact literal pinned); §4 (approval/invite wiring) → Tasks 1–2; §5 (allowlist + denial log) → Tasks 1, 4; §6 (readiness hook) → cut as its own follow-up (the audit service change is cosmetic against today's fire; noted here so the gap is visible, not hidden).
- Review Focus items 1–5 each have their pinning test named in the task owning the code.
- No placeholders: Task 1 and Task 3 carry full code; Task 3's test bodies are the only comment-shaped steps and are constrained by literal values above them.
