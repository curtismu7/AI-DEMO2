# PingOne Admin group gate — real P1AZ enforcement (take 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pingOneAdminAccessService#checkAccess` decide PingOne Admin dashboard access via a real PingOne Authorize decision with a genuine `TokenAudience` and `ActClientId` — closing the gaps that made two prior attempts fail (audience-only #1548/#1550, then a single-hop exchange that fixed the audience but hit a second, independent actor-chain gate).

**Architecture:** `adminAgentRoutes.js`'s `requirePingOneAdminGroup` passes the admin's already-in-scope `req.agentContext.accessToken` into `checkAccess()`. `checkAccess` performs a **two-hop** RFC 8693 exchange — hop 1 as the AI Agent Actor client against the intermediate `agentgateway.ping.demo` audience (constructs a real `act` claim from the admin's own PingOne `mayAct` profile attribute), hop 2 as the Token Exchanger client against the final `mcpgateway.ping.demo` audience (propagates that `act` forward) — then decodes the final token's real `aud`/`act` and passes both to `evaluateMcpToolDelegation` as `tokenAudience`/`actClientId`, alongside `mcpResourceUri`. This satisfies both halves of the deployed policy's combined audience-and-actor-chain check. No new PingOne provisioning — every client and resource involved is already fully granted for banking's own use.

**Tech Stack:** Node 22, CommonJS, Jest 29.7, `demo_api_server`.

## Note on plan history

This plan's Task 1 was previously implemented, reviewed, and fix-rounded as a **single-hop** exchange (commits `7592cc3d..62b9140d` on this branch) — it passed all tests and its own task review, but a live-verify pass (Task 2, run before any merge, working as designed) found the single-hop token never carries a real `act` claim, which the deployed policy separately requires. That live-verify is what caught this, not a review gap — the single-hop code was exactly what its own task review approved. This revision replaces Task 1's requirements with the two-hop fix; the prior single-hop commits remain in this branch's history and are superseded, not deleted, by Task 1's new commits below.

## Global Constraints

- Never proceed to the P1AZ decision call with a missing/undecoded `tokenAudience` — the exact failure mode that broke #1548. Missing `accessToken` or a failed exchange (either hop) must fail closed at `503 pingone_admin_group_lookup_unavailable` immediately, no fallback to the old JS-only check.
- `actClientId` is passed through as decoded (may be `undefined` if genuinely absent) — the P1AZ policy itself validates it; `checkAccess` does not separately gate on its presence the way it gates on `tokenAudience`.
- No token caching. Every `checkAccess` call does a fresh two-hop exchange + fresh decision call, matching this codebase's existing no-cache convention for MCP-audienced tokens.
- Reuse existing infrastructure only: `oauthService.performTokenExchangeAs` (`services/oauthService.js:955`), `configStore` keys `pingone_ai_agent_actor_client_id`/`_secret`, `ai_agent_intermediate_audience`, `pingone_mcp_token_exchanger_client_id`/`_secret`, `resolveExpectedMcpResourceUri()` (`services/mcpToolAuthorizationService.js:86`), `decodeJwt` (`utils/tokenUtils.js:20`), `pingOneAuthorizeService.evaluateMcpToolDelegation` (`services/pingOneAuthorizeService.js:849`). Do not write a new JWT decoder or a new token-exchange function.
- Both exchange calls use `'post'` as the explicit auth-method argument — the function's own default (`'basic'`) fails 401 for both clients involved (live-verified this session for the Token Exchanger client; assume the same for the AI Agent Actor client unless the implementer's own live-verify run says otherwise).
- `policyNotFound` → `503` (config-drift signal), never a member-facing `403`.
- `INDETERMINATE` fails closed as `403`, never `PERMIT`.
- Do not merge until the live-verify task (Task 2) passes against the real environment — not mocks — for **both** the PERMIT and DENY directions, through the real two-hop chain. This is the second time live-verify has been the thing that actually catches a gap here; do not skip or shortcut it.
- Spec: `docs/superpowers/specs/2026-08-10-pingone-admin-real-p1az-design.md`.

---

## Task 1: Two-hop RFC 8693 exchange feeding a real TokenAudience + ActClientId

