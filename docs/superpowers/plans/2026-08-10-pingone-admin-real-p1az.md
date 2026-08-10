# PingOne Admin group gate — real P1AZ enforcement (take 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pingOneAdminAccessService#checkAccess` decide PingOne Admin dashboard access via a real PingOne Authorize decision with a genuine `TokenAudience` — closing the gap that made the first attempt (#1548, reverted as #1550) deny every admin.

**Architecture:** `adminAgentRoutes.js`'s `requirePingOneAdminGroup` passes the admin's already-in-scope `req.agentContext.accessToken` into `checkAccess()`. `checkAccess` exchanges it for an `mcpgateway.ping.demo`-audienced token via `oauthService.performTokenExchangeAs` (using the already-provisioned Token Exchanger app's own identity as the exchanging party — no new PingOne provisioning), decodes the real `aud` claim, and passes it to `evaluateMcpToolDelegation` as `tokenAudience` alongside the expected `mcpResourceUri` — both populated this time, so the deployed policy's audience-chain rule passes and its group rule makes the real decision.

**Tech Stack:** Node 22, CommonJS, Jest 29.7, `demo_api_server`.

## Global Constraints

- Never proceed to the P1AZ decision call with a missing/undecoded `tokenAudience` — the exact failure mode that broke #1548. Missing `accessToken` or a failed exchange must fail closed at `503 pingone_admin_group_lookup_unavailable` immediately, no fallback to the old JS-only check.
- No token caching. Every `checkAccess` call does a fresh exchange + fresh decision call, matching this codebase's existing no-cache convention for MCP-audienced tokens (confirmed: nothing else caches one either).
- Reuse existing infrastructure only: `oauthService.performTokenExchangeAs` (`services/oauthService.js:955`), `configStore` keys `pingone_mcp_token_exchanger_client_id`/`_secret`, `resolveExpectedMcpResourceUri()` (`services/mcpToolAuthorizationService.js:86`), `decodeJwt` (`utils/tokenUtils.js:20`), `pingOneAuthorizeService.evaluateMcpToolDelegation` (`services/pingOneAuthorizeService.js:849`). Do not write a new JWT decoder or a new token-exchange function.
- `policyNotFound` → `503` (config-drift signal), never a member-facing `403`.
- `INDETERMINATE` fails closed as `403`, never `PERMIT`.
- Do not merge until the live-verify task (Task 2) passes against the real environment — not mocks. This is the actual lesson from today's outage: verify live BEFORE merge, not after.
- Spec: `docs/superpowers/specs/2026-08-10-pingone-admin-real-p1az-design.md`.

---

## Task 1: Real P1AZ decision with a genuine TokenAudience

**Files:**
- Modify: `demo_api_server/routes/adminAgentRoutes.js` (lines ~18-22, ~43-49, ~116-120 — the `requirePingOneAdminGroup` helper and its two call sites)
- Modify: `demo_api_server/services/pingOneAdminAccessService.js`
- Modify: `demo_api_server/tests/pingOneAdminAccessService.test.js`

**Interfaces:**
- Consumes:
  - `oauthService.performTokenExchangeAs(subjectToken, actorToken, clientId, clientSecret, audience, scopes, method, exchangeOptions)` (`services/oauthService.js:955`) — returns `Promise<string>` (the exchanged access token) or rejects with an `Error` carrying `.pingoneError`/`.pingoneErrorDescription`/`.httpStatus`.
  - `decodeJwt(token)` (`utils/tokenUtils.js:20`) — returns `{ header, claims } | null`, never throws.
  - `pingOneAuthorizeService.evaluateMcpToolDelegation(opts)` — unchanged from the reverted design, returns `Promise<{ decision: 'PERMIT'|'DENY'|'INDETERMINATE', policyNotFound?: boolean, ... }>` or rejects.
  - `resolveExpectedMcpResourceUri()` (`services/mcpToolAuthorizationService.js:86`, exported) — returns a string (the expected MCP resource URI for this deployment).
  - `configStore.getEffective(key)` — existing pattern, keys `pingone_mcp_token_exchanger_client_id` / `pingone_mcp_token_exchanger_client_secret`.
- Produces: `checkAccess({ username, pingOneUserId, accessToken })` — **new required-in-practice `accessToken` param** (optional in signature; its absence is one of the fail-closed branches). Same return shape as before: `Promise<{ allowed: boolean, error: string|null, status: number, requiredGroup: string|null, username?: string, groups?: string[] }>`. Consumed by `routes/adminAgentRoutes.js#requirePingOneAdminGroup`, which this task also updates to pass `accessToken` through — both call sites already destructure it from `req.agentContext` one line above their existing call.

**Current `adminAgentRoutes.js` (relevant excerpts):**

```js
async function requirePingOneAdminGroup(req, res, response = {}) {
  const access = await pingOneAdminAccessService.checkAccess({
    username: req.session?.user?.username || null,
    pingOneUserId: req.agentContext?.userId || null,
  });
  ...
}

// call site 1, inside router.post('/init', ...):
    const { userId, accessToken } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }
    if (!await requirePingOneAdminGroup(req, res, { ... })) return;

// call site 2, inside router.post('/message', ...):
    const { userId, accessToken, tokenEvents } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }
    if (!await requirePingOneAdminGroup(req, res, { ... })) return;
```

Both call sites already have `accessToken` in scope by the time they call `requirePingOneAdminGroup` — only `requirePingOneAdminGroup`'s own body needs to change to accept and forward it.

- [ ] **Step 1: Write the failing tests for `checkAccess`'s new behavior**

Replace `demo_api_server/tests/pingOneAdminAccessService.test.js` entirely with:

```js
'use strict';

jest.mock('../services/groupPolicy', () => ({
  groupNameForCategory: jest.fn(() => 'pingone-admin'),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(),
  listUserGroupNamesForVertical: jest.fn(),
}));
jest.mock('../services/oauthService', () => ({
  performTokenExchangeAs: jest.fn(),
}));
jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
}));
jest.mock('../services/mcpToolAuthorizationService', () => ({
  resolveExpectedMcpResourceUri: jest.fn(() => 'mcpgateway.ping.demo'),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'pingone_mcp_token_exchanger_client_id') return 'exchanger-client-id';
    if (key === 'pingone_mcp_token_exchanger_client_secret') return 'exchanger-secret';
    return null;
  }),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const oauthService = require('../services/oauthService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const { checkAccess } = require('../services/pingOneAdminAccessService');

// A minimal valid JWT with { aud: 'mcpgateway.ping.demo' } in its payload —
// decodeJwt only needs a 3-part base64url string, signature is never checked.
const EXCHANGED_TOKEN = [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ aud: 'mcpgateway.ping.demo', sub: 'user-1' })).toString('base64url'),
  'sig',
].join('.');

beforeEach(() => {
  jest.clearAllMocks();
  membershipService.isReady.mockReturnValue(true);
  oauthService.performTokenExchangeAs.mockResolvedValue(EXCHANGED_TOKEN);
});

test('permits a live pingone-admin member via a real PingOne Authorize PERMIT', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'PERMIT' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: true,
    status: 200,
    requiredGroup: 'pingone-admin',
  });

  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledWith(
    'admin-session-token', null, 'exchanger-client-id', 'exchanger-secret',
    'mcpgateway.ping.demo', ['read'], 'post',
  );
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'user-1',
      requiredGroup: 'pingone-admin',
      inRequiredGroup: true,
      verticalId: 'pingone-admin',
      tokenAudience: 'mcpgateway.ping.demo',
      mcpResourceUri: 'mcpgateway.ping.demo',
    }),
  );
});

test('denies a live pingone-admin member when the real PDP decision is DENY', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'DENY' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });
});

test('fails closed on INDETERMINATE for a real member', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'INDETERMINATE' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });
});

test('fails closed with 503 on policyNotFound, not a member-facing 403', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'DENY', policyNotFound: true });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });
});

test('fails closed with 503 immediately when accessToken is missing — never calls the exchange', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: null,
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });

  expect(oauthService.performTokenExchangeAs).not.toHaveBeenCalled();
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed with 503 when the token exchange itself throws', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs.mockRejectedValue(new Error('Token exchange failed: invalid_grant'));

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });

  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed when live membership cannot be verified', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(null);

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });
});
```

- [ ] **Step 2: Run the test file and confirm it fails**

```bash
cd demo_api_server && CI=true npm test -- tests/pingOneAdminAccessService.test.js --forceExit
```

Expected: FAIL — `checkAccess` doesn't accept `accessToken` or call `oauthService.performTokenExchangeAs` yet.

- [ ] **Step 3: Implement `checkAccess`'s new behavior**

Replace `demo_api_server/services/pingOneAdminAccessService.js` with:

```js
'use strict';

const groupPolicy = require('./groupPolicy');
const membershipService = require('./pingOneGroupMembershipService');
const oauthService = require('./oauthService');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');
const { resolveExpectedMcpResourceUri } = require('./mcpToolAuthorizationService');
const { decodeJwt } = require('../utils/tokenUtils');
const configStore = require('./configStore');

const VERTICAL_ID = 'pingone-admin';
const GROUP_CATEGORY = 'privileged';

async function checkAccess({ username, pingOneUserId, accessToken }) {
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

  // The decision is made by PingOne Authorize (Scenario 1 group-policy rule),
  // not in JS — but the deployed "McpFirstTool" policy runs an audience/actor
  // check BEFORE that rule, so this call needs a REAL TokenAudience or it
  // denies everyone (see docs/superpowers/specs/2026-08-10-pingone-admin-
  // p1az-group-gate-design.md for the first, reverted attempt that omitted
  // one). This call site has no MCP-audienced token of its own, so one is
  // minted here via RFC 8693 token exchange, using the admin's own session
  // token as the subject and the already-provisioned Token Exchanger app's
  // identity as the exchanging party — no new PingOne provisioning needed.
  if (!accessToken) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const mcpResourceUri = resolveExpectedMcpResourceUri();
  let tokenAudience;
  try {
    const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
    const exchangerClientSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
    // 'post' (client_secret_post), not the function's own 'basic' default —
    // this exchanger app's token-endpoint auth method rejects 'basic' with
    // 401 invalid_client (live-verified this session).
    const exchanged = await oauthService.performTokenExchangeAs(
      accessToken, null, exchangerClientId, exchangerClientSecret, mcpResourceUri, ['read'], 'post',
    );
    const decoded = decodeJwt(exchanged);
    const aud = decoded?.claims?.aud;
    tokenAudience = Array.isArray(aud) ? aud[0] : aud;
  } catch (err) {
    console.warn('[pingOneAdminAccessService] MCP token exchange failed (denying):', err.message);
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  let decision;
  let policyNotFound;
  try {
    ({ decision, policyNotFound } = await pingOneAuthorizeService.evaluateMcpToolDelegation({
      userId: pingOneUserId,
      toolName: 'pingone_admin_access',
      verticalId: VERTICAL_ID,
      requiredGroup,
      inRequiredGroup,
      tokenAudience,
      mcpResourceUri,
    }));
  } catch (err) {
    console.warn('[pingOneAdminAccessService] P1AZ evaluation error (denying):', err.message);
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  if (policyNotFound) {
    console.warn('[pingOneAdminAccessService] policy_not_found for pingone_admin_access (denying)');
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

- [ ] **Step 4: Run the test file again and confirm all 7 tests pass**

```bash
cd demo_api_server && CI=true npm test -- tests/pingOneAdminAccessService.test.js --forceExit
```

Expected: PASS, 7/7.

- [ ] **Step 5: Wire `accessToken` through `adminAgentRoutes.js`**

In `demo_api_server/routes/adminAgentRoutes.js`, change `requirePingOneAdminGroup`'s signature and body:

```js
async function requirePingOneAdminGroup(req, res, response = {}) {
  const access = await pingOneAdminAccessService.checkAccess({
    username: req.session?.user?.username || null,
    pingOneUserId: req.agentContext?.userId || null,
    accessToken: req.agentContext?.accessToken || null,
  });
  if (access.allowed) return true;
  ...
```

(Only the object passed to `checkAccess` changes — one new line, `accessToken: req.agentContext?.accessToken || null`. Nothing else in this function or its two call sites needs to change; both already destructure `accessToken` from `req.agentContext` before calling `requirePingOneAdminGroup`, so it is already in scope on `req` by the time this function runs.)

- [ ] **Step 6: Run the full BFF suite**

```bash
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
```

Expected: PASS (pre-existing rotating live-integration flakes are fine — only investigate failures mentioning `pingOneAdminAccessService`, `adminAgentRoutes`, `oauthService`, or `pingOneAuthorizeService`). Before committing, run `git status --short -- demo_api_server/data` and `git checkout -- demo_api_server/data` if the full-suite run left any regenerated step-verification files dirty — never ship those as part of this change.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/routes/adminAgentRoutes.js demo_api_server/services/pingOneAdminAccessService.js demo_api_server/tests/pingOneAdminAccessService.test.js
git commit -m "$(cat <<'EOF'
feat(admin): real P1AZ decision for the pingone-admin group gate

checkAccess now exchanges the admin session's real access token for an
mcpgateway.ping.demo-audienced token (via the already-provisioned Token
Exchanger app's identity, no new PingOne provisioning) and supplies a real
TokenAudience to evaluateMcpToolDelegation -- closing the gap that made the
first attempt (#1548, reverted as #1550) deny every admin. Missing token or
a failed exchange fails closed at 503, never proceeds with an omitted
audience.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Live-verify against the real PingOne Authorize decision endpoint (mandatory before merge)

This task requires the running Docker stack, a live admin session, and the
ability to add/remove real PingOne group membership — it cannot be done by
an isolated subagent without that access. If you are an autonomous worker
without it, stop after Task 1 and hand this task back for interactive
execution. **Do not open a PR for Task 1 until this task has passed** — the
whole point of this task is verifying live before merge, not after (the
opposite order broke production earlier today).

**Files:** none (verification only), plus `REGRESSION_PLAN.md` (§4 log
entry — exempt from the worktree-write restriction per root `CLAUDE.md`).

- [ ] **Step 1: Land the Task 1 code into the running stack without merging**

Since this must be verified before any PR/merge, copy the two changed
service/route files from the worktree into the main checkout (the one
Docker bind-mounts), matching the precedent already used earlier today for
pre-merge debug instrumentation:

```bash
cp demo_api_server/services/pingOneAdminAccessService.js /Users/cmuir/Development/AI-DEMO2/demo_api_server/services/pingOneAdminAccessService.js
cp demo_api_server/routes/adminAgentRoutes.js /Users/cmuir/Development/AI-DEMO2/demo_api_server/routes/adminAgentRoutes.js
docker restart ai-demo-api-server
```

Wait for `https://api.ping.demo:3001/api/healthz` to respond before continuing.

- [ ] **Step 2: Confirm the signed-in admin currently has the required group and a fresh session token**

Ask the admin (or check live) that the current `/admin` session's access
token has not expired (today's session hit this exact trap once already —
an expired token surfaces as `Cannot parse token claims for request param
'subject_token'`, not a permissions error). If in doubt, ask them to
reload/re-login at `/admin` first.

- [ ] **Step 3: Exercise the admin agent and confirm PERMIT**

Run any PingOne Admin demo step from `/admin` (e.g. ADMIN1 "List
applications"). Confirm it succeeds (200, real data). Check the BFF logs:

```bash
docker logs ai-demo-api-server --since 5m 2>&1 | grep -E "TokenExchange|BFF→P1AZ"
```

Confirm a `[TokenExchange...]` success line shows `audience=mcpgateway.ping.demo`,
and the `[BFF→P1AZ] PARAMETERS` line shows both `TokenAudience` and
`McpResourceUri` set to `mcpgateway.ping.demo` (not omitted, not `"none"`),
and `RESPONSE` shows a real `PERMIT`-equivalent effect — not
`policy_not_found`, not the old audience-chain `DENY`.

- [ ] **Step 4: Remove the group and confirm real DENY**

Remove the demo admin user from the required group in PingOne, run the same
admin demo step again (no new login, no new token needed for THIS part —
the exchange still succeeds since it only needs the base session token
fresh, not group membership). Confirm `403 pingone_admin_group_required`.
Check the `[BFF→P1AZ]` log lines: confirm `InRequiredGroup: false` and the
decision endpoint's `RESPONSE` reflects an actual `DENY` from the group
rule (not `policy_not_found`, not the audience-chain denial from before).

If anything other than a clean group-rule `DENY` appears here, **stop** —
do not proceed to Task 1's PR. This is exactly the check that would have
caught #1548 before it shipped.

- [ ] **Step 5: Add the group back and confirm PERMIT again**

Re-add the group, run the demo step once more, confirm `200`/success.

- [ ] **Step 6: Revert the pre-merge landing from Step 1**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git checkout -- demo_api_server/services/pingOneAdminAccessService.js demo_api_server/routes/adminAgentRoutes.js
docker restart ai-demo-api-server
```

This restores the main checkout to its last-merged state (today's revert)
before Task 1's actual PR lands normally.

- [ ] **Step 7: Only now — open the PR for Task 1's commit and merge it through the normal flow** (push branch, `gh pr create`, wait for CI, `gh pr merge`), then sync the main checkout and do the real (non-temporary) deploy:

```bash
bash scripts/sync-main-checkout.sh
docker restart ai-demo-api-server
```

- [ ] **Step 8: Add a `REGRESSION_PLAN.md` §4 entry** (after the merge, in a follow-up commit on a fresh small branch or directly per the root `CLAUDE.md` exemption), documenting that real P1AZ enforcement is now live for this vertical, live-verified both directions before merge, and pointing at this spec.
