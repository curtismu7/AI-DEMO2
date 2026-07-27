# P1AZ Signing-Key (`kid`) Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the presented MCP token's JWT header `kid`, plus a BFF-resolved "is this `kid` published in the issuer's live JWKS" boolean, to both authorization engines as an additional policy input, and surface it in the token chain as fine-grained authorization.

**Architecture:** The BFF pre-resolves JWKS membership (the P1AZ snapshot DSL can neither fetch a JWKS nor do array-contains — same precedent as `InRequiredGroup`/`UserTier`) and forwards `TokenKid` + `TokenKidKnown` as decision parameters. Both the live PingOne engine and the simulated engine receive identical inputs. The token chain reads the parameters that already flow on `event.authorizeRequest` — no new plumbing.

**Tech Stack:** Node >= 22, CommonJS (demo_api_server), jest + supertest (server), React 19 + vitest (demo_api_ui).

**Spec:** [docs/superpowers/specs/2026-07-27-p1az-kid-check-design.md](../specs/2026-07-27-p1az-kid-check-design.md)

## Global Constraints

- **Worktree only.** All work happens in `.claude/worktrees/p1az-kid-check` on branch `worktree-p1az-kid-check`. A hard-block hook denies `Write`/`Edit` in the main checkout. Bash cwd drifts back to the main checkout — use absolute paths or `git -C`.
- **Stage explicitly.** `git add <files>`, never `git add -A`. Running the BFF jest suite regenerates ~443 files under `data/step-verification/**` and `data/goldens/**`; `git status` and restore unintended ones before committing.
- **`CI=true` is mandatory** for BFF jest. Without it supertest suites flake and a green run proves nothing.
- **Worktree jest override:** every BFF jest run needs `--testPathIgnorePatterns="/node_modules/" "/tests/real/"`. The repo config ignores `/.claude/worktrees/`, so from a worktree it matches everything and jest exits 1 with `No tests found`. Dropping `/tests/real/` from the override drags 27 failures back in.
- **UI tests are vitest, not jest.** `cd demo_api_ui && npm run test:unit`.
- **Emoji allowlist (always-on, REGRESSION_PLAN §0):** only `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. Everything else is plain text or CSS.
- **`getPublicKey` must not be modified.** Existing verify-path callers depend on its first-signature-key fallback.
- **`authorize-decision` event id and shape must not change.** It is ProofStrip evidence; `computeVerdict` short-circuits on `missingSteps.length > 0`, so any change flips correct runs to "Incomplete".
- **Omission means "unknown", never "verified absent"** (contract C1 rule 3). A value the BFF could not resolve is an omitted key, not a fabricated `false`.

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_server/services/jwksService.js` | add `hasKid` — exact JWKS membership |
| `demo_api_server/tests/services/jwksService.hasKid.test.js` | new — `hasKid` unit spec |
| `demo_api_server/services/pingOneAuthorizeService.js` | forward `TokenKid`/`TokenKidKnown`; register statement code |
| `demo_api_server/src/__tests__/mcpDelegationParity.test.js` | extend C1 block |
| `demo_api_server/services/simulatedAuthorizeService.js` | accept params, add signing-key guard |
| `demo_api_server/tests/simulatedAuthorizeKid.test.js` | new — simulated guard spec |
| `demo_api_server/services/mcpToolAuthorizationService.js` | read header `kid`, resolve, pass to both engines |
| `demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js` | extend with kid-forwarding cases |
| `demo_api_ui/src/components/TokenChainDisplay.js` | export `readAuthorizeParameters`; policy-input row |
| `demo_api_ui/src/components/__tests__/TokenChainDisplay.kidCallout.test.js` | new — vitest spec |

**Out of code scope:** the live P1AZ rule (`DENY if TokenKidKnown == false` → statement `mcp-invalid-kid`) must be authored in the PingOne Authorize console. Until it exists the live path is inert for this check; simulated mode enforces immediately. Do not treat the live path's non-enforcement as a bug in this plan.

---

### Task 1: `jwksService.hasKid`

**Files:**
- Modify: `demo_api_server/services/jwksService.js:104` (insert after `getPublicKey`), `:112` (exports)
- Test: `demo_api_server/tests/services/jwksService.hasKid.test.js` (create)