**Files:**
- Modify: `demo_api_server/routes/adminAgentRoutes.js` — **only if not already done** by the prior single-hop commits on this branch (check first: `requirePingOneAdminGroup` should already pass `accessToken: req.agentContext?.accessToken || null` into `checkAccess`). If already present, this file needs no further change for this task.
- Modify: `demo_api_server/services/pingOneAdminAccessService.js` — replace the single-hop exchange with the two-hop version below.
- Modify: `demo_api_server/tests/pingOneAdminAccessService.test.js` — replace entirely (the single-hop test file's mocking shape no longer matches).

**Interfaces:**
- Consumes:
  - `oauthService.performTokenExchangeAs(subjectToken, actorToken, clientId, clientSecret, audience, scopes, method, exchangeOptions)` (`services/oauthService.js:955`) — called **twice** per successful path, with different client credentials and audiences each time. Returns `Promise<string>` or rejects with an `Error`.
  - `decodeJwt(token)` (`utils/tokenUtils.js:20`) — `{ header, claims } | null`, never throws.
  - `pingOneAuthorizeService.evaluateMcpToolDelegation(opts)` — unchanged, now also receives `actClientId`.
  - `resolveExpectedMcpResourceUri()` (`services/mcpToolAuthorizationService.js:86`, exported).
  - `configStore.getEffective(key)` — five keys now: `pingone_ai_agent_actor_client_id`, `pingone_ai_agent_actor_client_secret`, `ai_agent_intermediate_audience`, `pingone_mcp_token_exchanger_client_id`, `pingone_mcp_token_exchanger_client_secret`.
- Produces: `checkAccess({ username, pingOneUserId, accessToken })` — same signature and return shape as the (superseded) single-hop version: `Promise<{ allowed: boolean, error: string|null, status: number, requiredGroup: string|null, username?: string, groups?: string[] }>`.

- [ ] **Step 1: Check whether `adminAgentRoutes.js`'s route wiring already exists**

Read `demo_api_server/routes/adminAgentRoutes.js`'s `requirePingOneAdminGroup` function (near the top of the file). If it already calls `pingOneAdminAccessService.checkAccess({ username: ..., pingOneUserId: ..., accessToken: req.agentContext?.accessToken || null })`, this file needs no changes for this task — skip to Step 2. If for any reason it does not (e.g. this task is being run on a fresh checkout without the prior commits), add exactly that one field to the object passed to `checkAccess`, matching the existing `username`/`pingOneUserId` style, and note this in your report.

- [ ] **Step 2: Write the failing tests for the two-hop `checkAccess`**

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
  getEffective: jest.fn((key) => ({
    pingone_ai_agent_actor_client_id: 'actor-client-id',
    pingone_ai_agent_actor_client_secret: 'actor-secret',
    ai_agent_intermediate_audience: 'agentgateway.ping.demo',
    pingone_mcp_token_exchanger_client_id: 'exchanger-client-id',
    pingone_mcp_token_exchanger_client_secret: 'exchanger-secret',
  }[key] || null)),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const oauthService = require('../services/oauthService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const { checkAccess } = require('../services/pingOneAdminAccessService');

// Build a minimal valid JWT (3-part base64url) — decodeJwt never checks the
// signature, so part 3 can be any placeholder string.
function buildToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

const HOP1_TOKEN = buildToken({ aud: 'agentgateway.ping.demo', sub: 'user-1', act: { sub: 'actor-client-id' } });
const FINAL_TOKEN = buildToken({ aud: 'mcpgateway.ping.demo', sub: 'user-1', act: { sub: 'actor-client-id' } });
const FINAL_TOKEN_NO_AUD = buildToken({ sub: 'user-1', act: { sub: 'actor-client-id' } });

beforeEach(() => {
  jest.clearAllMocks();
  membershipService.isReady.mockReturnValue(true);
});

test('permits a live pingone-admin member via a real two-hop exchange and PingOne Authorize PERMIT', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN);
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

  expect(oauthService.performTokenExchangeAs).toHaveBeenNthCalledWith(1,
    'admin-session-token', null, 'actor-client-id', 'actor-secret',
    'agentgateway.ping.demo', ['read'], 'post',
  );
  expect(oauthService.performTokenExchangeAs).toHaveBeenNthCalledWith(2,
    HOP1_TOKEN, null, 'exchanger-client-id', 'exchanger-secret',
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
      actClientId: 'actor-client-id',
    }),
  );
});

test('denies a live pingone-admin member when the real PDP decision is DENY', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN);
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
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN);
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
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN);
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

