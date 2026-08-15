# RFC 8693 Act Claim: Nested Object -> Flat Array Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the RFC 8693 `act` (actor) claim from today's recursively-nested object shape (`act:{sub:agent2, act:{sub:agent1}}`) to a flat, ordered array of delegation hops (`act:[{sub:agent1},{sub:agent2}]`, index 0 = first/oldest delegate, last index = current/most-recent actor) everywhere the claim is minted or read across the demo stack, while leaving PingOne's own live-tenant SpEL minting untouched.

**Architecture:** PingOne Authorize's SpEL still mints the nested object on the wire exactly as it does today (zero live-tenant config risk — see Task 0 for why). Every code path that decodes a JWT normalizes `act` into the flat array immediately after decode, at each service's canonical decode boundary, so everything downstream of that boundary only ever sees the array. Sites that walk `.act.act` recursively, or read `.sub`/`.client_id` off `act` as if it were a single object, are rewritten to index into the array. The transformation is applied independently in demo_api_server (JS, CommonJS), demo_mcp_gateway (TypeScript — the real, non-simulated agent-traffic path), demo_authz_server (the JS mock parity engine for P1AZ), and demo_api_ui (React, consuming the now-array shape from BFF API responses).

**Tech Stack:** Node >=22 CommonJS (demo_api_server, demo_authz_server), TypeScript 5 / tsc (demo_mcp_gateway), React 19 (demo_api_ui), Jest 29.7 (+ ts-jest for the gateway), PingOne Authorize / P1AZ (unchanged).

## Global Constraints

- **Array order:** index 0 = first/oldest delegate, highest index = current/most-recent actor. This was an explicit decision — do not reverse it.
- **PingOne's SpEL mint stays nested.** `demo_api_server/services/pingoneProvisionService.js:3328-3329` (`await this._setResourceAttribute(a2aGwResourceResult.resource.id, 'act', "${{'sub': ..., 'act': ...}}")`) is NOT touched by this plan. Normalization happens in code, immediately after every JWT decode — not at the PingOne policy-config layer. This was an explicit decision, made because no array-construction precedent exists in this repo's SpEL and the live tenant risk of getting that wrong is high.
- **`may_act` is a different claim and is NOT touched.** It's a one-time delegation grant (who the user authorized), not a record of what happened — it stays a single object everywhere in this codebase and nothing here nests it.
- **`routes/xaaIdJagDemo.js`'s `act: { iss: 'demo-idp-a' }` is unrelated.** It's an ID-JAG claim (draft-ietf-oauth-identity-chaining), a completely different `act` semantic (records the issuing IdP, not an actor chain). Do not touch this file.
- **Each hop's internal fields are preserved as-is when flattening.** Only the nesting-to-array structural change is made. A hop that had `{client_id: 'x'}` stays `{client_id: 'x'}` — no key renaming.
- **P1AZ snapshot JSON needs no change.** PingOne Authorize never touches the raw `act` object — it receives pre-computed `ActClientId` / `NestedActClientId` / `ActChainDepth` decision parameters from the BFF/gateway. Fixing how those three parameters are *computed* (Tasks 4, 9) is sufficient; the snapshot's `AttributeDefinition`/`ConditionDefinition`/`Rule` entries for them are untouched.
- **Depth semantics are NOT extended.** `ActChainDepth` stays a 0/1/2 signal (no delegation / single-hop / A2A two-hop) because that's all any current P1AZ rule or demo use case checks. This migration fixes the *shape* bug (nested object vs array), not depth semantics — extending to true unbounded depth reporting is out of scope (note it in TECH_DEBT.md if you want it tracked, per Task 12).
- **Verify commands**, run after the tasks touching that subsystem:
  - demo_api_server: `cd demo_api_server && CI=true npm test -- --forceExit`
  - demo_mcp_gateway: `cd demo_mcp_gateway && npm run build && npm test`
  - demo_authz_server: `cd demo_authz_server && npm test` (confirm exact script name in package.json when you get there — includes `importSnapshot.parity.test.js` and `decision.a2a.test.js`)
  - demo_api_ui: `cd demo_api_ui && npm run test:unit && npm run build`
- Work happens in an isolated git worktree per root `CLAUDE.md` ("Working practice — worktree (required)"). Stage explicitly, never `git add -A`.
- Emoji allowlist (`REGRESSION_PLAN.md` §0) applies to any UI copy touched in Tasks 10-11.

---

## Task 0: Confirm the SpEL-untouched assumption still holds (read-only sanity check)

No code changes. This is a 2-minute check to catch drift between this plan and the live file before Task 1 starts.

**Files:**
- Read only: `demo_api_server/services/pingoneProvisionService.js:3300-3335`

- [ ] **Step 1: Confirm the SpEL composer line number and content are unchanged**

Run:
```bash
sed -n '3300,3335p' demo_api_server/services/pingoneProvisionService.js
```
Expected: still contains
```js
await this._setResourceAttribute(a2aGwResourceResult.resource.id, 'act',
  "${{'sub': #root.context.requestData.actorToken.client_id, 'act': #root.context.requestData.subjectToken.act}}");
```
If this has moved or changed shape, stop and re-read it before proceeding — the rest of this plan assumes PingOne keeps minting the nested object here unmodified.

- [ ] **Step 2: No commit for this task** — it's a verification gate, not a change.

---

## Task 1: Shared normalization helper in demo_api_server (`utils/tokenUtils.js`)

This is the highest-leverage task: `demo_api_server/utils/tokenUtils.js`'s `decodeJwt()` is required by 20 files (server.js, resourceValidation.js, mcpToolRegistry.js, scripts/mint-gateway-token.js, scripts/verify-token-exchange.js, routes/resourceServerCC.js, routes/tokens.js, routes/agentRun.js, routes/agentInvokeRoute.js, routes/devTools.js, routes/resourceServer.js, services/customerTokenGuard.js, services/mcpToolAuthorizationService.js, services/mcpPingOneHttpAdapter.js, services/attackSimulatorService.js, services/adminTokenService.js — via agentMcpTokenService, services/agentMcpTokenService.js, services/agentPreflightService.js, services/resourceServerTesterService.js). Fixing `decodeJwt()` once makes `claims.act` a real array for every one of those callers with zero further edits to them.

**Files:**
- Modify: `demo_api_server/utils/tokenUtils.js`
- Test: `demo_api_server/tests/tokenUtils.test.js` (already exists — extend it)

**Interfaces:**
- Produces: `normalizeActChain(rawAct)` — exported from `utils/tokenUtils.js`. Signature: `(rawAct: object|Array|null|undefined) => Array<object>`. Used directly by Tasks 2 and re-implemented as a TS twin in Task 9.
- Produces: `decodeJwt(token)` now returns `{ header, claims }` where `claims.act`, if present, is always an array (never the old nested-object shape).

- [ ] **Step 1: Write the failing tests**

Add to `demo_api_server/tests/tokenUtils.test.js` (near the existing `decodeJwt` tests):

```js
const { decodeJwt, sanitizePingOneResponse, normalizeActChain } = require('../utils/tokenUtils');

describe('normalizeActChain', () => {
  test('returns [] for null/undefined', () => {
    expect(normalizeActChain(null)).toEqual([]);
    expect(normalizeActChain(undefined)).toEqual([]);
  });

  test('returns [] for a non-object', () => {
    expect(normalizeActChain('not-an-object')).toEqual([]);
  });

  test('passes an already-array value through unchanged', () => {
    const arr = [{ sub: 'agent1' }, { sub: 'agent2' }];
    expect(normalizeActChain(arr)).toBe(arr);
  });

  test('wraps a single flat object in a one-element array', () => {
    expect(normalizeActChain({ sub: 'agent1' })).toEqual([{ sub: 'agent1' }]);
  });

  test('flattens a 2-level nested chain, oldest first', () => {
    const nested = { sub: 'agent2', act: { sub: 'agent1' } };
    expect(normalizeActChain(nested)).toEqual([{ sub: 'agent1' }, { sub: 'agent2' }]);
  });

  test('flattens a 3-level nested chain, oldest first', () => {
    const nested = { sub: 'agent3', act: { sub: 'agent2', act: { sub: 'agent1' } } };
    expect(normalizeActChain(nested)).toEqual([
      { sub: 'agent1' },
      { sub: 'agent2' },
      { sub: 'agent3' },
    ]);
  });

  test('preserves each hop\'s original fields (client_id, sub together)', () => {
    const nested = { client_id: 'bff-client', sub: 'agent2', act: { sub: 'agent1' } };
    expect(normalizeActChain(nested)).toEqual([
      { sub: 'agent1' },
      { client_id: 'bff-client', sub: 'agent2' },
    ]);
  });

  test('caps at 6 hops to guard against malformed/cyclic input', () => {
    let node = { sub: 'hop0' };
    let cursor = node;
    for (let i = 1; i < 10; i += 1) {
      cursor.act = { sub: `hop${i}` };
      cursor = cursor.act;
    }
    expect(normalizeActChain(node).length).toBe(6);
  });
});

describe('decodeJwt — act claim normalization', () => {
  test('normalizes a nested act claim into an array', () => {
    const token = makeJwt(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'user-001', act: { sub: 'agent2', act: { sub: 'agent1' } } },
    );
    const result = decodeJwt(token);
    expect(result.claims.act).toEqual([{ sub: 'agent1' }, { sub: 'agent2' }]);
  });

  test('leaves claims with no act claim untouched', () => {
    const token = makeJwt({ alg: 'RS256', typ: 'JWT' }, { sub: 'user-001' });
    const result = decodeJwt(token);
    expect(result.claims.act).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && npx jest tests/tokenUtils.test.js -t "normalizeActChain" --forceExit`