**Interfaces:**
- Consumes: existing module state `_cachedKeys`, `_cacheExpiry`, `CACHE_MAX_AGE_MS`, `_fetchAndBuildKeyMap()`, `getKeys()`, `clearCache()`
- Produces: `hasKid(kid: string|null) => Promise<boolean|null>` — `true` published, `false` not published, `null` unknown (no kid, or JWKS unavailable). Tasks 4 and the simulated guard depend on exactly these three values.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/jwksService.hasKid.test.js`:

```js
/**
 * jwksService.hasKid — exact JWKS membership.
 *
 * Distinct from getPublicKey, which deliberately falls back to the first
 * signature key (jwksService.js:99-103) and therefore can NEVER report a kid as
 * absent. A membership check built on getPublicKey returns true for every kid
 * whenever the JWKS is reachable — see the revert-to-RED step in this task.
 */
'use strict';

const crypto = require('crypto');
const axios = require('axios');

jest.mock('axios');
jest.mock('../../services/oauthEndpointResolver', () => ({
  getJwksUri: jest.fn(() => 'https://auth.pingone.com/env-123/as/jwks'),
}));

const jwksService = require('../../services/jwksService');

/** Real RSA public JWK so crypto.createPublicKey() actually succeeds. */
function makeJwk(kid) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
}

const KNOWN_KID = 'kid-known-1';

beforeEach(() => {
  jwksService.clearCache();
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: { keys: [makeJwk(KNOWN_KID)] } });
});

test('returns true for a kid published in the JWKS', async () => {
  await expect(jwksService.hasKid(KNOWN_KID)).resolves.toBe(true);
});

test('returns false for a kid the JWKS does not publish', async () => {
  await expect(jwksService.hasKid('kid-forged')).resolves.toBe(false);
});

test('returns true when a refresh picks up a rotated key', async () => {
  // getKeys() returns a STALE cache on failure, so a bare .has() would report a
  // legitimately-rotated key as forged. hasKid must refresh before concluding false.
  axios.get
    .mockResolvedValueOnce({ data: { keys: [makeJwk(KNOWN_KID)] } })
    .mockResolvedValueOnce({ data: { keys: [makeJwk(KNOWN_KID), makeJwk('kid-rotated')] } });
  await expect(jwksService.hasKid('kid-rotated')).resolves.toBe(true);
});

test('returns null when the JWKS cannot be fetched (unknown, not forged)', async () => {
  axios.get.mockReset();
  axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
  await expect(jwksService.hasKid(KNOWN_KID)).resolves.toBeNull();
});