test('fails closed with 503 immediately when accessToken is missing — neither hop runs', async () => {
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

test('fails closed with 503 when hop 1 throws — hop 2 and the PDP never run', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs.mockRejectedValueOnce(new Error('Token exchange failed: invalid_grant'));

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });

  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(1);
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed with 503 when hop 2 throws — the PDP never runs', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockRejectedValueOnce(new Error('Token exchange failed: invalid_grant'));

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });

  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(2);
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed with 503 when the final token has no audience claim — the PDP never runs', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN_NO_AUD);

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

- [ ] **Step 3: Run the test file and confirm it fails**

```bash
cd demo_api_server && CI=true npm test -- tests/pingOneAdminAccessService.test.js --forceExit
```

Expected: FAIL — `checkAccess` doesn't yet do a two-hop exchange or pass `actClientId`.

- [ ] **Step 4: Implement the two-hop `checkAccess`**

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

  if (!accessToken) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  // Two-hop RFC 8693 exchange — banking's own pattern, confirmed live via
  // the involved resources' actual attribute mappings (not just their code).
  // Hop 1's resource (agentgateway.ping.demo) constructs `act` from the
  // SUBJECT token's `may_act` claim; the admin's own PingOne user record
  // names the AI Agent Actor client as its permitted actor. Hop 2's
  // resource (mcpgateway.ping.demo) only PROPAGATES an existing `act` — it
  // never constructs one from a request-supplied actor_token, which is why
  // a single hop with an actor token attached (tried first, live-tested,
  // did not work) never populates `act`. See
  // docs/superpowers/specs/2026-08-10-pingone-admin-real-p1az-design.md.
  const intermediateAud = configStore.getEffective('ai_agent_intermediate_audience');
  const mcpResourceUri = resolveExpectedMcpResourceUri();
  let finalToken;
  try {
    const aiAgentActorClientId = configStore.getEffective('pingone_ai_agent_actor_client_id');
    const aiAgentActorClientSecret = configStore.getEffective('pingone_ai_agent_actor_client_secret');
    const hop1Token = await oauthService.performTokenExchangeAs(
      accessToken, null, aiAgentActorClientId, aiAgentActorClientSecret,
      intermediateAud, ['read'], 'post',
    );

    const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
    const exchangerClientSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
    finalToken = await oauthService.performTokenExchangeAs(
      hop1Token, null, exchangerClientId, exchangerClientSecret,
      mcpResourceUri, ['read'], 'post',
    );
  } catch (err) {
    console.warn('[pingOneAdminAccessService] MCP token exchange failed (denying):', err.message);
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const decoded = decodeJwt(finalToken);
  const aud = decoded?.claims?.aud;
  const tokenAudience = Array.isArray(aud) ? aud[0] : aud;
  const actClientId = decoded?.claims?.act?.sub;

  if (!tokenAudience) {
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
      actClientId,
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

- [ ] **Step 5: Run the test file again and confirm all 9 tests pass**

```bash
cd demo_api_server && CI=true npm test -- tests/pingOneAdminAccessService.test.js --forceExit
```

Expected: PASS, 9/9.

- [ ] **Step 6: Run the full BFF suite**

```bash
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
```

Expected: PASS (pre-existing rotating live-integration flakes are fine — only investigate failures mentioning `pingOneAdminAccessService`, `adminAgentRoutes`, `oauthService`, or `pingOneAuthorizeService`). Before committing, run `git status --short -- demo_api_server/data` and `git checkout -- demo_api_server/data` if the full-suite run left any regenerated step-verification files dirty — never ship those as part of this change.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/pingOneAdminAccessService.js demo_api_server/tests/pingOneAdminAccessService.test.js
git commit -m "$(cat <<'EOF'
feat(admin): two-hop RFC 8693 exchange for the pingone-admin P1AZ gate

Single-hop exchange (prior commits on this branch) fixed the audience but
live-verify caught a second, independent policy gate: a missing act
(actor-chain) claim. Traced via the involved resources' actual attribute
mappings -- mcpgateway.ping.demo only propagates an existing act claim, it
never constructs one from a request-supplied actor_token. Only the
intermediate agentgateway.ping.demo resource constructs act, from the
subject token's own may_act claim (which names the AI Agent Actor client
for this admin user). Two-hop exchange (AI Agent Actor -> Token Exchanger)
produces a token with both a real aud and a real act, live-tested to a
genuine PERMIT before this commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(If Step 1 found `adminAgentRoutes.js` needed a change, include it in this
`git add`/commit too.)

---

## Task 2: Live-verify against the real PingOne Authorize decision endpoint (mandatory before merge)

This task requires the running Docker stack, a live admin session, and the
ability to add/remove real PingOne group membership — it cannot be done by
an isolated subagent without that access. If you are an autonomous worker
without it, stop after Task 1 and hand this task back for interactive
execution. **Do not open a PR for Task 1 until this task has passed** —
verified before merge, not after (the opposite order caused a live outage
earlier in this feature's development, and a second live-verify round is
exactly what caught the actor-chain gap this revision fixes).

**Files:** none (verification only), plus `REGRESSION_PLAN.md` (§4 log
entry — exempt from the worktree-write restriction per root `CLAUDE.md`).

- [ ] **Step 1: Land the Task 1 code into the running stack without merging**

```bash
cp demo_api_server/services/pingOneAdminAccessService.js /Users/cmuir/Development/AI-DEMO2/demo_api_server/services/pingOneAdminAccessService.js
cp demo_api_server/routes/adminAgentRoutes.js /Users/cmuir/Development/AI-DEMO2/demo_api_server/routes/adminAgentRoutes.js
docker restart ai-demo-api-server
```

Wait for `https://api.ping.demo:3001/api/healthz` to respond before continuing.

- [ ] **Step 2: Confirm the signed-in admin currently has the required group and a fresh session token**

Check the freshest `demoAdmin` session's access token expiry (an expired
token surfaces as PingOne's generic `Cannot parse token claims for request
param 'subject_token'`, not a clear permissions error — hit this exact trap
earlier in this feature's development). If in doubt, ask them to
reload/re-login at `/admin` first.

- [ ] **Step 3: Exercise the real two-hop chain and confirm PERMIT**

Either run an admin demo step from `/admin` (e.g. ADMIN1) or call
`checkAccess` directly in-container with the fresh session's real
`accessToken` (both are equally valid — the in-container call exercises the
exact same code path and was how this was live-tested during design).
Confirm the result is `{ allowed: true, status: 200 }`. Check the BFF logs:

```bash
docker logs ai-demo-api-server --since 5m 2>&1 | grep -E "Exchange-As|BFF→P1AZ"
```

Confirm **two** `[Exchange-As]` lines (one per hop, different `client=` and
`audience=` values), and the `[BFF→P1AZ] PARAMETERS` line shows
`TokenAudience: "mcpgateway.ping.demo"` **and** a non-empty `ActClientId`
(not `""`), and `RESPONSE` shows a real `PERMIT`/`"MCP Tool Authorized"`
effect.

- [ ] **Step 4: Remove the group and confirm real DENY**

Remove the demo admin user from the required group in PingOne, repeat Step
3's check. Confirm `403 pingone_admin_group_required`. Check the
`[BFF→P1AZ]` log lines: confirm `InRequiredGroup: false`, `TokenAudience`
and `ActClientId` are STILL populated correctly (the exchange doesn't
depend on group membership — only the decision does), and the decision
endpoint's `RESPONSE` reflects an actual `DENY` from the group rule (not
`policy_not_found`, not an audience/actor-chain denial).

If anything other than a clean group-rule `DENY` appears here, **stop** —
do not proceed to Task 1's PR.

- [ ] **Step 5: Add the group back and confirm PERMIT again**

Re-add the group, repeat Step 3's check, confirm `200`/success.

- [ ] **Step 6: Revert the pre-merge landing from Step 1**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git checkout -- demo_api_server/services/pingOneAdminAccessService.js demo_api_server/routes/adminAgentRoutes.js
docker restart ai-demo-api-server
```

- [ ] **Step 7: Only now — open the PR for Task 1's commits and merge it through the normal flow** (push branch, `gh pr create`, wait for CI, `gh pr merge`), then sync the main checkout and deploy:

```bash
bash scripts/sync-main-checkout.sh
docker restart ai-demo-api-server
```

- [ ] **Step 8: Add a `REGRESSION_PLAN.md` §4 entry** documenting that real P1AZ enforcement (two-hop exchange) is now live for this vertical, live-verified both directions before merge, and pointing at this spec — including the actor-chain finding as its own noted lesson (single-hop live-verify passing the audience check is not sufficient proof; the full chain must be verified).