Expected: FAIL with "normalizeActChain is not a function" (it isn't exported yet).

- [ ] **Step 3: Implement `normalizeActChain` and wire it into `decodeJwt`**

Replace the full contents of `demo_api_server/utils/tokenUtils.js` with:

```js
'use strict';

/**
 * tokenUtils.js — Shared JWT decoding utilities (display-only, no signature verification)
 *
 * Used by instrumented services to decode token payloads for event metadata.
 * NEVER returns raw token strings. Returns null for invalid/missing tokens.
 *
 * No imports from services, routes, or middleware — zero circular-dependency risk.
 */

/**
 * Flatten a legacy nested RFC 8693 act claim (act:{sub, act:{sub, ...}}) into an
 * ordered array — index 0 is the first/oldest delegate, the last index is the
 * current/most-recent actor. Already-array input passes through unchanged (new
 * mint paths emit arrays directly). Caps at 6 hops, matching the existing guard
 * in reportFormatter.js's delegationChain().
 *
 * @param {object|Array|null|undefined} rawAct
 * @returns {Array<object>}
 */
function normalizeActChain(rawAct) {
  if (!rawAct) { return []; }
  if (Array.isArray(rawAct)) { return rawAct; }
  if (typeof rawAct !== 'object') { return []; }
  const chain = [];
  let node = rawAct;
  let guard = 0;
  while (node && typeof node === 'object' && (node.sub || node.client_id) && guard < 6) {
    const { act: nested, ...hop } = node;
    chain.unshift(hop);
    node = nested;
    guard += 1;
  }
  return chain;
}

/**
 * Decode a JWT without signature verification.
 * Returns { header, claims } or null if the token is missing, non-string, or malformed.
 * Safe to call on any value — never throws.
 * `claims.act`, if present, is always normalized to a flat ordered array.
 *
 * @param {*} token - JWT string to decode
 * @returns {{ header: object, claims: object } | null}
 */
function decodeJwt(token) {
  if (!token || typeof token !== 'string') { return null; }
  try {
    const parts = token.split('.');
    if (parts.length !== 3) { return null; }
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.act) { claims.act = normalizeActChain(claims.act); }
    return { header, claims };
  } catch (_e) {
    return null;
  }
}

/**
 * Sanitize a PingOne API response body for safe logging.
 * Strips raw token strings and client secrets. Keeps status, claims summary, error codes.
 *
 * @param {object} body - PingOne response body
 * @returns {object} Safe object with token fields removed
 */
function sanitizePingOneResponse(body) {
  if (!body || typeof body !== 'object') { return {}; }
  // eslint-disable-next-line no-unused-vars
  const { access_token, id_token, refresh_token, client_secret, ...safe } = body;
  return safe;
}

module.exports = { decodeJwt, sanitizePingOneResponse, normalizeActChain };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && npx jest tests/tokenUtils.test.js --forceExit`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Run the full demo_api_server unit suite to confirm no existing caller broke**

Run: `cd demo_api_server && CI=true npm run test:unit`
Expected: PASS. (If something fails here, it's a caller of `decodeJwt` that assumed the old object shape and needs a Task 2+ fix — note it and continue; later tasks in this plan cover the known ones.)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/utils/tokenUtils.js demo_api_server/tests/tokenUtils.test.js
git commit -m "feat(act-claim): normalize act claim to a flat array in the shared JWT decoder"
```

---

## Task 2: Normalize the independent decode functions that don't use `tokenUtils.decodeJwt`

Several files implement their own local JWT decode instead of importing the shared one from Task 1. Each needs the same normalization inserted locally.

**Files:**
- Modify: `demo_api_server/middleware/delegationAuditLogger.js`
- Modify: `demo_api_server/routes/agentDelegation.js`
- Modify: `demo_api_server/routes/pingoneTestRoutes.js`
- Modify: `demo_api_server/services/tokenChainService.js`
- Modify: `demo_api_server/services/tokenDisplayService.js`
- Test: `demo_api_server/tests/delegationAuditLogger.test.js` (check if it exists first; create if not)
- Test: `demo_api_server/tests/tokenChainService.test.js` (check if it exists first; create if not)

**Interfaces:**
- Consumes: `normalizeActChain` from `../utils/tokenUtils` (Task 1).
- Produces: every function in these 5 files that decodes a JWT now returns `claims.act` (or `payload.act`) as a flat array; every function that reads `.sub`/`.client_id` directly off `act` now indexes the array instead.

### 2a. `middleware/delegationAuditLogger.js`

- [ ] **Step 1: Check for an existing test file**

Run: `ls demo_api_server/tests/*delegationAuditLogger* 2>/dev/null`

- [ ] **Step 2: Write a failing test** (create `demo_api_server/tests/delegationAuditLogger.test.js` if none exists; otherwise add this test to the existing file)

```js
'use strict';
const { decodeJwtClaims } = require('../middleware/delegationAuditLogger');

const makeJwt = (claims) => {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${c}.fakesig`;
};

describe('delegationAuditLogger.decodeJwtClaims', () => {
  test('normalizes a nested act claim into an array', () => {
    const token = makeJwt({ sub: 'user-001', act: { sub: 'agent2', act: { sub: 'agent1' } } });
    const result = decodeJwtClaims(token);
    expect(result.claims.act).toEqual([{ sub: 'agent1' }, { sub: 'agent2' }]);
  });
});
```

Note: `decodeJwtClaims` is currently an internal (unexported) function in this file — check the bottom `module.exports` block and add it if it's not already exported. If exporting it changes the public surface in a way that feels wrong for this file, export it only for the test via `module.exports = { extractDelegationChain, decodeJwtClaims, ...restOfExisting }` (check the actual existing export list first with `grep -n "module.exports" demo_api_server/middleware/delegationAuditLogger.js`).

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd demo_api_server && npx jest tests/delegationAuditLogger.test.js --forceExit`
Expected: FAIL — `act` is still the nested object.

- [ ] **Step 4: Fix `decodeJwtClaims`**

In `demo_api_server/middleware/delegationAuditLogger.js`, add the import near the top (after the existing `logger` require):

```js
const { normalizeActChain } = require('../utils/tokenUtils');
```

Change the function at line 18:

```js
function decodeJwtClaims(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.act) { claims.act = normalizeActChain(claims.act); }
    return { header, claims };
  } catch {
    return null;
  }
}
```

Then check `extractDelegationChain` (starts line 35) for any `.act.sub` / `.act.client_id` access and, if present, change it to index the array (most recent actor = `claims.act[claims.act.length - 1]`). Read the function body first — the earlier research pass only confirmed the decode function itself accesses `act`; if `extractDelegationChain` reads it too, apply the same array-indexing pattern used in Task 4/5 below.

- [ ] **Step 5: Run it, confirm it passes**

Run: `cd demo_api_server && npx jest tests/delegationAuditLogger.test.js --forceExit`

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/middleware/delegationAuditLogger.js demo_api_server/tests/delegationAuditLogger.test.js
git commit -m "fix(act-claim): normalize act claim in delegationAuditLogger's local JWT decoder"
```

### 2b. `routes/agentDelegation.js` — decode + mint-fallback

This file both decodes an exchanged token AND mints a fallback `act` claim in JS (line 151) when PingOne's response doesn't include one. Both need fixing.

**Files:**
- Modify: `demo_api_server/routes/agentDelegation.js`
- Test: `demo_api_server/tests/agentDelegation.test.js` (check for existing; add to it or create)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// If demo_api_server/tests/agentDelegation.test.js already exists, add this
// describe block to it instead of creating a new file — check first with:
// ls demo_api_server/tests/*agentDelegation*
const request = require('supertest');
// ... existing test setup for this route (mock oauthService.performTokenExchangeWithActor
// and oauthService.getClientCredentialsTokenAs per whatever pattern the existing test
// file already uses) ...

test('POST /delegate wraps the fallback act claim in an array when PingOne omits act', async () => {
  // Arrange: mock performTokenExchangeWithActor to return a token whose payload has
  // NO act claim (the fallback branch at line 151 fires).
  // Act: POST /delegate with a valid Bearer user token.
  // Assert: response.body.act === [{ sub: <agentClientId> }]
});
```

Since this route's exact existing test scaffolding (mocks for `oauthService`, `configStore.getEffective`) isn't visible from this plan alone, the implementer should open `demo_api_server/tests/agentDelegation.test.js` first (or the nearest existing test covering this route) and add the case above using that file's existing mock setup, rather than inventing new scaffolding.

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_api_server && npx jest tests/agentDelegation.test.js --forceExit`

- [ ] **Step 3: Fix the decode function and the mint-fallback**

Add the import near the top of `demo_api_server/routes/agentDelegation.js` (after `const configStore = require('../services/configStore');`):

```js
const { normalizeActChain } = require('../utils/tokenUtils');
```

Change `decodeJwtPayload` (line 27):

```js
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (claims.act) { claims.act = normalizeActChain(claims.act); }
    return claims;
  } catch {
    return null;
  }
}
```

Change the mint-fallback at line 151, inside the `return res.json({...})` block:

```js
      act: exchangedClaims.act || [{ sub: agentClientId }],
```
(was: `act: exchangedClaims.act || { sub: agentClientId },`)

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd demo_api_server && npx jest tests/agentDelegation.test.js --forceExit`

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/agentDelegation.js demo_api_server/tests/agentDelegation.test.js
git commit -m "fix(act-claim): array-wrap agentDelegation's act claim (decode + mint fallback)"
```

### 2c. `routes/pingoneTestRoutes.js` — `decodeJwtForDisplay`

**Files:**
- Modify: `demo_api_server/routes/pingoneTestRoutes.js`

- [ ] **Step 1: Add the import**

Near the top of the file, add:
```js
const { normalizeActChain } = require('../utils/tokenUtils');
```
(Check the existing require block first — this file is large; place it alongside the other `require`s at the top, matching the existing grouping style.)

- [ ] **Step 2: Fix `decodeJwtForDisplay`** (line 66)

```js
function decodeJwtForDisplay(token) {
  if (!token || typeof token !== 'string') { return null; }
  try {
    const parts = token.split('.');
    if (parts.length !== 3) { return null; }
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.act) { payload.act = normalizeActChain(payload.act); }
    return { header, payload };
  } catch (_e) {
    return null;
  }
}
```

This file is a diagnostics/provisioning route file, not covered by focused unit tests per-function in the research pass — verify with the full suite instead of a new targeted test.

- [ ] **Step 3: Run the full demo_api_server unit suite**

Run: `cd demo_api_server && CI=true npm run test:unit`
Expected: PASS (no regression — this route is diagnostic-only, exercised indirectly if at all).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/routes/pingoneTestRoutes.js
git commit -m "fix(act-claim): normalize act claim in pingoneTestRoutes' display decoder"
```

### 2d. `services/tokenChainService.js` — 3 independent `jwt.decode()` sites + direct field access

This file never uses the shared decoder — it calls `jwt.decode()` (the `jsonwebtoken` library) directly in three places, and reads `.act?.client_id` as a single-object field in several more.

**Files:**
- Modify: `demo_api_server/services/tokenChainService.js`
- Test: `demo_api_server/tests/tokenChainService.test.js` (check for existing first)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// Add to demo_api_server/tests/tokenChainService.test.js if it exists; else create it.
const jwt = require('jsonwebtoken');
const tokenChainService = require('../services/tokenChainService');

function makeToken(claims) {
  return jwt.sign(claims, 'test-secret', { algorithm: 'HS256' });
}

describe('tokenChainService — act claim array handling', () => {
  test('trackTokenEvent stores act as an array and tokenAgent as the most recent actor', async () => {
    const token = makeToken({
      sub: 'user-001',
      act: { sub: 'agent2', client_id: 'agent2-client', act: { sub: 'agent1' } },
    });
    const event = await tokenChainService.trackTokenEvent({
      id: 'test-evt-1',
      eventType: 'exchange',
      token,
      userId: 'user-001',
    });
    expect(event.tokenAct).toEqual([{ sub: 'agent1' }, { client_id: 'agent2-client', sub: 'agent2' }]);
    expect(event.tokenAgent).toBe('agent2-client');
  });

  test('classifyTokenType still recognizes an agent token by the array-shaped act claim', () => {
    const token = makeToken({ sub: 'user-001', act: { client_id: 'agent2-client', sub: 'agent2' } });
    expect(tokenChainService.classifyTokenType(token)).toBe('agent_token');
  });
});
```

Check `module.exports` at the bottom of `tokenChainService.js` first — `classifyTokenType` may not currently be exported; export it if the test needs it (it's already an internal named function, just add it to the exports object).

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_api_server && npx jest tests/tokenChainService.test.js --forceExit`

- [ ] **Step 3: Fix the file**

Add the import near the top of `demo_api_server/services/tokenChainService.js` (alongside the existing `jwt` require):

```js
const { normalizeActChain } = require('../utils/tokenUtils');
```

Change `classifyTokenType` (lines 35-57):

```js
function classifyTokenType(token, context = {}) {
  if (!token) return 'unknown';

  try {
    const claims = jwt.decode(token);
    if (!claims) return 'invalid';
    if (claims.act) { claims.act = normalizeActChain(claims.act); }

    const currentActor = claims.act && claims.act.length ? claims.act[claims.act.length - 1] : null;

    // Check for agent token (has specific scopes or client_id in context)
    if (currentActor?.client_id || claims.scope?.includes('agent:')) {
      return 'agent_token';
    }

    // Check for exchanged token (has both sub and act)
    if (claims.sub && claims.act && claims.act.length) {
      return 'exchanged_token';
    }

    // Default to user token
    return 'user_token';
  } catch (err) {
    return 'invalid';
  }
}
```

Change `generateTokenDescription` (lines 60-76), the `act:` interpolation at line 66:

```js
      if (tokenType === 'exchanged_token') {
        const currentActor = claims.act && claims.act.length ? claims.act[claims.act.length - 1] : null;
        return `Token exchange: user_token + agent_token → exchanged_token (sub: ${claims.sub || 'unknown'}, act: ${currentActor?.client_id || 'unknown'})`;
      }
```

Change `extractJwtClaims` (lines 79-85):

```js
function extractJwtClaims(token) {
  try {
    const claims = jwt.decode(token) || {};
    if (claims.act) { claims.act = normalizeActChain(claims.act); }
    return claims;
  } catch (err) {
    return {};
  }
}
```

Change `trackTokenEvent`'s field construction (lines 124-126):

```js
    tokenSub: claims.sub || '',
    tokenAct: claims.act || null,
    tokenAgent: (claims.act && claims.act.length ? claims.act[claims.act.length - 1]?.client_id : null) || null,
```

Change `trackTokenEvent`'s `tokenType` fallback derivation (line 109), which checks `claims.sub && claims.act`:

```js
    : (additionalData.tokenType
        || (claims.sub && claims.act && claims.act.length ? 'exchanged_token' : (claims.sub ? 'user_token' : 'unknown')));
```

Change `synthesizeFromSession` (lines 232-249):

```js
function synthesizeFromSession(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') return [];
  try {
    const claims = jwt.decode(accessToken);
    if (!claims || !claims.sub) return [];
    if (claims.act) { claims.act = normalizeActChain(claims.act); }
    const currentActor = claims.act && claims.act.length ? claims.act[claims.act.length - 1] : null;
    return [{
      id: 'synthetic-session-' + String(claims.sub).slice(0, 8),
      timestamp: new Date().toISOString(),
      eventType: 'auth',
      tokenType: 'user_token',
      tokenSub: claims.sub,
      tokenAct: claims.act || null,
      tokenAgent: currentActor?.client_id || null,
      scopes: claims.scope
        ? (Array.isArray(claims.scope) ? claims.scope : claims.scope.split(' '))
        : [],
      audience: Array.isArray(claims.aud) ? claims.aud.join(' ') : (claims.aud || ''),
      issuer: claims.iss || '',
      // ... rest of the object unchanged — read the current file to preserve
      // every other field exactly, only the act/tokenAgent lines above change.
```

(The implementer should open the file at this point and apply only the `tokenAct`/`tokenAgent` line changes shown, leaving the rest of the object literal exactly as it is today — the read above stopped at line 249 so the remaining fields weren't captured verbatim in this plan.)

There is a second, near-identical event-shaping site the research pass located around lines 235-244 in a different function (referred to there as "a second event-shaping site, likely `getMCPToolCalls` or similar" with `tokenAgent: (claims.act && claims.act.client_id) || null`). Search for it explicitly before finishing this task:

```bash
grep -n "claims.act" demo_api_server/services/tokenChainService.js
```
Apply the same `claims.act[claims.act.length - 1]?.client_id` pattern to every match this turns up beyond the ones already listed above.

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd demo_api_server && npx jest tests/tokenChainService.test.js --forceExit`

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/tokenChainService.js demo_api_server/tests/tokenChainService.test.js
git commit -m "fix(act-claim): array-aware act claim handling in tokenChainService"
```

### 2e. `services/tokenDisplayService.js` — `decodeToken` + field access

**Files:**
- Modify: `demo_api_server/services/tokenDisplayService.js`
- Test: `demo_api_server/tests/tokenDisplayService.test.js` (check for existing first)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const jwt = require('jsonwebtoken');
const tokenDisplayService = require('../services/tokenDisplayService');

function makeToken(claims) {
  return jwt.sign(claims, 'test-secret', { algorithm: 'HS256' });
}

describe('tokenDisplayService — act claim array handling', () => {
  test('getTokenSummary reports the most recent actor from an array-shaped act claim', () => {
    const token = makeToken({
      sub: 'user-001',
      act: { sub: 'agent2', client_id: 'agent2-client', act: { sub: 'agent1' } },
    });
    const summary = tokenDisplayService.getTokenSummary(token);
    expect(summary.hasActor).toBe(true);
    expect(summary.actor).toEqual({ clientId: 'agent2-client', sub: 'agent2' });
  });

  test('classifyTokenType still recognizes an exchanged token', () => {
    const token = makeToken({ sub: 'user-001', act: { client_id: 'agent2-client', sub: 'agent2' } });
    // classifyTokenType in this file takes a payload object, not a raw token — check
    // the actual exported signature (jwt.decode it first if needed) before calling.
  });
});
```

Check `module.exports` at the bottom of `tokenDisplayService.js` — confirm `getTokenSummary` and `classifyTokenType` are exported (adjust the test to whatever the real exported surface is; the second test's exact call may need `jwt.decode(token)` first if `classifyTokenType` takes a payload object rather than a token string, per the code read at lines 128-153).

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_api_server && npx jest tests/tokenDisplayService.test.js --forceExit`

- [ ] **Step 3: Fix the file**

Add the import near the top (after `const jwt = require('jsonwebtoken');`):

```js
const { normalizeActChain } = require('../utils/tokenUtils');
```

Change `decodeToken` (lines 15-31):

```js
function decodeToken(token) {
  if (!token) return null;

  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) return null;
    if (decoded.payload && decoded.payload.act) {
      decoded.payload.act = normalizeActChain(decoded.payload.act);
    }

    return {
      header: decoded.header,
      payload: decoded.payload,
      signature: decoded.signature
    };
  } catch (err) {
    console.error('[tokenDisplayService] Failed to decode token:', err.message);
    return null;
  }
}
```

Change `getTokenSummary`'s `actor` field (lines 115-118):

```js
    actor: payload.act && payload.act.length ? {
      clientId: payload.act[payload.act.length - 1].client_id,
      sub: payload.act[payload.act.length - 1].sub
    } : null,
    hasActor: !!(payload.act && payload.act.length),
```

Change `classifyTokenType`'s actor checks (lines 128-137):

```js
function classifyTokenType(payload) {
  if (!payload) return 'unknown';

  // Check for actor claim (RFC 8693 token exchange)
  if (payload.act && payload.act.length) {
    const currentActor = payload.act[payload.act.length - 1];
    if (payload.sub && currentActor.client_id) {
      return 'exchanged_token';
    }
    return 'actor_token';
  }
```

Change the `user_token` check at line 148: `if (payload.sub && !payload.act) {` becomes:

```js
  if (payload.sub && (!payload.act || !payload.act.length)) {
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd demo_api_server && npx jest tests/tokenDisplayService.test.js --forceExit`

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/tokenDisplayService.js demo_api_server/tests/tokenDisplayService.test.js
git commit -m "fix(act-claim): array-aware act claim handling in tokenDisplayService"
```

### 2f. `services/agentMcpTokenService.js` — hardcoded 2-level access in `_performTwoExchangeDelegation`

This function's `decodeJwtClaims` call already inherits normalization for free from Task 1 (it delegates straight through to `tokenUtils.decodeJwt`). But it separately does its own fixed-depth-2 field access when building the UI-facing delegation summary — that needs fixing independently.

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js`
- Test: `demo_api_server/tests/agentMcpTokenService.test.js` (check for existing `_performTwoExchangeDelegation` coverage first)

- [ ] **Step 1: Read the current code around lines 2470-2510** to get the exact surrounding context (this plan's research pass quoted only the two matching lines, not the full block):

Run: `sed -n '2460,2515p' demo_api_server/services/agentMcpTokenService.js`

- [ ] **Step 2: Write the failing test** — construct a `finalClaims.act` as a 2-element array (`[{sub: 'generalist'}, {sub: 'specialist'}]`) and assert the function's nested-actor-ok check and any UI text derived from it still correctly identifies both hops. Match whatever the existing test file's setup pattern for this function already is (open it first).

- [ ] **Step 3: Fix the two sites**

Replace the depth-2 boolean check (was `const nestedActOk = !!finalClaims?.act?.sub && !!finalClaims?.act?.act?.sub;`):

```js
const nestedActOk = Array.isArray(finalClaims?.act) && finalClaims.act.length >= 2
  && !!(finalClaims.act[finalClaims.act.length - 1]?.sub || finalClaims.act[finalClaims.act.length - 1]?.client_id)
  && !!(finalClaims.act[finalClaims.act.length - 2]?.sub || finalClaims.act[finalClaims.act.length - 2]?.client_id);
```

Then fix the UI-text-building lines (originally ~2500-2507, referencing `act.sub` / `act.act.sub` directly) to read `finalClaims.act[finalClaims.act.length - 1]` (current actor) and `finalClaims.act[finalClaims.act.length - 2]` (prior actor) instead — apply the exact same "last element = current, second-to-last = prior" substitution used throughout this plan, matching whatever text template the real code at that location uses (read it in Step 1 before editing; don't invent the surrounding string).

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd demo_api_server && npx jest tests/agentMcpTokenService.test.js --forceExit`

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js demo_api_server/tests/agentMcpTokenService.test.js
git commit -m "fix(act-claim): array-indexed actor access in agentMcpTokenService's two-exchange delegation summary"
```

---

## Task 3: Fix the recursive depth-counter in `a2aDelegationService.js`

**Files:**
- Modify: `demo_api_server/services/a2aDelegationService.js`
- Test: `demo_api_server/tests/a2aDelegationService.test.js` (check for existing `countActDepth` coverage first)

**Interfaces:**
- Produces: `countActDepth(act)` keeps its name and signature (`(act) => number`) so every existing caller is unaffected — only its internal implementation changes.

- [ ] **Step 1: Write the failing test**

```js
// Add to the existing a2aDelegationService test file, or create
// demo_api_server/tests/a2aDelegationService.countActDepth.test.js if no
// existing file exports/tests this function. Check first:
// grep -n "countActDepth" demo_api_server/services/a2aDelegationService.js demo_api_server/tests/*.js
const { countActDepth } = require('../services/a2aDelegationService');
// (export countActDepth from the module.exports block at the bottom of
// a2aDelegationService.js if it isn't already exported — check first.)

describe('countActDepth — array shape', () => {
  test('returns 0 for no act claim', () => {
    expect(countActDepth(undefined)).toBe(0);
    expect(countActDepth(null)).toBe(0);
  });
  test('returns the array length for an array-shaped act claim', () => {
    expect(countActDepth([{ sub: 'agent1' }])).toBe(1);
    expect(countActDepth([{ sub: 'agent1' }, { sub: 'agent2' }])).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_api_server && npx jest tests/a2aDelegationService.test.js -t "countActDepth" --forceExit`

- [ ] **Step 3: Fix `countActDepth`** (lines 598-607)

```js
/** Count the number of hops in an act delegation chain: act:[{agent1},{agent2}] → 2. */
function countActDepth(act) {
  if (!act) return 0;
  return Array.isArray(act) ? act.length : 0;
}
```

Since Task 1/2 guarantee `act` arrives already normalized to an array at every call site of `countActDepth` in this codebase, the `Array.isArray` branch is the only live path — the `0` fallback is defensive only, for any caller that hasn't gone through normalization yet.

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd demo_api_server && npx jest tests/a2aDelegationService.test.js -t "countActDepth" --forceExit`

- [ ] **Step 5: Run the file's full test suite** (this service has other tests around `delegateToSpecialist` that decode real exchanged tokens — confirm they still pass with the array shape)

Run: `cd demo_api_server && npx jest tests/a2aDelegationService.test.js --forceExit`

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/a2aDelegationService.js demo_api_server/tests/a2aDelegationService.test.js
git commit -m "fix(act-claim): countActDepth reads array length instead of walking nested act.act"
```

---

## Task 4: Fix `mcpToolAuthorizationService.js` — the BFF's canonical "who is acting" resolver

This is the highest-consequence file outside minting itself: `decodeMcpTokenFacts` computes `ActClientId` / `NestedActClientId`, which flow straight into every MCP tool-call authorization decision (both the BFF gate and, via `buildMcpDelegationParameters`, into live PingOne Authorize).

**Files:**
- Modify: `demo_api_server/services/mcpToolAuthorizationService.js`
- Test: `demo_api_server/tests/mcpToolAuthorizationService.test.js` (check for existing `nestedActIdFromClaim`/`decodeMcpTokenFacts` coverage first)

**Interfaces:**
- Produces: `nestedActIdFromClaim(act)` keeps its name/signature; internal implementation changes from "read `.act.act`" to "read the second-to-last array element."
- Produces: `decodeMcpTokenFacts({req, agentToken, userSub})`'s returned `actClientId` (most-recent actor) and `nestedActClientId` (actor before them) fields are unchanged in meaning, only in how they're derived.

- [ ] **Step 1: Write the failing tests**

```js
// Add to demo_api_server/tests/mcpToolAuthorizationService.test.js (check it exists
// first: ls demo_api_server/tests/*mcpToolAuthorizationService*)
const { nestedActIdFromClaim } = require('../services/mcpToolAuthorizationService');
// (export nestedActIdFromClaim if not already exported — check the bottom of the file.)

describe('nestedActIdFromClaim — array shape', () => {
  test('returns "" for no act claim or a single-hop chain', () => {
    expect(nestedActIdFromClaim(undefined)).toBe('');
    expect(nestedActIdFromClaim([{ sub: 'agent1' }])).toBe('');
  });
  test('returns the second-to-last hop\'s id for a 2-hop chain', () => {
    expect(nestedActIdFromClaim([{ sub: 'agent1' }, { client_id: 'agent2-client', sub: 'agent2' }])).toBe('agent1');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_api_server && npx jest tests/mcpToolAuthorizationService.test.js -t "nestedActIdFromClaim" --forceExit`

- [ ] **Step 3: Fix `nestedActIdFromClaim`** (lines 39-44)

```js
/**
 * Extract the id of the actor BEFORE the current one, for a multi-hop RFC 8693
 * chain (act is an ordered array; the current actor is the last element, the
 * one before them — if any — is the second-to-last).
 * @param {Array<object>|null|undefined} act
 * @returns {string}
 */
function nestedActIdFromClaim(act) {
  if (!Array.isArray(act) || act.length < 2) return '';
  const priorActor = act[act.length - 2];
  return String(priorActor.client_id || priorActor.sub || '');
}
```

- [ ] **Step 4: Fix `decodeMcpTokenFacts`'s `actClientIdFromToken` / `nestedActClientId` computation** (lines 508-524)

```js
  const decoded = decodeJwtClaims(agentToken);
  const claims = decoded?.claims || {};
  const subjectId = userSub || claims.sub || '';
  const tokenAudience = claims.aud != null ? (Array.isArray(claims.aud) ? claims.aud.join(' ') : String(claims.aud)) : '';
  // RFC 8693 §4.1: act.sub is the canonical actor identifier.
  // act.client_id is PingOne-specific; fall back to act.sub when absent.
  // act is now an ordered array — the current/most recent actor is the last element.
  const currentActor = Array.isArray(claims.act) && claims.act.length ? claims.act[claims.act.length - 1] : null;
  const actClientIdFromToken = currentActor
    ? String(currentActor.client_id || currentActor.sub || '')
    : '';
  // Bridge fallback (actor-bridged modes only — see isActorBridgedMode()): ...
  // (leave the surrounding comment block and the isActorBridgedMode()/buildActorBridgeHeaders()
  // logic exactly as-is — only the two lines above and the nestedActClientId line below change)
  const actClientId = actClientIdFromToken
    || (isActorBridgedMode() ? (buildActorBridgeHeaders()['X-Act-Client-Id'] || '') : '');
  const nestedActClientId = nestedActIdFromClaim(claims.act);
```

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `cd demo_api_server && npx jest tests/mcpToolAuthorizationService.test.js --forceExit`

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/mcpToolAuthorizationService.js demo_api_server/tests/mcpToolAuthorizationService.test.js
git commit -m "fix(act-claim): array-indexed actor resolution in mcpToolAuthorizationService"
```

---

## Task 5: Fix `delegationChainValidationService.js`'s `reconstructDelegationChain`

This function currently produces at most 2 chain nodes (`intermediate`, `mcp_server`) no matter how deep the real chain is, because it only ever reads exactly `act.sub` and `act.act.sub` — never `act.act.act.sub`. Once `act` is a real array, this becomes a straightforward `.map()` and, as a side effect, correctly represents chains deeper than 2 for the first time.

**Files:**
- Modify: `demo_api_server/services/delegationChainValidationService.js`
- Test: `demo_api_server/tests/delegationChainValidationService.test.js` (check for existing `reconstructDelegationChain` coverage first)

- [ ] **Step 1: Write the failing test**

```js
// Add to demo_api_server/tests/delegationChainValidationService.test.js — check for
// the existing test's token-building helper and reuse it if present, otherwise:
const jwt = require('jsonwebtoken');
function makeToken(claims) {
  return jwt.sign(claims, 'test-secret', { algorithm: 'HS256' });
}

describe('reconstructDelegationChain — array act', () => {
  test('produces one chain node per hop in a 2-hop act array', async () => {
    const service = new DelegationChainValidationService(); // match the existing class instantiation pattern in this test file
    const userToken = makeToken({ sub: 'user-001', may_act: { sub: 'agent1' } });
    const exchangedToken = makeToken({
      sub: 'user-001',
      aud: 'mcp-gateway',
      act: [{ sub: 'agent1' }, { sub: 'agent2' }],
    });
    const chain = await service.reconstructDelegationChain(userToken, exchangedToken);
    const types = chain.map((n) => n.type);
    expect(types).toEqual(['user', 'agent', 'intermediate', 'mcp_server']);
  });
});
```

Match this to whatever instantiation/import pattern the existing test file for this service already uses (class vs singleton export) — check `demo_api_server/services/delegationChainValidationService.js`'s `module.exports` and the existing test file's `require` line before writing this.

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_api_server && npx jest tests/delegationChainValidationService.test.js -t "reconstructDelegationChain" --forceExit`

- [ ] **Step 3: Fix `reconstructDelegationChain`** (lines 204-262)

```js
  async reconstructDelegationChain(userToken, exchangedToken) {
    const startTime = Date.now();

    try {
      // Decode tokens
      const userClaims = this.decodeTokenClaims(userToken);
      const exchangedClaims = this.decodeTokenClaims(exchangedToken);

      // Build chain nodes
      const chain = [];

      // User node
      const userNode = new ChainNode('user', userClaims.sub, {
        timestamp: new Date().toISOString(),
        may_act: userClaims.may_act,
        scopes: this.parseScopes(userClaims.scope)
      });
      chain.push(userNode);

      // Agent node (from may_act)
      if (userClaims.may_act && userClaims.may_act.sub) {
        const agentNode = new ChainNode('agent', normalizeChainSubject(userClaims.may_act.sub), {
          timestamp: new Date().toISOString(),
          source: 'user_token.may_act'
        });
        chain.push(agentNode);
      }

      // One node per delegation hop, oldest to newest — act is an ordered array.
      // The last hop is labelled 'mcp_server' (the immediate actor, matching the
      // old act.sub role); any earlier hops are labelled 'intermediate' (matching
      // the old act.act.sub role, now generalized to N hops instead of a fixed 1).
      const actChain = Array.isArray(exchangedClaims.act) ? exchangedClaims.act : [];
      actChain.forEach((hop, index) => {
        const isLast = index === actChain.length - 1;
        const nodeType = isLast ? 'mcp_server' : 'intermediate';
        const extra = isLast
          ? {
              timestamp: new Date().toISOString(),
              audience: exchangedClaims.aud,
              scopes: this.parseScopes(exchangedClaims.scope),
              source: `exchanged_token.act[${index}]`
            }
          : {
              timestamp: new Date().toISOString(),
              source: `exchanged_token.act[${index}]`
            };
        chain.push(new ChainNode(nodeType, normalizeChainSubject(hop.sub || hop.client_id), extra));
      });

      // Check timeout
      if (Date.now() - startTime > this.rules.timeouts.chain_reconstruction) {
        throw new Error('Chain reconstruction timeout');
      }

      return chain;

    } catch (error) {
      throw new Error(`Chain reconstruction failed: ${error.message}`, { cause: error });
    }
  }
```

Note the behavior change flagged in research: for a chain deeper than 2 hops, this now emits more than one `intermediate` node (previously capped at exactly one regardless of real depth). Confirm no caller of this chain (report renderers, UI) hardcodes an assumption of "at most one intermediate node" before treating this as done — grep for `.type === 'intermediate'` usage across the codebase as part of Step 4 below.

- [ ] **Step 4: Check for callers assuming at most one `intermediate` node**

Run: `grep -rn "'intermediate'" demo_api_server demo_api_ui --include="*.js" --include="*.jsx" | grep -v node_modules | grep -v test`

If any caller indexes into the chain array assuming a fixed position (e.g. `chain[2]` for the mcp_server node) rather than filtering by `.type`, note it — that's a latent bug this task's shape change would expose, and it needs a matching fix (find by `.type`, not fixed index).

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `cd demo_api_server && npx jest tests/delegationChainValidationService.test.js --forceExit`

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/delegationChainValidationService.js demo_api_server/tests/delegationChainValidationService.test.js
git commit -m "fix(act-claim): reconstructDelegationChain maps over the act array instead of a fixed 2-level walk"
```

---

## Task 6: Fix `reportFormatter.js`'s `delegationChain` narrative builder

**Files:**
- Modify: `demo_api_server/services/reportFormatter.js`
- Test: `demo_api_server/tests/reportFormatter.test.js` (check for existing `delegationChain` coverage first)

- [ ] **Step 1: Write the failing test**

```js
// Add to demo_api_server/tests/reportFormatter.test.js — check for an existing
// delegationChain describe block first and extend it, or create one.
const { delegationChain } = require('../services/reportFormatter');
// (export delegationChain if not already exported — check the file's module.exports.)

describe('delegationChain — array act', () => {
  test('builds the narrative string from an ordered act array', () => {
    const result = delegationChain({ sub: 'user-001', act: [{ sub: 'agent1' }, { sub: 'agent2' }] });
    expect(result).toEqual({ chain: 'user-001 → agent1 → agent2', depth: 2 });
  });
  test('returns null when there is no act claim', () => {
    expect(delegationChain({ sub: 'user-001' })).toBeNull();
  });
  test('returns null when act is an empty array', () => {
    expect(delegationChain({ sub: 'user-001', act: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_api_server && npx jest tests/reportFormatter.test.js -t "delegationChain" --forceExit`

- [ ] **Step 3: Fix `delegationChain`** (lines 49-63)

```js
/**
 * Build a readable delegation order from the act array.
 * act:[{generalist},{specialist}] on sub:user → "user → generalist → specialist".
 * Returns { chain: string, depth: number } or null when there is no act claim.
 */
function delegationChain(claims) {
  if (!claims || !Array.isArray(claims.act) || claims.act.length === 0) { return null; }
  const actors = claims.act.map((hop) => hop.sub || hop.client_id).filter(Boolean);
  if (actors.length === 0) { return null; }
  const order = [claims.sub || 'user', ...actors];
  return { chain: order.join(' → '), depth: actors.length };
}
```

Note the ordering change: the old code walked outermost-to-innermost then reversed (`actors.slice().reverse()`) because the nested object put the *current* actor outermost. The array is already oldest-first, so no reverse is needed — `claims.act.map(...)` directly produces delegation order.

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd demo_api_server && npx jest tests/reportFormatter.test.js --forceExit`

- [ ] **Step 5: Check the two call sites still gate correctly**

Read `demo_api_server/services/reportFormatter.js:132-139` and `:440-445` (the Markdown/HTML report call sites gating on `del.depth >= 2` for the "A2A specialist delegation" badge) — confirm `depth` still means the same thing (number of hops) post-fix. It does (both old and new implementations produce `actors.length`), so no further change needed there — this step is a read-only confirmation.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/reportFormatter.js demo_api_server/tests/reportFormatter.test.js
git commit -m "fix(act-claim): delegationChain narrative builder reads the act array directly"
```

---

## Task 7: Fix `demo_authz_server/routes/token.js`'s mint site

The mock RFC 8693 token-exchange endpoint mints a single-object `act` claim; this needs to become a one-element array to match the new contract everywhere else. (This mock currently has no mechanism to represent multi-hop chains — it only ever sees one actor token per call. That limitation is unchanged by this task; only the shape of what it mints changes.)

**Files:**
- Modify: `demo_authz_server/routes/token.js`
- Test: whatever existing test covers this route — check `demo_authz_server/*.test.js` for one exercising `/as/token` or `buildDelegatedToken` first.

- [ ] **Step 1: Check for existing test coverage**

Run: `grep -rln "buildDelegatedToken\|as/token" demo_authz_server/*.test.js 2>/dev/null`

- [ ] **Step 2: Write the failing test** (add to whatever file Step 1 found, or create `demo_authz_server/token.test.js` if none exists)

```js
'use strict';
process.env.AUTHZ_JWT_SECRET = process.env.AUTHZ_JWT_SECRET || 'test-secret';
const jwt = require('jsonwebtoken');
const tokenHandler = require('./routes/token'); // adjust the relative path to match this test file's actual location

function makeToken(claims) {
  return jwt.sign(claims, process.env.AUTHZ_JWT_SECRET, { algorithm: 'HS256' });
}

test('token exchange mints act as a one-element array when an actor token is present', async () => {
  const subjectToken = makeToken({ sub: 'user-001' });
  const actorToken = makeToken({ sub: 'agent1-client' });
  const req = {
    body: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      actor_token: actorToken,
      audience: 'mcp-gateway',
      scope: 'read',
    },
  };
  let statusCode;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await tokenHandler(req, res);
  const decoded = jwt.decode(body.access_token);
  expect(decoded.act).toEqual([{ sub: 'agent1-client' }]);
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd demo_authz_server && npx jest token.test.js --forceExit` (adjust the test filename/path to match Step 2)

- [ ] **Step 4: Fix `buildDelegatedToken`** (lines 81-84)

```js
  // Add act claim if actor token was provided
  if (actClaim) {
    payload.act = [{ sub: actClaim }];
  }
```

Also fix the log line at line 120, which reads `payload.act?.sub`:

```js
    console.log(`[AuthzServer/token] RFC 8693 exchange → sub=${payload.sub} aud=${audience} act=${payload.act?.[0]?.sub || '(none)'} scopes="${scopes}"`);
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `cd demo_authz_server && npx jest token.test.js --forceExit`

- [ ] **Step 6: Run the parity tests** — these check that the mock engine agrees with the real P1AZ snapshot; confirm they still pass since `decision.js` reads pre-computed `ActChainDepth`/`NestedActClientId` params (untouched by this task) rather than the raw `act` shape.

Run: `cd demo_authz_server && npx jest importSnapshot.parity.test.js decision.a2a.test.js --forceExit`

- [ ] **Step 7: Commit**

```bash
git add demo_authz_server/routes/token.js demo_authz_server/*.test.js
git commit -m "fix(act-claim): mock token-exchange endpoint mints act as an array"
```

---

## Task 8: Update `middleware/testTokenGenerator.js` fixtures

**Files:**
- Modify: `demo_api_server/middleware/testTokenGenerator.js`
- Check callers: any test file calling `generateAgentToken()` and asserting on `act.client_id`/`act.sub` shape directly (search before editing).

- [ ] **Step 1: Find callers that assert on the current single-object shape**

Run: `grep -rln "generateAgentToken\b" demo_api_server/tests demo_api_server/**/*.test.js 2>/dev/null | grep -v node_modules`

For each hit, check whether it does something like `expect(decoded.act.sub).toBe(...)` — those will need the same array-indexing update as everywhere else (`decoded.act[0].sub`, since this fixture is single-hop).

- [ ] **Step 2: Update `generateAgentToken`** (lines 101-112) to mint an array

```js
function generateAgentToken() {
  return generateTestToken({
    sub: 'ai-agent-core-client',
    aud: 'https://mcp-server.banking-demo.com',
    scope: ['agent', 'mcp:invoke'],  // Agent-only scopes
    act: [{
      client_id: 'mcp-agent',
      sub: 'test-user-123'
    }],
    expiresIn: 3600
  });
}
```

- [ ] **Step 3: Add a new multi-hop fixture generator** — the research pass confirmed there is currently NO fixture for the nested/multi-hop shape anywhere in this file. Add one so future tests can exercise a 2-hop chain without hand-building a JWT:

```js
/**
 * Generate a 2-hop A2A delegation token (specialist acting on behalf of a user,
 * having received delegation from a generalist agent).
 * Scenario: A2A specialist tool call, depth-2 act chain.
 */
function generateA2aDelegationToken() {
  return generateTestToken({
    sub: 'test-user-123',
    aud: 'https://mcp-server.banking-demo.com',
    scope: ['agent', 'mcp:invoke'],
    act: [
      { client_id: 'generalist-agent', sub: 'test-user-123' },
      { client_id: 'specialist-agent', sub: 'test-user-123' },
    ],
    expiresIn: 3600
  });
}
```

- [ ] **Step 4: Export the new generator**

At the bottom `module.exports` block:

```js
module.exports = {
  generateTestToken,
  generateWrongScopeToken,
  generateWrongAudToken,
  generateMissingActToken,
  generateAgentToken,
  generateA2aDelegationToken,
  generateExpiredToken,
  decodeTestToken,
  TEST_SECRET
};
```

- [ ] **Step 5: Fix any callers found in Step 1** to index the array (e.g. `decoded.act[0].sub` instead of `decoded.act.sub`).

- [ ] **Step 6: Run the full demo_api_server unit suite**

Run: `cd demo_api_server && CI=true npm run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/middleware/testTokenGenerator.js
# plus any caller test files fixed in Step 5
git commit -m "feat(act-claim): array-shaped test fixtures + new 2-hop A2A delegation fixture"
```

---

## Task 9: `demo_mcp_gateway` (TypeScript) — the real, non-simulated agent-traffic path

This is a fully independent implementation that duplicates the BFF's `act`-reading and depth-counting logic in TypeScript. It's the code path real (non-simulated) agent traffic actually goes through — do not skip this subsystem.

**Files:**
- Modify: `demo_mcp_gateway/src/tokenValidator.ts`
- Modify: `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts`
- Modify: `demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts`
- Modify: `demo_mcp_gateway/src/pingAuthorizeGuard.ts`
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`
- Modify: `demo_mcp_gateway/src/index.ts`
- Test: existing files under `demo_mcp_gateway/tests/` covering these — check which ones with `grep -rln "actChainDepth\|nestedActClientId\|DecodedGatewayToken" demo_mcp_gateway/tests/`

**Interfaces:**
- Produces: `DecodedGatewayToken.act` type changes from `{ sub?: string; client_id?: string; act?: {...} }` to `Array<{ sub?: string; client_id?: string }>`.
- Produces: `actChainDepth(act: unknown): number` keeps its signature; now reads `.length`.
- Produces: `nestedActClientId(act: unknown): string` keeps its signature; now reads the second-to-last array element.
- Consumes: nothing new from other tasks — this subsystem's normalization happens at its own decode boundary (`validateInboundToken` in `tokenValidator.ts`), independent of demo_api_server's Task 1.

### 9a. Update the type and add normalization at the decode boundary

- [ ] **Step 1: Change the `DecodedGatewayToken.act` type** in `demo_mcp_gateway/src/tokenValidator.ts` (lines 21-37)

```ts
export interface DecodedGatewayToken {
  sub: string;
  act?: Array<{ sub?: string; client_id?: string }>;
  // may_act.sub: the actor the USER authorized. Not present on exchanged tokens; the
  // BFF bridges it via the X-May-Act-Sub header (see index.ts) for per-user may_act
  // enforcement in the authorization decision (ENFORCE_MAY_ACT).
  may_act?: { sub: string };
  scope?: string;
  // Authentication Context Class Reference — recorded in the compliance audit
  // (Scenario 5) so the report can show the auth strength (1FA / MFA) per call.
  acr?: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  iss?: string;
}

/**
 * Flatten a legacy nested RFC 8693 act claim (act:{sub, act:{sub, ...}}) into an
 * ordered array — index 0 is the first/oldest delegate, the last index is the
 * current/most-recent actor. Already-array input passes through unchanged.
 * Caps at 6 hops (matches demo_api_server's tokenUtils.normalizeActChain).
 */
export function normalizeActChain(rawAct: unknown): Array<{ sub?: string; client_id?: string }> {
  if (!rawAct) { return []; }
  if (Array.isArray(rawAct)) { return rawAct; }
  if (typeof rawAct !== 'object') { return []; }
  const chain: Array<{ sub?: string; client_id?: string }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = rawAct;
  let guard = 0;
  while (node && typeof node === 'object' && (node.sub || node.client_id) && guard < 6) {
    const { act: nested, ...hop } = node;
    chain.unshift(hop);
    node = nested;
    guard += 1;
  }
  return chain;
}
```

- [ ] **Step 2: Normalize at the single choke point** — `validateInboundToken` (line 319, right before `return decoded;`)

```ts
  // RFC 8693 act claim: normalize to a flat ordered array immediately after
  // decode/verify, so everything downstream only ever sees the array shape.
  if (decoded.act) {
    decoded.act = normalizeActChain(decoded.act);
  }

  return decoded;
```

This single insertion covers both decode paths inside `_decodeAndVerify` (the `jwt.decode` fallback at line 205 and the JWKS `jwt.verify` path at line 253), since both feed into `validateInboundToken` before returning.

- [ ] **Step 3: Run the gateway's existing token-validator tests**

Run: `cd demo_mcp_gateway && npx jest tokenValidator --forceExit` (adjust to the actual test file name under `demo_mcp_gateway/tests/`)

- [ ] **Step 4: Commit**

```bash
git add demo_mcp_gateway/src/tokenValidator.ts
git commit -m "feat(act-claim): normalize act claim to array at the gateway's JWT decode boundary"
```

### 9b. `PingOneAuthorizeClient.ts` — depth counter + nested-actor getter

- [ ] **Step 1: Write/extend the failing test** (find the existing test file: `grep -rln "actChainDepth" demo_mcp_gateway/tests/`)

```ts
import { actChainDepth, nestedActClientId } from '../src/auth/PingOneAuthorizeClient';

describe('actChainDepth — array shape', () => {
  it('returns the array length', () => {
    expect(actChainDepth(undefined)).toBe(0);
    expect(actChainDepth([{ sub: 'agent1' }])).toBe(1);
    expect(actChainDepth([{ sub: 'agent1' }, { sub: 'agent2' }])).toBe(2);
  });
});

describe('nestedActClientId — array shape', () => {
  it('returns "" for fewer than 2 hops', () => {
    expect(nestedActClientId(undefined)).toBe('');
    expect(nestedActClientId([{ sub: 'agent1' }])).toBe('');
  });
  it('returns the second-to-last hop\'s id', () => {
    expect(nestedActClientId([{ sub: 'agent1' }, { client_id: 'agent2-client', sub: 'agent2' }])).toBe('agent1');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd demo_mcp_gateway && npx jest PingOneAuthorizeClient --forceExit`

- [ ] **Step 3: Fix both functions** (lines 111-138)

```ts
/**
 * Depth of the RFC 8693 act delegation chain. A generalist's own token has
 * act:[{sub:agent}] → depth 1; an A2A specialist token has
 * act:[{sub:generalist},{sub:specialist}] → depth 2. The Authorize policy
 * DENYs a2aDelegated tools below depth 2 (the generalist cannot call a
 * specialist-only tool directly).
 */
export function actChainDepth(act: unknown): number {
  return Array.isArray(act) ? act.length : 0;
}

/**
 * The actor BEFORE the current one, for a multi-hop RFC 8693 chain: act is an
 * ordered array, the current actor is the last element, the one before them
 * (if any) is the second-to-last. Matches BFF nestedActIdFromClaim — PingOne
 * may stamp either field.
 */
export function nestedActClientId(act: unknown): string {
  if (!Array.isArray(act) || act.length < 2) return '';
  const priorActor = act[act.length - 2] as { sub?: string; client_id?: string };
  return String(priorActor.client_id || priorActor.sub || '');
}
```

- [ ] **Step 4: Fix `buildAuthorizeParameters`'s `ActClientId` line** (line 167) — it currently reads `decoded.act?.sub`, a single-object access that will be `undefined` against an array

```ts
    ActClientId: decoded.act?.length ? (decoded.act[decoded.act.length - 1].sub ?? decoded.act[decoded.act.length - 1].client_id ?? '') : '',
```

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `cd demo_mcp_gateway && npx jest PingOneAuthorizeClient --forceExit`

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts
git commit -m "fix(act-claim): array-based depth/nested-actor resolution in PingOneAuthorizeClient"
```

### 9c. `GatewayTokenPolicy.ts` — malformed-chain check

- [ ] **Step 1: Find/extend the existing test** for `GatewayTokenPolicy.validate`

Run: `grep -rln "GatewayTokenPolicy" demo_mcp_gateway/tests/`

Add a case confirming a 2-hop array-shaped `act` with a valid last-hop `sub` passes validation, and one confirming a last-hop with empty `sub` still throws `invalid_act` — matching the existing test file's setup pattern (open it first to match style).

- [ ] **Step 2: Fix the `act.sub` access** (lines 54-65)

```ts
    // act chain: if present (non-null, non-empty), the current (last) hop's
    // sub must be non-empty. An empty array is treated as "no act" (same as
    // null/undefined) — not a malformed chain.
    if (decoded.act != null && decoded.act.length > 0) {
      const currentHop = decoded.act[decoded.act.length - 1];
      const actSub = currentHop.sub == null ? '' : String(currentHop.sub).trim();
      if (!actSub) {
        throw new GatewayTokenPolicyError(
          'Malformed delegation chain: act.sub is empty',
          'invalid_act',
        );
      }
```

The `actChainDepth(decoded.act) < 2` check at line 79 needs no change — `actChainDepth` was already fixed in Task 9b to read `.length`.

- [ ] **Step 3: Run the tests, confirm they pass**

Run: `cd demo_mcp_gateway && npx jest GatewayTokenPolicy --forceExit`

- [ ] **Step 4: Commit**

```bash
git add demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts
git commit -m "fix(act-claim): GatewayTokenPolicy reads the current hop from the act array"
```

### 9d. `pingAuthorizeGuard.ts`, `authorizeMcpRequest.ts`, `index.ts` — remaining `.act?.sub` sites

These sites all follow the same pattern: `decoded.act?.sub` (single-object access) needs to become "current/most-recent actor's sub," i.e. `decoded.act?.length ? decoded.act[decoded.act.length - 1].sub : undefined`. Rather than a one-off inline expression at each of the ~8 call sites the research pass found, add one small shared helper and use it everywhere.

- [ ] **Step 1: Add a helper to `tokenValidator.ts`** (alongside `normalizeActChain` from Task 9a)

```ts
/** The current/most-recent actor in an act array, or undefined if there is none. */
export function currentActor(act: Array<{ sub?: string; client_id?: string }> | undefined): { sub?: string; client_id?: string } | undefined {
  return act && act.length ? act[act.length - 1] : undefined;
}
```

- [ ] **Step 2: Export it and update each call site**

In `demo_mcp_gateway/src/pingAuthorizeGuard.ts`: find each `decoded.act?.sub` (research pass located one around line 164, and noted "other call sites... same pattern" — confirm the exact count with `grep -n "\.act?\.sub\|\.act\.sub" demo_mcp_gateway/src/pingAuthorizeGuard.ts` before editing). Import `currentActor` from `./tokenValidator` and replace each occurrence:

```ts
// before: decoded.act?.sub || ''
// after:
currentActor(decoded.act)?.sub || ''
```

In `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`: the research pass located `decoded?.act?.sub` at lines 526, 575, 953, and a bridge-fallback check `!decoded.act?.sub && bffActClientId` at line 665. Confirm exact locations with `grep -n "\.act?\.sub\|\.act\.sub" demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` and apply the same `currentActor(decoded.act)?.sub` replacement to each, importing `currentActor` from `../tokenValidator`.

In `demo_mcp_gateway/src/index.ts`: the research pass located `decoded.act?.sub` at lines 617, 639, 686, 753 (do NOT touch the `decoded.may_act?.sub` occurrences at 620/623 — `may_act` is out of scope per Global Constraints). Confirm exact locations with `grep -n "\.act?\.sub\|\.act\.sub" demo_mcp_gateway/src/index.ts` and apply the same replacement, importing `currentActor` from `./tokenValidator`.

- [ ] **Step 3: Build to catch any TypeScript errors from the type change**

Run: `cd demo_mcp_gateway && npm run build`
Expected: exits 0. If it doesn't, the compiler error output will point at any remaining `.act.sub`/`.act.client_id` single-object access this plan's grep-based site list missed — fix those the same way (wrap in `currentActor(...)`) and rebuild.

- [ ] **Step 4: Run the full gateway test suite**

Run: `cd demo_mcp_gateway && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/tokenValidator.ts demo_mcp_gateway/src/pingAuthorizeGuard.ts demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/src/index.ts
git commit -m "fix(act-claim): use currentActor() helper at remaining act.sub sites in the gateway"
```

- [ ] **Step 6: Regenerate/verify generated artifacts per this service's CLAUDE.md**, since this task touched `src/`:

Run: `cd demo_mcp_gateway && npm run build && cd .. && npm run topology:verify`

---

## Task 10: `demo_api_ui` (React) — chain visualization components

The UI reads the (now-array) `act` claim from BFF API responses. The highest-risk site is `TokenChainDisplay.jsx`'s direct 2-level path access, which will silently render nothing (not error) once the shape changes — silent blank-outs are worse than a crash here because they won't fail CI.

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.jsx`
- Modify: `demo_api_ui/src/components/TokenFlowDetailModal.jsx`
- Modify: `demo_api_ui/src/components/TokenExchangeDiagram.jsx`
- Modify: `demo_api_ui/src/components/NarrativePanel.js`
- Modify: `demo_api_ui/src/components/DelegationPage.js`
- Modify: `demo_api_ui/src/components/TokenStateIndicator.js`
- Modify: `demo_api_ui/src/components/AgentFlowDiagramPanel.js`

### 10a. `TokenChainDisplay.jsx` — the critical site

- [ ] **Step 1: Fix `fmtActNode`** (lines 2877-2895) — this formats a single hop object; confirm its call sites (it's designed to be called once per hop, which is good — check whether any caller currently calls it once per nesting level and needs to become a `.map()` over the array instead). Read the surrounding ~30 lines around each call site of `fmtActNode` before changing anything, since the plan's research pass only confirmed the function itself is hop-shaped, not how many times/how each caller invokes it.

- [ ] **Step 2: Fix `diffFromPrev`** (lines 3382-3393)

```jsx
// before:
const actSub = (c) => c?.act?.sub || (typeof c?.act === "string" ? c.act : null);
// after:
const actSub = (c) => {
  const act = c?.act;
  if (Array.isArray(act) && act.length) return act[act.length - 1]?.sub || act[act.length - 1]?.client_id || null;
  return typeof act === "string" ? act : null;
};
```

- [ ] **Step 3: Fix `EventRow`'s compact "Agent:" pill** (around line 3442)

```jsx
// before: event.claims?.act?.sub
// after:
(Array.isArray(event.claims?.act) && event.claims.act.length
  ? event.claims.act[event.claims.act.length - 1]?.sub
  : undefined)
```

- [ ] **Step 4: Fix the direct 2-level nested-path JSX block** (lines 3660-3698) — this is the site the research pass flagged as highest-visibility: it renders the "nested MCP server ID" chip using `event.claims.act.act.sub`, which will simply not render (condition is falsy) once `act` is an array, rather than throwing.

```jsx
// before:
{event.claims?.act?.act?.sub && (
  <button title={`MCP Server ID (act.act.sub claim): ${event.claims.act.act.sub}`}
    onClick={() => navigator.clipboard?.writeText(event.claims.act.act.sub)}>
    MCP: {event.claims.act.act.sub.length > 16 ? ... : event.claims.act.act.sub}
  </button>
)}

// after — the "nested MCP server" this chip showed was event.claims.act.act.sub,
// i.e. the actor BEFORE the current one (second-to-last array element):
{(() => {
  const act = event.claims?.act;
  const priorActor = Array.isArray(act) && act.length >= 2 ? act[act.length - 2] : null;
  const priorActorId = priorActor?.sub || priorActor?.client_id;
  return priorActorId && (
    <button title={`MCP Server ID (act[${act.length - 2}].sub claim): ${priorActorId}`}
      onClick={() => navigator.clipboard?.writeText(priorActorId)}>
      MCP: {priorActorId.length > 16 ? `${priorActorId.slice(0, 16)}…` : priorActorId}
    </button>
  );
})()}
```

(The `.length > 16 ? ... : ...` truncation in the original was elided in the research quote — read the actual current line 3660-3698 in the file before applying this change, and preserve whatever the real truncation expression is instead of the placeholder `${priorActorId.slice(0, 16)}…` shown above, which is a reasonable guess but not verified against the live file.)

- [ ] **Step 5: Run the UI unit tests**

Run: `cd demo_api_ui && npm run test:unit`

- [ ] **Step 6: Manual verification** — per root CLAUDE.md, UI changes need a live check. Start the app (`./run.sh` or `./run-docker.sh`), open the Token Chain panel for a use case that produces an A2A/nested delegation (e.g. the A2A specialist-delegation demo track), and confirm the actor chips render correctly with real data — this is exactly the kind of change that passes a build/type-check while silently rendering nothing.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.jsx
git commit -m "fix(act-claim): array-aware act claim rendering in TokenChainDisplay"
```

### 10b. Remaining UI components — same mechanical pattern

Each of these reads `act?.sub` or `act` as a possible object; apply the same "index the last array element for the current actor" pattern.

- [ ] **Step 1: `TokenFlowDetailModal.jsx`** — fix both sites (around lines 280-289 and 488-499):

```jsx
// before: const actClaim = delegTok?.claims?.act?.sub ?? delegTok?.claims?.act;
// after:
const actArr = delegTok?.claims?.act;
const actClaim = (Array.isArray(actArr) && actArr.length ? (actArr[actArr.length - 1]?.sub ?? actArr[actArr.length - 1]?.client_id) : undefined) ?? undefined;
```

Apply the equivalent change to the longer fallback chain around line 488-499 (`delegTok?.claims?.act?.sub || delegTok?.claims?.act || exchStep?.detail?.claims?.act?.sub || exchStep?.detail?.claims?.act || ''`) — read the exact current line first since this plan's quote may not be byte-exact, then replace each `?.act?.sub` sub-expression with the array-indexed equivalent shown above, keeping the same fallback order.

- [ ] **Step 2: `TokenExchangeDiagram.jsx`** — fix both sites (around lines 132-144 and 182-195):

```jsx
// before: const actVal = dc.act?.sub ?? dc.act;
// after:
const actArr = dc.act;
const actVal = (Array.isArray(actArr) && actArr.length ? (actArr[actArr.length - 1]?.sub ?? actArr[actArr.length - 1]?.client_id) : undefined) ?? dc.act;
```

- [ ] **Step 3: `NarrativePanel.js`** — fix the presence check and `.sub` read (around lines 66-74):

```jsx
// before: claims.act? ... claims.act?.sub
// after:
const currentActor = Array.isArray(claims.act) && claims.act.length ? claims.act[claims.act.length - 1] : null;
// use currentActor?.sub in place of claims.act?.sub; use !!currentActor in place of the presence check
```

- [ ] **Step 4: `DelegationPage.js`** — fix the presence check and `.sub` read (around lines 400-403):

```jsx
// before: evt.claims?.act ... evt.claims.act.sub
// after:
const currentActor = Array.isArray(evt.claims?.act) && evt.claims.act.length ? evt.claims.act[evt.claims.act.length - 1] : null;
// render currentActor?.sub in place of evt.claims.act.sub, gated on !!currentActor
```

- [ ] **Step 5: `TokenStateIndicator.js`** — fix `friendlyAct` (around lines 77-83), which already has an object-shape branch — just add an array branch:

```jsx
// before:
// typeof act === 'object' ? (act.sub || act.client_id) : String(act)
// after:
function friendlyAct(act) {
  if (Array.isArray(act)) {
    const last = act[act.length - 1];
    return last ? (last.sub || last.client_id) : '';
  }
  return typeof act === 'object' && act !== null ? (act.sub || act.client_id) : String(act);
}
```

(Adjust to match the exact existing function signature/name in the file — read it first; this shows the logic change, not a guaranteed verbatim replacement of the whole function.)

- [ ] **Step 6: `AgentFlowDiagramPanel.js`** — same pattern (around line 46):

```jsx
// before: typeof act === 'object' ? act.client_id : String(act)
// after:
Array.isArray(act) ? (act[act.length - 1]?.client_id ?? '') : (typeof act === 'object' && act !== null ? act.client_id : String(act))
```

- [ ] **Step 7: Run the UI unit tests and build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/TokenFlowDetailModal.jsx demo_api_ui/src/components/TokenExchangeDiagram.jsx demo_api_ui/src/components/NarrativePanel.js demo_api_ui/src/components/DelegationPage.js demo_api_ui/src/components/TokenStateIndicator.js demo_api_ui/src/components/AgentFlowDiagramPanel.js
git commit -m "fix(act-claim): array-aware act claim reads across remaining token-chain UI components"
```

---

## Task 11: Education/prose panel copy updates (lower priority, batch)

These panels explain the `act.act` nested shape to demo viewers in plain text/SVG labels. No functional risk (no live field access), but the copy will be actively wrong once the shape changes — worth fixing in the same PR since a viewer reading "act.act.sub = the MCP server" while looking at an array-shaped token in the inspector would be confusing.

**Files:**
- Modify: `demo_api_ui/src/components/education/PingOneAuthorizePanel.js` (lines 386, 389, 546, 566, 588, 663-664, 711-713, 734-735)
- Modify: `demo_api_ui/src/components/education/RFC8693Panel.js` (lines 146, 162)
- Modify: `demo_api_ui/src/components/education/TokenExchangePanel.js` (line 439)
- Modify: `demo_api_ui/src/components/education/TokenChainEducationPanel.js` (line 61)
- Modify: `demo_api_ui/src/components/education/JwtClientAuthPanel.js` (line 148)
- Modify: `demo_api_ui/src/components/education/BestPracticesPanel.js` (line 307)
- Modify: `demo_api_server/services/errorMessageBuilder.js` (lines 11, 90-96 — user-facing error copy: *"act.sub for the current actor and nest prior actors under act.act.sub"*)
- Modify: `demo_api_server/middleware/delegationErrorMiddleware.js` (~line 105 — *"Nested act.act.sub may name the original AI agent..."*)

- [ ] **Step 1: Read each listed line/region and rewrite the prose** to describe the array shape instead of nested `act.act`. Example transformation:

```
before: "act.act.sub = the MCP server (2-exchange only)"
after:  "act[0] = the first delegate, the last element of the act array = the current actor"
```

Apply the equivalent rewording at each listed location, preserving the surrounding sentence structure and any JSX/markdown formatting already in place. This is prose-only — no logic changes, no new tests. Follow the emoji allowlist (`REGRESSION_PLAN.md` §0) if any copy near these edits uses an emoji.

- [ ] **Step 2: Build the UI to confirm no syntax errors were introduced**

Run: `cd demo_api_ui && npm run build`

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/education/PingOneAuthorizePanel.js demo_api_ui/src/components/education/RFC8693Panel.js demo_api_ui/src/components/education/TokenExchangePanel.js demo_api_ui/src/components/education/TokenChainEducationPanel.js demo_api_ui/src/components/education/JwtClientAuthPanel.js demo_api_ui/src/components/education/BestPracticesPanel.js demo_api_server/services/errorMessageBuilder.js demo_api_server/middleware/delegationErrorMiddleware.js
git commit -m "docs(act-claim): update education-panel and error copy for the array shape"
```

---

## Task 12: Full regression pass, REGRESSION_PLAN log entry, TECH_DEBT note

**Files:**
- Modify: `REGRESSION_PLAN.md` (§4 bug/change log — reverse-chron entry)
- Modify: `TECH_DEBT.md` (optional — only if Task 6's Step 3 depth-semantics note, or Task 5's Step 4 caller-index finding, turned up something worth tracking rather than fixing now)

- [ ] **Step 1: Run every subsystem's full verification command**

```bash
cd demo_api_server && CI=true npm test -- --forceExit
cd demo_mcp_gateway && npm run build && npm test
cd demo_authz_server && npm test
cd demo_api_ui && npm run test:unit && npm run build
cd .. && npm run topology:verify
```

All must exit 0. If `topology:verify` or the gateway's `gen:tool-schemas` gate flags drift (per `demo_mcp_gateway/CLAUDE.md`'s "Generated artifacts" section), regenerate and re-run before proceeding.

- [ ] **Step 2: Manual live-app smoke test** — start the stack and, using Super Sports as the default vertical per root CLAUDE.md, exercise:
  - A plain user login (no delegation) — confirm no `act` claim anywhere breaks.
  - A single-hop agent delegation flow (e.g. Option D `/api/agent/delegate`) — confirm the returned `act` is `[{sub: ...}]`.
  - An A2A specialist-delegation demo track (2-hop chain) — confirm the Token Chain panel renders both actors correctly (this is what Task 10a's Step 6 already checks; re-confirm here as part of the full pass).

- [ ] **Step 3: Add the REGRESSION_PLAN.md §4 entry**

Follow the existing reverse-chron entry format in that file (Files changed / What was broken / What was fixed / Do not break / Verify). Example shape (fill in with the actual final commit list):

```markdown
### RFC 8693 act claim: nested object → flat array (2026-08-12)

**Files changed:** demo_api_server/utils/tokenUtils.js, demo_api_server/services/{a2aDelegationService,mcpToolAuthorizationService,delegationChainValidationService,reportFormatter,tokenChainService,tokenDisplayService}.js, demo_api_server/{middleware/delegationAuditLogger,routes/agentDelegation,routes/pingoneTestRoutes,middleware/testTokenGenerator}.js, demo_mcp_gateway/src/{tokenValidator,auth/PingOneAuthorizeClient,auth/GatewayTokenPolicy,pingAuthorizeGuard,middleware/authorizeMcpRequest,index}.ts, demo_authz_server/routes/token.js, demo_api_ui/src/components/{TokenChainDisplay,TokenFlowDetailModal,TokenExchangeDiagram,NarrativePanel,DelegationPage,TokenStateIndicator,AgentFlowDiagramPanel}.{jsx,js}.

**What was broken:** N/A — this was a planned shape migration, not a bug fix. The `act` claim was a recursively-nested object (`act:{sub:agent2, act:{sub:agent1}}`), forcing every reader to either hardcode a fixed nesting depth (most sites only ever handled 1-2 levels) or implement its own recursive walker (two independent implementations existed: `a2aDelegationService.countActDepth` and the gateway's `actChainDepth`).

**What was fixed:** `act` now mints and reads as a flat, ordered array (`act:[{sub:agent1},{sub:agent2}]`, oldest first) everywhere except PingOne's own SpEL, which still mints the nested object on the wire — normalization happens in code immediately after every JWT decode (demo_api_server's `utils/tokenUtils.js normalizeActChain`, demo_mcp_gateway's `tokenValidator.ts normalizeActChain` twin).

**Do not break:** Do not touch `pingoneProvisionService.js`'s SpEL composer (`act` resource attribute on the A2A MCP Gateway resource) — it intentionally still mints nested. Do not conflate `act` with `may_act` (a distinct, un-nested grant claim). `xaaIdJagDemo.js`'s `act:{iss}` is an unrelated ID-JAG claim, not part of this chain.

**Verify:** `cd demo_api_server && CI=true npm test -- --forceExit`; `cd demo_mcp_gateway && npm run build && npm test`; `cd demo_authz_server && npm test`; `cd demo_api_ui && npm run test:unit && npm run build`; `npm run topology:verify`.
```

- [ ] **Step 4: Commit**

```bash
git add REGRESSION_PLAN.md
# plus TECH_DEBT.md if Step 1's findings warranted an entry
git commit -m "docs: log the act claim array migration in REGRESSION_PLAN"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Task ordering matters for demo_api_server:** Task 1 must land before Tasks 2-8, since several of those tasks import `normalizeActChain` from `utils/tokenUtils.js`.
- **Task 9 (gateway) and Task 7 (mock authz) are independent of the demo_api_server tasks** — they can run in parallel with Tasks 1-8 if using subagent-driven execution, since neither shares code with demo_api_server.
- **Task 10 (UI) depends on Task 1-9 having landed and been deployed** in the sense that it assumes the BFF/gateway are now emitting arrays — but the UI code changes themselves don't have a source dependency, so they can be written in parallel and just need integration verification (Task 10a Step 6, Task 12 Step 2) after the backend tasks are live.
- **Several steps above say "check the existing test file" or "confirm the exact line" rather than asserting exact current content.** This is intentional, not a placeholder: this plan was written from a mix of direct file reads (demo_api_server core files, `tokenValidator.ts`, `GatewayTokenPolicy.ts`) and a research agent's quoted excerpts (some `demo_mcp_gateway` and most `demo_api_ui` sites) gathered in a single pass across ~50 files. Where a step says to grep/confirm before editing, that's flagging a spot where the plan's confidence in exact current line content is lower than elsewhere — treat it as a required verification step, not an optional one.