test('returns null when no kid is supplied', async () => {
  await expect(jwksService.hasKid(null)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest tests/services/jwksService.hasKid.test.js \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: FAIL — `jwksService.hasKid is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/services/jwksService.js`, insert after `getPublicKey` (after line 104):

```js
/**
 * Exact JWKS membership test for a kid. Distinct from getPublicKey, which
 * deliberately falls back to the first signature key and therefore can never
 * report a kid as absent.
 *
 * @param {string|null} kid
 * @returns {Promise<boolean|null>} true = published, false = not published,
 *   null = unknown (no kid, or JWKS unavailable)
 */
async function hasKid(kid) {
  if (!kid) return null;
  const keys = await getKeys();
  if (!keys || keys.size === 0) return null;   // unavailable → unknown
  if (keys.has(kid)) return true;
  // Absent from the cached keyset — refresh once before concluding false, in
  // case PingOne rotated signing keys since the cache was built. getKeys()
  // returns a STALE cache on network failure, so without this a legitimately
  // rotated key would be reported as forged.
  try {
    _cachedKeys = await _fetchAndBuildKeyMap();
    _cacheExpiry = Date.now() + CACHE_MAX_AGE_MS;
    return !!_cachedKeys?.has(kid);
  } catch (_) {
    return null;                                // unresolvable → unknown
  }
}
```

Change the exports line (currently line 112) to:

```js
module.exports = { getKeys, getPublicKey, hasKid, clearCache };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest tests/services/jwksService.hasKid.test.js \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Revert-to-RED — prove the check actually distinguishes**

This step is mandatory. The `hasKid` tests could pass against an implementation that never distinguishes anything, so restore the trap and watch it fail.

Temporarily replace the body of `hasKid` with the naive version:

```js
async function hasKid(kid) {
  if (!kid) return null;
  return !!(await getPublicKey(kid));
}
```

Run the same command as Step 4.

Expected: **FAIL** — `returns false for a kid the JWKS does not publish` receives `true`, because `getPublicKey` falls back to the first signature key. If this test still passes, the test is not exercising the trap and must be fixed before continuing.

Then restore the Step 3 implementation and re-run to confirm PASS again.

- [ ] **Step 6: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check
git add demo_api_server/services/jwksService.js demo_api_server/tests/services/jwksService.hasKid.test.js
git commit -m "feat(jwks): add hasKid for exact JWKS membership

getPublicKey falls back to the first signature key, so it can never
report a kid as absent -- a membership check built on it returns true
for every kid. hasKid reads the keyset Map directly and refreshes once
before concluding false, so a rotated key is not misreported as forged.

Returns null (not false) when the JWKS is unavailable: omission means
unknown, never verified absent."
```

---

### Task 2: Live P1AZ decision parameters

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js:552` (param list), `:606` (spreads), `:1231` (`KNOWN_STATEMENT_CODES`)
- Test: `demo_api_server/src/__tests__/mcpDelegationParity.test.js` (extend the existing `C1 canonical parameter set` describe block at line 168)

**Interfaces:**
- Consumes: nothing from Task 1 directly — this task only accepts the values
- Produces: `evaluateMcpToolDelegation({ ..., tokenKid, tokenKidKnown })` accepts both, defaulting to `null`. Task 4 passes them.

- [ ] **Step 1: Write the failing test**

Inside the existing `describe('C1 canonical parameter set', ...)` block in `demo_api_server/src/__tests__/mcpDelegationParity.test.js`, add:

```js
    // Signing-key identity as a policy input. kid is read off the token HEADER;
    // tokenKidKnown is BFF-pre-resolved because the snapshot DSL can neither
    // fetch a JWKS nor do array-contains. This is NOT signature verification —
    // it detects a token naming a key the issuer does not publish.
    test('forwards TokenKid and TokenKidKnown when the key resolved', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
        tokenKid: 'kid-abc', tokenKidKnown: true,
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.TokenKid).toBe('kid-abc');
      expect(body.TokenKidKnown).toBe(true);
    });

    test('forwards TokenKidKnown=false so the policy can deny an unpublished key', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'DENY', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
        tokenKid: 'kid-forged', tokenKidKnown: false,
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.TokenKidKnown).toBe(false);
    });

    // C1 rule 3 — a JWKS outage is "unknown", never "verified absent". A
    // fabricated false here would turn a PingOne blip into a demo-wide DENY.
    test('OMITS TokenKidKnown when JWKS was unavailable', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
        tokenKid: 'kid-abc', tokenKidKnown: null,
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.TokenKid).toBe('kid-abc');
      expect('TokenKidKnown' in body).toBe(false);
    });

    test('OMITS both keys when the token header carries no kid', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect('TokenKid' in body).toBe(false);
      expect('TokenKidKnown' in body).toBe(false);
    });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest src/__tests__/mcpDelegationParity.test.js \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: FAIL — the first two tests get `undefined` for `body.TokenKid` / `body.TokenKidKnown`. (The two omission tests pass trivially at this point; that is expected and is why the positive cases exist.)

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/services/pingOneAuthorizeService.js`, in the `evaluateMcpToolDelegation` destructured parameter list, immediately after `userRole = null,` (line 552):

```js
  // Signing-key identity (additional check). tokenKid is the JWT header kid;
  // tokenKidKnown is the caller's pre-resolved JWKS membership. The snapshot
  // DSL cannot fetch a JWKS, so the boolean is resolved BFF-side — same
  // precedent as InRequiredGroup / UserTier. null → key OMITTED (C1 rule 3).
  tokenKid = null,
  tokenKidKnown = null,
```

In the `parameters` object, immediately after the `TokenIss` spread (line 606):

```js
    ...(tokenKid ? { TokenKid: tokenKid } : {}),
    ...(tokenKidKnown != null ? { TokenKidKnown: tokenKidKnown } : {}),
```

In `KNOWN_STATEMENT_CODES` (line 1231), add after `'rar_amount_exceeded',`:

```js
  // Signing-key deny. Listed so a live decision carrying it does not trip the
  // F8 "unrecognised statement code" warning.
  'mcp-invalid-kid',
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest src/__tests__/mcpDelegationParity.test.js \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: PASS, all tests in the file including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check
git add demo_api_server/services/pingOneAuthorizeService.js demo_api_server/src/__tests__/mcpDelegationParity.test.js
git commit -m "feat(authz): forward TokenKid/TokenKidKnown to the live P1AZ gate

Adds signing-key identity as a decision parameter. tokenKidKnown is
pre-resolved BFF-side because the snapshot DSL can neither fetch a JWKS
nor do array-contains.

A JWKS outage omits TokenKidKnown rather than sending false: omission
means unknown, and a fabricated false would turn a PingOne blip into a
demo-wide DENY.

Registers mcp-invalid-kid in KNOWN_STATEMENT_CODES so a live decision
carrying it does not trip the F8 unrecognised-code warning. Inert until
the console rule is authored."
```

---

### Task 3: Simulated engine signing-key guard

**Files:**
- Modify: `demo_api_server/services/simulatedAuthorizeService.js:219` (param list), `:238` (`parameters` object), `:275` (guard, after the missing-user-id guard and before the audience guard)
- Test: `demo_api_server/tests/simulatedAuthorizeKid.test.js` (create)

**Interfaces:**
- Consumes: the same `boolean|null` contract `hasKid` produces in Task 1
- Produces: `evaluateMcpFirstTool({ ..., tokenKid, tokenKidKnown })` accepts both. On `tokenKidKnown === false` returns `{ decision: 'DENY', raw: { deny_reason: 'invalid_kid', ... } }`. Task 4 passes the values.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/simulatedAuthorizeKid.test.js`:

```js
/**
 * Simulated MCP engine — signing-key guard, parity with the live P1AZ
 * "MCP Deny — Invalid Kid" rule.
 *
 * tokenKidKnown is resolved by the caller against the live JWKS. null means
 * unknown (no kid, or JWKS unavailable) and must NOT deny — parity with the
 * live path, where the attribute is omitted and the rule cannot fire.
 */
const svc = require('../services/simulatedAuthorizeService');

async function evalTool(overrides = {}) {
  return svc.evaluateMcpFirstTool({
    userId: 'user-1',
    toolName: 'get_my_accounts',
    tokenAudience: 'https://mcp.example',
    mcpResourceUri: 'https://mcp.example',
    ...overrides,
  });
}

test('DENYs when the token names a kid the issuer does not publish', async () => {
  const r = await evalTool({ tokenKid: 'kid-forged', tokenKidKnown: false });
  expect(r.decision).toBe('DENY');
  expect(r.raw.deny_reason).toBe('invalid_kid');
  expect(r.raw.reason).toMatch(/kid-forged/);
});

test('does NOT deny when the kid is published', async () => {
  const r = await evalTool({ tokenKid: 'kid-known', tokenKidKnown: true });
  expect(r.raw?.deny_reason).not.toBe('invalid_kid');
});

test('does NOT deny when JWKS was unavailable (null = unknown, not forged)', async () => {
  const r = await evalTool({ tokenKid: 'kid-abc', tokenKidKnown: null });
  expect(r.raw?.deny_reason).not.toBe('invalid_kid');
});

test('does NOT deny when the token header carries no kid', async () => {
  const r = await evalTool();
  expect(r.raw?.deny_reason).not.toBe('invalid_kid');
});

test('surfaces TokenKid / TokenKidKnown in the decision parameters', async () => {
  const r = await evalTool({ tokenKid: 'kid-known', tokenKidKnown: true });
  expect(r.raw.parameters.TokenKid).toBe('kid-known');
  expect(r.raw.parameters.TokenKidKnown).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest tests/simulatedAuthorizeKid.test.js \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: FAIL — the deny test gets a non-DENY decision, and the parameters test gets `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/services/simulatedAuthorizeService.js`, in the `evaluateMcpFirstTool` destructured parameter list, after `useCaseId = null,` (line 219):

```js
  // Signing-key identity, resolved by the caller against the live JWKS.
  // false = the header names a key the issuer does not publish; null = unknown
  // (no kid, or JWKS unavailable) and the guard is skipped.
  tokenKid = null,
  tokenKidKnown = null,
```

In the `parameters` object, immediately before the `Timestamp` entry (line 238):

```js
    ...(tokenKid ? { TokenKid: tokenKid } : {}),
    ...(tokenKidKnown != null ? { TokenKidKnown: tokenKidKnown } : {}),
```

Insert the guard after the missing-user-id guard's closing brace (after line 274) and **before** the audience-match guard. Both are token-integrity checks, but an unpublished signing key is the more fundamental failure — it means the token is not ours at all, whereas an audience mismatch means a real token reached the wrong place. When both would fire, the signing-key reason is the accurate one to surface.

```js
  // ── Signing-key guard (parity with the P1AZ "MCP Deny — Invalid Kid" rule).
  // tokenKidKnown is resolved by the caller against the live JWKS; false means
  // the token header names a signing key PingOne does not publish. null (JWKS
  // unavailable, or no kid in the header) skips the guard — parity with the
  // live path, where the attribute is omitted and the rule cannot fire.
  //
  // This is a key-IDENTITY check, not signature verification. It detects a
  // token naming an unpublished key; it does not prove the signature is valid.
  if (tokenKidKnown === false) {
    const out = {
      decision: 'DENY',
      stepUpRequired: false,
      hitlRequired: false,
      path: 'simulated',
      decisionId,
      raw: {
        ...rawBase,
        decision: 'DENY',
        deny_reason: 'invalid_kid',
        reason:
          `Signing-key check failed — the token header names kid="${tokenKid}", which is not ` +
          `published in the issuer's JWKS. The token was not signed by a key this environment ` +
          `recognises. Note this is a key-identity check, not signature verification.`,
      },
    };
    recordSimulatedDecision(out);
    return out;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest tests/simulatedAuthorizeKid.test.js src/__tests__/simulatedAuthorizeMissingUser.test.js tests/simulatedAuthorizeService.rar.test.js \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: PASS — the 5 new tests, plus the existing simulated specs proving guard ordering did not regress.

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check
git add demo_api_server/services/simulatedAuthorizeService.js demo_api_server/tests/simulatedAuthorizeKid.test.js
git commit -m "feat(authz): signing-key guard in the simulated engine

Mirrors the live P1AZ rule so the check works in simulated mode, which
is what the demo runs by default and what enforces before the console
rule is authored.

Placed before the audience guard: an unpublished signing key means the
token is not ours at all, whereas an audience mismatch means a real
token reached the wrong place. Only tokenKidKnown === false denies --
null is unknown and must not."
```

---

### Task 4: BFF gate wiring

**Files:**
- Modify: `demo_api_server/services/mcpToolAuthorizationService.js:14` (require), `:553` (reads), `:768` (forward)
- Test: `demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js` (extend)

**Interfaces:**
- Consumes: `jwksService.hasKid(kid) => Promise<boolean|null>` (Task 1); `evaluateMcpToolDelegation({ tokenKid, tokenKidKnown })` (Task 2); `evaluateMcpFirstTool({ tokenKid, tokenKidKnown })` (Task 3)
- Produces: both engines receive `tokenKid` and `tokenKidKnown` on every gate evaluation. Task 5 reads the resulting decision parameters in the UI.

- [ ] **Step 1: Write the failing test**

In `demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js`, add a `jwksService` mock next to the other `jest.mock` calls at the top of the file (after the `hitlServiceClient` mock, line 35):

```js
jest.mock('../../services/jwksService', () => ({
  hasKid: jest.fn(),
}));
```

Add to the requires (after line 40):

```js
const jwksService = require('../../services/jwksService');
```

Add this describe block inside `describe('evaluateMcpFirstToolGate', ...)`:

```js
    // Signing-key identity reaches the PDP. kid lives in the token HEADER,
    // which decodeJwt already returns and every caller so far discarded.
    describe('signing-key (kid) forwarding', () => {
      /** Build a JWT with an explicit header so kid is present. */
      const jwtWithHeader = (header, payload) => {
        const h = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
        const b = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        return `${h}.${b}.x`;
      };

      const callWith = (token) => evaluateMcpFirstToolGate({
        req: { session: {}, user: { id: 'u1' } },
        tool: 'get_my_accounts',
        toolParams: {},
        agentToken: token,
        userSub: 'u1',
      });

      beforeEach(() => {
        configStore.get.mockImplementation((k) =>
          k === 'ff_authorize_mcp_first_tool' ? 'true' : null);
        configStore.getEffective = jest.fn((k) => configStore.get(k));
        pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
        simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
          mode: 'pingone', useSimulated: false, failoverMode: 'deny',
        });
        simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
        pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
          decision: 'PERMIT', decisionId: 'gate-1',
        });
      });

      it('forwards the header kid and its resolved JWKS membership', async () => {
        jwksService.hasKid.mockResolvedValue(true);
        await callWith(jwtWithHeader(
          { alg: 'RS256', kid: 'kid-abc' }, { sub: 'u1', aud: 'mcp' },
        ));
        expect(jwksService.hasKid).toHaveBeenCalledWith('kid-abc');
        expect(pingOneAuthorizeService.evaluateMcpToolDelegation)
          .toHaveBeenCalledWith(expect.objectContaining({
            tokenKid: 'kid-abc', tokenKidKnown: true,
          }));
      });

      it('forwards tokenKidKnown=false for an unpublished key', async () => {
        jwksService.hasKid.mockResolvedValue(false);
        await callWith(jwtWithHeader(
          { alg: 'RS256', kid: 'kid-forged' }, { sub: 'u1', aud: 'mcp' },
        ));
        expect(pingOneAuthorizeService.evaluateMcpToolDelegation)
          .toHaveBeenCalledWith(expect.objectContaining({
            tokenKid: 'kid-forged', tokenKidKnown: false,
          }));
      });

      // A JWKS outage must degrade this check, not the whole gate.
      it('forwards tokenKidKnown=null when JWKS is unavailable', async () => {
        jwksService.hasKid.mockResolvedValue(null);
        await callWith(jwtWithHeader(
          { alg: 'RS256', kid: 'kid-abc' }, { sub: 'u1', aud: 'mcp' },
        ));
        expect(pingOneAuthorizeService.evaluateMcpToolDelegation)
          .toHaveBeenCalledWith(expect.objectContaining({
            tokenKid: 'kid-abc', tokenKidKnown: null,
          }));
      });

      it('forwards tokenKid=null when the header carries no kid', async () => {
        jwksService.hasKid.mockResolvedValue(null);
        await callWith(jwtWithHeader({ alg: 'none' }, { sub: 'u1', aud: 'mcp' }));
        expect(pingOneAuthorizeService.evaluateMcpToolDelegation)
          .toHaveBeenCalledWith(expect.objectContaining({ tokenKid: null }));
      });
    });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest src/__tests__/mcpToolAuthorizationService.test.js \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: FAIL — `jwksService.hasKid` was never called, and the forwarded object has no `tokenKid` key.

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/services/mcpToolAuthorizationService.js`, add the require after line 14 (`const { decodeJwtClaims } = require('./agentMcpTokenService');`):

```js
const jwksService = require('./jwksService');
```

After the `tokenIss` read (line 553), add:

```js
  // Signing-key identity (additional check). kid comes off the token HEADER,
  // which decodeJwt already returns (utils/tokenUtils.js:25) and every caller
  // so far discarded. tokenKidKnown is BFF-pre-resolved because the P1AZ
  // snapshot DSL can neither fetch a JWKS nor do array-contains — the same
  // reason InRequiredGroup and UserTier are pre-resolved. null → the key is
  // OMITTED downstream (C1 rule 3: omission means "unknown", never "verified
  // absent"), so a JWKS outage degrades THIS check and leaves the rest of the
  // gate enforcing exactly as it does today.
  const tokenKid = decoded?.header?.kid ? String(decoded.header.kid) : null;
  const tokenKidKnown = await jwksService.hasKid(tokenKid);
```

In the shared parameter object, after `tokenIss,` (line 768):

```js
    tokenKid,
    tokenKidKnown,
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest src/__tests__/mcpToolAuthorizationService.test.js src/__tests__/mcpDelegationParity.test.js \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: PASS — the 4 new tests plus every pre-existing gate test.

- [ ] **Step 5: Run the full BFF suite**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest --forceExit \
  --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

Expected: PASS. Paste the summary line as evidence. This run regenerates files under `data/step-verification/**` and `data/goldens/**` — do not stage them.

- [ ] **Step 6: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check
git status --short   # confirm ONLY the two intended files are staged-able
git add demo_api_server/services/mcpToolAuthorizationService.js demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js
git commit -m "feat(authz): resolve and forward the token's signing-key identity

Reads kid off the JWT header -- already decoded by decodeJwt and
discarded until now -- resolves JWKS membership, and passes both to
whichever engine runs so live and simulated see identical inputs.

A JWKS outage yields null, which omits the attribute downstream: this
check degrades, every other C1 check keeps enforcing."
```

---

### Task 5: Token chain callout

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.js` — add exported `readAuthorizeParameters`, render a policy-input row inside `AuthorizeDecisionEduBox` (line 1786)
- Test: `demo_api_ui/src/components/__tests__/TokenChainDisplay.kidCallout.test.js` (create)

**Interfaces:**
- Consumes: decision parameters produced by Tasks 2-4, already carried on `event.authorizeRequest`
- Produces: `readAuthorizeParameters(event) => object|null` — named export, mirroring the existing `resolveStatusVisual` export pattern used by `TokenChainDisplay.intentBinding.test.js`

**Why a named export:** the two engines expose parameters at different paths (live `request.body.parameters` at `mcpToolAuthorizationService.js:890`, simulated `request.parameters` at `:1001`). Testing that shape-normalisation directly is cheaper and more precise than asserting it through a full render, and matches the existing spec convention in this directory.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/TokenChainDisplay.kidCallout.test.js`:

```js
/**
 * Token chain — signing-key callout on the authorize-decision step.
 *
 * The two engines expose decision parameters at DIFFERENT paths:
 *   live PingOne  → authorizeRequest.body.parameters
 *   simulated     → authorizeRequest.parameters
 * A reader handling only one shape renders empty in the other mode while
 * looking correct in whichever mode was tested. Both are asserted here.
 */
import { readAuthorizeParameters } from "../TokenChainDisplay";

describe("readAuthorizeParameters — engine shape normalisation", () => {
  test("reads the live PingOne shape (request.body.parameters)", () => {
    const event = {
      id: "authorize-decision",
      authorizeRequest: {
        method: "POST",
        url: "https://api.pingone.com/v1/environments/e/decisionEndpoints/d",
        body: { parameters: { TokenKid: "kid-abc", TokenKidKnown: true } },
      },
    };
    const params = readAuthorizeParameters(event);
    expect(params.TokenKid).toBe("kid-abc");
    expect(params.TokenKidKnown).toBe(true);
  });

  test("reads the simulated shape (request.parameters)", () => {
    const event = {
      id: "authorize-decision",
      authorizeRequest: { parameters: { TokenKid: "kid-sim", TokenKidKnown: false } },
    };
    const params = readAuthorizeParameters(event);
    expect(params.TokenKid).toBe("kid-sim");
    expect(params.TokenKidKnown).toBe(false);
  });

  test("returns null when no parameters are present", () => {
    expect(readAuthorizeParameters({ id: "authorize-decision" })).toBeNull();
    expect(readAuthorizeParameters({ id: "authorize-decision", authorizeRequest: {} })).toBeNull();
  });

  test("returns null for an event with no authorizeRequest at all", () => {
    expect(readAuthorizeParameters({ id: "user-token" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_ui && \
  CI=true npx vitest run src/components/__tests__/TokenChainDisplay.kidCallout.test.js
```

Expected: FAIL — `readAuthorizeParameters is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `demo_api_ui/src/components/TokenChainDisplay.js`, add immediately above `function AuthorizeDecisionEduBox` (line 1786):

```js
/**
 * Normalise decision parameters off an authorize-decision event.
 *
 * The two engines expose them at different paths — live PingOne nests them
 * under the HTTP body (mcpToolAuthorizationService.js:890), the simulated
 * engine does not (:1001). Reading only one shape renders an empty callout in
 * the other mode while looking correct in whichever mode was tested.
 *
 * @returns {object|null} the parameters object, or null when absent
 */
export function readAuthorizeParameters(event) {
  return (
    event?.authorizeRequest?.body?.parameters ??
    event?.authorizeRequest?.parameters ??
    null
  );
}
```

Inside `AuthorizeDecisionEduBox`, after the `authorizeRef` const (line 1794):

```js
  // Signing-key identity as a policy input — fine-grained authorization.
  // Distinct from the authn-step kid display, which reports a verified
  // signature; here the same key identity is re-evaluated per call as an
  // authorization attribute. Absent keys render nothing: omission is a
  // legitimate state (no kid, or JWKS unavailable), not a failure.
  const azParams = readAuthorizeParameters(event);
  const tokenKid = azParams?.TokenKid ?? null;
  const tokenKidKnown = azParams?.TokenKidKnown;
```

Then add these two list items inside the `<ul className="tcd-edu-checklist">`, immediately after the `authorizeRef` `{...}` block (after line 1866):

```jsx
          {tokenKid && (
            <li>
              <span className="tcd-edu-check-lbl">Signing key:</span>
              <span>
                <code>{tokenKid}</code>
                {tokenKidKnown === true
                  ? " — published in the issuer's JWKS"
                  : tokenKidKnown === false
                    ? " — not published in the issuer's JWKS"
                    : " — JWKS membership unresolved"}
              </span>
            </li>
          )}
```

And add this paragraph immediately after the closing `</ul>` (line 1867), before the `JsonField` calls:

```jsx
        {tokenKid && (
          <p className="tcd-edu-detail">
            Authentication asked whether the signature was valid. Authorization
            asks a different question, on every call: is this signing key one
            the policy still accepts? The same <code>kid</code> is re-evaluated
            here as a policy attribute — this is not signature verification.
          </p>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_ui && \
  CI=true npx vitest run src/components/__tests__/TokenChainDisplay.kidCallout.test.js
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run the existing TokenChainDisplay specs**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_ui && \
  CI=true npx vitest run src/components/__tests__/TokenChainDisplay.haltedAt.test.js \
  src/components/__tests__/TokenChainDisplay.intentBinding.test.js \
  src/components/__tests__/TokenChainTraceRail.test.jsx
```

Expected: PASS — proves the `authorize-decision` event shape, the status buckets, and the authn-step kid block are untouched.

- [ ] **Step 6: Run the UI build gate**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_ui && \
  npm run test:unit && npm run build
```

Expected: both exit 0. REGRESSION_PLAN §0 — UI work is not complete until the build gate passes. Paste the result.

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check
git add demo_api_ui/src/components/TokenChainDisplay.js demo_api_ui/src/components/__tests__/TokenChainDisplay.kidCallout.test.js
git commit -m "feat(ui): show signing-key identity on the authorize-decision step

Calls out kid as fine-grained authorization: a policy input evaluated
per call, not the one-time signature check.

Deliberately NOT added to the existing kid display -- that block sits
behind verified && fallback === 'jwks', is fed by real signature
verification, and reusing it would teach that a kid check verifies a
signature.

readAuthorizeParameters normalises both engine shapes (live nests under
request.body, simulated does not); handling one alone renders empty in
the other mode. authorize-decision's id and shape are unchanged -- it is
ProofStrip evidence and computeVerdict short-circuits on missing steps."
```

---

## Final verification

- [ ] **Full BFF suite**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_server && \
  CI=true npx jest --forceExit --testPathIgnorePatterns="/node_modules/" "/tests/real/"
```

- [ ] **UI unit + build**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check/demo_api_ui && \
  npm run test:unit && npm run build
```

- [ ] **Confirm no stray artifacts staged**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/p1az-kid-check
git status --short
git log --oneline origin/main..HEAD
```

Restore any regenerated `data/step-verification/**` or `data/goldens/**` files that the jest runs rewrote.

- [ ] **Success criteria (from the spec)**

- ✅ `hasKid` returns `false` for an unpublished kid, and the revert-to-RED step was run and observed failing
- ✅ Live path emits both attributes; a JWKS outage omits `TokenKidKnown` and leaves all other parameters intact
- ✅ Simulated path denies on `false`, is inert on `null`
- ✅ Token chain shows the signing key in both live and simulated shapes; absent parameters render nothing
- ✅ Both suites green, output pasted as evidence
- ✅ `getPublicKey`, the authn-step kid block, and the `authorize-decision` event shape all unchanged
- ✅ Staged explicitly on `worktree-p1az-kid-check`

## Notes for the implementer

**Pre-existing, out of scope:** `AuthorizeDecisionEduBox` uses `⏳` (line 1803), which is not on the REGRESSION_PLAN §0 emoji allowlist. It predates this work and is not part of this change — leave it. Flag it to the user rather than fixing it silently.

**Live enforcement is a separate, manual step.** After this plan lands, the P1AZ console still needs the rule `DENY if TokenKidKnown == false` with statement code `mcp-invalid-kid`. Until then, live mode sends the attribute and ignores it; simulated mode enforces. That is expected — do not "fix" it in code.
