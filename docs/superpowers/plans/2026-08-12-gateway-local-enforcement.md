# Gateway Local Enforcement for P1AZ-Unexpressable Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local enforcement at both gateways (Node `demo_mcp_gateway/` and IG `ping-gateway/` groovy) for the 4 of 5 rules the real PingOne Authorize (P1AZ) DSL structurally cannot express (`snapshots/gen-authorize-snapshot.js:30-47`), so those rules are enforced even when real P1AZ is the active PDP — without duplicating what P1AZ already covers.

**Architecture:** Two enforcement points act as backstops for what the PDP can't check. Node gateway already has 2 of these done (D-05 multi-aud, RAR single-payee) — this plan closes its remaining gaps (iat max-age, per-tool scope backstop, tier) and builds the IG/groovy side from near-zero (temporal, per-tool scope, D-05, tier). All new local checks are additive to the existing PDP call, not replacements — the PDP call still runs and its own DENY still wins if it fires first (fail-closed on either).

**Tech Stack:** Node gateway: TypeScript 5, Jest 29.7 + ts-jest. IG gateway: Groovy (ForgeRock IG ScriptableFilter), no unit test runner — verified via `ping-gateway/scripts/check-groovy-params.sh` (static grep-based parity check) plus live curl against the running compose stack. BFF: CommonJS + Express.

## Global Constraints

- Node gateway: `npm run build` (tsc) and `npm test` (jest `--forceExit`) must both pass before any task in `demo_mcp_gateway/` is done — `demo_mcp_gateway/CLAUDE.md`.
- Groovy has no test runner. Verification = extend `ping-gateway/scripts/check-groovy-params.sh` with a grep for each new marker string, run it, then `docker restart ai-demo-ping-gateway` (bind-mounted `./config:/var/gateway/config:ro`, no rebuild — `ping-gateway/docker-compose.yml:32`, `REGRESSION_PLAN.md:1181-1182`) and curl the route live.
- Every new local check must cite the mock rule it mirrors by file:line in a comment — repo convention already followed by `GatewayTokenPolicy.ts:117-144`, `tokenValidator.ts:280-284`, `p1az-decision.groovy` throughout.
- No file touched by this plan is a hard REGRESSION_PLAN §1 do-not-break area (confirmed by grep — only `middleware/auth.js`'s aud check is, and this plan doesn't touch it). Still: minimal diff, no drive-by cleanup (root CLAUDE.md rules 2–3).
- **Flagged conflict — read before Task 8.** `ping-gateway/scripts/check-groovy-params.sh:78-81` explicitly WARNs if `p1az-decision.groovy` contains a local RAR DENY string, with the comment "P1AZ decides." Task 8 (RAR payee local deny) goes against this documented guard rail. It ships **default-off** behind `PG_LOCAL_RAR_PAYEE_ENFORCE=true` and the plan does not turn it on — flip it only after explicit sign-off, separate from the rest of this plan.
- Money-path scope: this plan only adds the **payee** half of RAR locally. The **amount** ceiling is already enforced by real P1AZ's `RarMaxAmount`/`RarAmountExceeded` rule (`snapshots/gen-authorize-snapshot.js:20-22`) — do not duplicate it.
- D-05 multi-aud and RAR single-payee are **already fully implemented on the Node gateway** (`GatewayTokenPolicy.ts:117-144`, `rarEnforce.ts:42-76`) — no Node-side work for those two items; this plan only closes the groovy side of D-05 (Task 7) and leaves RAR payee groovy-side opt-in (Task 8).

---

## File structure

**Node gateway (`demo_mcp_gateway/`):**
- Modify `src/tokenValidator.ts` — add iat max-age check (Task 1)
- Modify `src/auth/scopeTopology.ts` — add `allowedScopes()`, `isA2aDelegatedTool()`, `a2aDelegatedScope()` (Task 2)
- Modify `src/auth/toolScopes.ts` — extend `evaluateScopeDecisionLocally` with gateway-hop-scope bypass + A2A delegated-scope satisfaction, full Rule-3 parity (Task 3)
- Modify `src/middleware/authorizeMcpRequest.ts` — wire the extended scope check unconditionally (HTTP transport) (Task 3)
- Modify `src/pingAuthorizeGuard.ts` — same wiring, WS transport (Task 3)
- Modify `src/middleware/authorizeMcpRequest.ts`, `src/pingAuthorizeGuard.ts` — tier local deny (Task 4)

**BFF (`demo_api_server/`):**
- Modify `services/mcpGatewayClient.js` — send `X-User-Tier` / `X-Tier-Max-Amount-Usd` / `X-Tier-Restricted-Tools` headers (Task 5)
- Modify the WS-transport equivalent client (located in Task 5, step 1)

**IG gateway (`ping-gateway/`):**
- Modify `docker-compose.yml` — bind-mount `scope-topology.json` into the container (Task 6)
- Modify `scripts/groovy/p1az-decision.groovy` — local per-tool-scope deny (Task 6), local temporal deny (Task 7), local D-05 multi-aud deny (Task 7), local tier deny (Task 9), local RAR-payee deny behind opt-in flag (Task 8)
- Modify `scripts/check-groovy-params.sh` — add parity greps for each new marker (each groovy task)

---

### Task 1: Node gateway — iat max-age check

**Files:**
- Modify: `demo_mcp_gateway/src/tokenValidator.ts:275-301`
- Test: `demo_mcp_gateway/tests/tokenValidator-claims.test.ts`

**Interfaces:**
- Consumes: nothing new — `decoded.iat` is already on `DecodedGatewayToken` (JWT standard claim, already read into `TokenIat` at `PingOneAuthorizeClient.ts:179`).
- Produces: `validateInboundToken()` now also rejects on `invalid_iat` / `token_too_old`, same as it already does for `expired_token` / `token_not_yet_valid` / `invalid_iss`.

- [ ] **Step 1: Write the failing tests**

Add to `demo_mcp_gateway/tests/tokenValidator-claims.test.ts`, inside a new `describe` block (mirror the existing `nbf`/`iss` block style, lines 80-134):

```typescript
describe('validateInboundToken — iat max-age (mirrors decision.js Rule 0d)', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    delete process.env.PINGONE_JWKS_ENDPOINT;
    delete process.env.STRICT_AUTH;
    delete process.env.PINGONE_ISSUER_URI;
    delete process.env.MCP_GW_IAT_MAX_AGE_SECONDS;
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
  });
  afterAll(() => { process.env = OLD; });

  test('rejects a token whose iat is in the future beyond 30s skew', async () => {
    const { validateInboundToken } = freshValidator();
    const iat = Math.floor(Date.now() / 1000) + 600;
    await expect(validateInboundToken(makeUnsignedToken({ iat }), GW_AUD))
      .rejects.toThrow(/issued in the future/i);
  });

  test('rejects a token older than the default 7200s max age', async () => {
    const { validateInboundToken } = freshValidator();
    const iat = Math.floor(Date.now() / 1000) - 7300;
    await expect(validateInboundToken(makeUnsignedToken({ iat }), GW_AUD))
      .rejects.toThrow(/token_too_old|too old/i);
  });

  test('accepts a token within the default max age', async () => {
    const { validateInboundToken } = freshValidator();
    const iat = Math.floor(Date.now() / 1000) - 100;
    const decoded = await validateInboundToken(makeUnsignedToken({ iat }), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });

  test('honors MCP_GW_IAT_MAX_AGE_SECONDS override', async () => {
    process.env.MCP_GW_IAT_MAX_AGE_SECONDS = '60';
    const { validateInboundToken } = freshValidator();
    const iat = Math.floor(Date.now() / 1000) - 120;
    await expect(validateInboundToken(makeUnsignedToken({ iat }), GW_AUD))
      .rejects.toThrow(/too old/i);
  });

  test('skips the check when the token carries no iat', async () => {
    const { validateInboundToken } = freshValidator();
    const decoded = await validateInboundToken(makeUnsignedToken({}), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tokenValidator-claims -t "iat max-age" -v`
Expected: FAIL (4 of 5 new tests fail — no iat check exists yet; the "skips" test passes vacuously).

- [ ] **Step 3: Implement the minimal check**

In `demo_mcp_gateway/src/tokenValidator.ts`, insert immediately after the existing nbf block (after line 290, before the iss block at line 292):

```typescript
  // F-iat — mirrors decision.js Rule 0d (demo_authz_server/routes/decision.js:396-409):
  // iat must not be in the future and must not be older than the max-age ceiling.
  // Only enforced when the claim is present (same posture as nbf above).
  const IAT_MAX_AGE_SEC = parseInt(process.env.MCP_GW_IAT_MAX_AGE_SECONDS || '7200', 10);
  if (typeof decoded.iat === 'number') {
    if (decoded.iat > nowSec + CLOCK_SKEW_SEC) {
      throw new TokenValidationError('Token issued in the future (iat)', 'invalid_iat');
    }
    if (nowSec - decoded.iat > IAT_MAX_AGE_SEC) {
      throw new TokenValidationError(
        `Token too old: issued ${nowSec - decoded.iat}s ago (max ${IAT_MAX_AGE_SEC}s)`,
        'token_too_old',
      );
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_mcp_gateway && npx jest tokenValidator-claims -v`
Expected: PASS — all tests in the file, including the pre-existing nbf/iss/kid-selection ones (no regression).

- [ ] **Step 5: Build check**

Run: `cd demo_mcp_gateway && npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/tokenValidator.ts demo_mcp_gateway/tests/tokenValidator-claims.test.ts
git commit -m "feat(mcp-gateway): enforce iat max-age on inbound tokens (mirrors decision.js Rule 0d)"
```

---

### Task 2: Node gateway — extend scopeTopology.ts with A2A + allowedScopes accessors

**Files:**
- Modify: `demo_mcp_gateway/src/auth/scopeTopology.ts`
- Test: `demo_mcp_gateway/tests/scopeTopology.test.ts`

**Interfaces:**
- Consumes: `scope-topology.json` manifest (`resources`, `scopes`, `tools[name].a2aDelegated`, `tools[name].a2aDelegatedScope`) — same file already imported at `scopeTopology.ts:11`.
- Produces: `allowedScopes(): string[]`, `isA2aDelegatedTool(name: string): boolean`, `a2aDelegatedScope(name: string): string | null` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `demo_mcp_gateway/tests/scopeTopology.test.ts`:

```typescript
import { allowedScopes, isA2aDelegatedTool, a2aDelegatedScope } from '../src/auth/scopeTopology';

describe('scopeTopology — A2A + allowedScopes accessors (parity with demo_authz_server/scopeTopology.js)', () => {
  test('allowedScopes returns every scope name declared in the SoT', () => {
    const scopes = allowedScopes();
    expect(scopes).toContain('read');
    expect(scopes).toContain('write');
    expect(scopes.length).toBeGreaterThan(0);
  });

  test('isA2aDelegatedTool is false for an unknown tool', () => {
    expect(isA2aDelegatedTool('no_such_tool')).toBe(false);
  });

  test('a2aDelegatedScope returns null for a tool with no declared A2A scope', () => {
    expect(a2aDelegatedScope('no_such_tool')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_mcp_gateway && npx jest scopeTopology -v`
Expected: FAIL — `allowedScopes`/`isA2aDelegatedTool`/`a2aDelegatedScope` are not exported yet (TS compile error via ts-jest).

- [ ] **Step 3: Implement**

Append to `demo_mcp_gateway/src/auth/scopeTopology.ts` (extend the `Manifest`/`ToolEntry` interfaces first, then add the three functions — mirrors `demo_authz_server/scopeTopology.js:65-91,135-137`):

```typescript
interface ToolEntry {
  requiredScopes: string[];
  surface: Surface;
  challengeType?: 'step_up' | 'consent';
  requiresAgentMediation?: boolean;
  a2aDelegated?: boolean;
  a2aDelegatedScope?: string;
}
```
(replace the existing `ToolEntry` interface at line 14 with the above — adds the two new optional fields, no behavior change to existing readers.)

```typescript
interface ScopesManifest { scopes?: Record<string, unknown>; }

/** All scope names declared in the SoT — mirrors demo_authz_server/scopeTopology.js:135-137. */
export function allowedScopes(): string[] {
  return Object.keys((manifest as unknown as ScopesManifest).scopes || {});
}

/**
 * True when the tool is reachable ONLY via A2A specialist delegation (act chain
 * depth >= 2). Mirrors demo_authz_server/scopeTopology.js:65-70.
 */
export function isA2aDelegatedTool(name: string): boolean {
  const t = M.tools[name];
  return t?.a2aDelegated === true;
}

/**
 * The tool's least-privilege A2A scope (e.g. 'records:read' instead of 'read'),
 * when the SoT declares one. Mirrors demo_authz_server/scopeTopology.js:86-91.
 */
export function a2aDelegatedScope(name: string): string | null {
  const t = M.tools[name];
  const scope = t?.a2aDelegatedScope;
  return typeof scope === 'string' && scope ? scope : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_mcp_gateway && npx jest scopeTopology -v`
Expected: PASS.

- [ ] **Step 5: Build check**

Run: `cd demo_mcp_gateway && npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/auth/scopeTopology.ts demo_mcp_gateway/tests/scopeTopology.test.ts
git commit -m "feat(mcp-gateway): add A2A delegated-scope and allowedScopes accessors to scopeTopology"
```

---

### Task 3: Node gateway — per-tool scope backstop (full Rule 3 parity, runs even when P1AZ is active)

**Files:**
- Modify: `demo_mcp_gateway/src/auth/toolScopes.ts`
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`
- Modify: `demo_mcp_gateway/src/pingAuthorizeGuard.ts`
- Test: create `demo_mcp_gateway/tests/toolScopes.test.ts`

**Interfaces:**
- Consumes: `allowedScopes()`, `isA2aDelegatedTool()`, `a2aDelegatedScope()` from Task 2; `actChainDepth` already exported from `PingOneAuthorizeClient.ts`.
- Produces: `evaluateScopeDecisionUnconditionally(toolName: string, scopeClaim: string | undefined, actChainDepth: number): { decision: 'PERMIT' } | { decision: 'DENY'; reason: string; missingScopes: string[] }` — new function, additive (does not replace `evaluateScopeDecisionLocally`, which stays for the no-P1AZ fallback branch and is now a thin wrapper).

**Why this needs the full Rule 3 logic, not a naive "missing scope ⇒ deny":** A2A specialist calls (5/5 calls on this gateway) present a narrower delegated scope (e.g. `records:read`), not the tool's generic `requiredScopes` (e.g. `read`) — see `demo_authz_server/routes/decision.js:660-715` comments. A naive unconditional check would DENY every real A2A call. This task ports the mock's gateway-hop-scope bypass and A2A-delegated-scope satisfaction so the backstop agrees with the PDP it's backing up.

- [ ] **Step 1: Write the failing tests**

Create `demo_mcp_gateway/tests/toolScopes.test.ts`:

```typescript
import { evaluateScopeDecisionUnconditionally } from '../src/auth/toolScopes';

describe('evaluateScopeDecisionUnconditionally — Rule 3 parity (decision.js:660-715), runs regardless of P1AZ state', () => {
  test('PERMITs when the bearer carries the tool\'s exact required scope', () => {
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'write transfer', 0);
    expect(result.decision).toBe('PERMIT');
  });

  test('DENIEs a tool call missing a required scope, carrying only an unrelated topology scope', () => {
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'read', 0);
    expect(result.decision).toBe('DENY');
  });

  test('gateway-hop-scope bypass: a bearer carrying ONLY gateway:mcp:invoke (no other topology scope) is exempt from per-tool scope', () => {
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'gateway:mcp:invoke', 0);
    expect(result.decision).toBe('PERMIT');
  });

  test('hop-scope bypass does NOT apply once the bearer also supplies a real topology scope', () => {
    // carries the hop scope AND an unrelated topology scope ('read') but not the required 'write'/'transfer'
    const result = evaluateScopeDecisionUnconditionally('create_transfer', 'gateway:mcp:invoke read', 0);
    expect(result.decision).toBe('DENY');
  });

  test('A2A delegated scope satisfies an A2A-delegated tool at act chain depth >= 2', () => {
    // get_my_accounts is not A2A-delegated in the SoT today — this test asserts the
    // MECHANISM using a tool this repo declares a2aDelegated (verify the exact tool
    // name against scope-topology.json before writing the assertion; substitute here).
    // If no tool in the current SoT declares a2aDelegated, this test documents the
    // mechanism against a synthetic case instead — see Step 1a below.
  });

  test('unknown tool denies (no fallback to read)', () => {
    const result = evaluateScopeDecisionUnconditionally('no_such_tool', 'read write transfer', 0);
    expect(result.decision).toBe('DENY');
  });
});
```

- [ ] **Step 1a: Resolve the A2A test tool name before finalizing Step 1**

Run: `grep -B2 'a2aDelegated.*true' /Users/cmuir/Development/AI-DEMO2/scope-topology.json`
If a tool is found, use its name and declared `a2aDelegatedScope` value in the 5th test above (assert `evaluateScopeDecisionUnconditionally(<tool>, <a2aDelegatedScope>, 2).decision === 'PERMIT'` and that the same call at depth `0` DENIEs). If no tool currently declares `a2aDelegated: true`, keep the mechanism covered by directly unit-testing the exported helper logic path (mock `isA2aDelegatedTool`/`a2aDelegatedScope` via `jest.mock('../src/auth/scopeTopology', ...)` returning a synthetic tool) rather than leaving the test empty.

- [ ] **Step 2: Run to verify failure**

Run: `cd demo_mcp_gateway && npx jest toolScopes -v`
Expected: FAIL — `evaluateScopeDecisionUnconditionally` does not exist yet.

- [ ] **Step 3: Implement**

In `demo_mcp_gateway/src/auth/toolScopes.ts`, add imports and the new function (mirrors `demo_authz_server/routes/decision.js:660-715`):

```typescript
import {
  gatewayToolNames, toolRequiredScopes, toolChallengeType,
  allowedScopes, isA2aDelegatedTool, a2aDelegatedScope,
} from './scopeTopology';

/** Mirrors decision.js:181 GATEWAY_HOP_SCOPES — the coarse scopes that admit a
 *  caller past the gateway's own OAuth2ResourceServerFilter but say nothing
 *  about which tool it may invoke. */
const GATEWAY_HOP_SCOPES = ['gateway:mcp:invoke', 'pinggateway:invoke'];

/**
 * Full Rule 3 parity (demo_authz_server/routes/decision.js:660-715) — the
 * per-tool scope backstop. Unlike evaluateScopeDecisionLocally (which only
 * runs when P1AZ is NOT configured), this is the check the gateway runs
 * UNCONDITIONALLY, because real PingOne Authorize's DSL cannot express
 * per-tool set-membership over TokenScopes (snapshots/gen-authorize-snapshot.js:36-39).
 *
 * @param actChainDepth from PingOneAuthorizeClient.actChainDepth(decoded.act) —
 *   depth >= 2 means a specialist delegated by a generalist (A2A).
 */
export function evaluateScopeDecisionUnconditionally(
  toolName: string,
  scopeClaim: string | undefined,
  actChainDepth: number,
): { decision: 'PERMIT' } | { decision: 'DENY'; reason: string; missingScopes: string[] } {
  const required = getScopesForGatewayTool(toolName);
  const granted = new Set(String(scopeClaim || '').split(/\s+/).filter(Boolean));

  // Gateway-hop-scope bypass: a bearer carrying ONLY the coarse hop scope (no
  // other topology-known scope) is exempt — it hasn't been given a per-tool
  // grant to check against, so there's nothing to enforce here (the caller
  // relied entirely on the PDP call this backstop supplements).
  const hasGatewayHopScope = GATEWAY_HOP_SCOPES.some((s) => granted.has(s));
  const topologyScopes = new Set(allowedScopes());
  const suppliesPerToolScopes = [...granted].some(
    (s) => topologyScopes.has(s) && !GATEWAY_HOP_SCOPES.includes(s),
  );
  if (hasGatewayHopScope && !suppliesPerToolScopes) {
    return { decision: 'PERMIT' };
  }

  // A2A delegated-scope satisfaction: a specialist (depth >= 2) presenting the
  // tool's declared least-privilege scope satisfies the check even though it
  // differs from requiredScopes by name.
  if (actChainDepth >= 2 && isA2aDelegatedTool(toolName)) {
    const delegated = a2aDelegatedScope(toolName);
    if (delegated && granted.has(delegated)) {
      return { decision: 'PERMIT' };
    }
  }

  const missing = required.filter((s) => !granted.has(s));
  if (missing.length === 0) return { decision: 'PERMIT' };
  return {
    decision: 'DENY',
    reason: `insufficient_scope: missing ${missing.join(', ')}`,
    missingScopes: missing,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_mcp_gateway && npx jest toolScopes -v`
Expected: PASS.

- [ ] **Step 5: Wire into the HTTP transport**

In `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`, find the RAR check block (`config.requireRarIntent === true`, per research at approx. line 266-274) and insert immediately after it, before the `isP1AZActive` branch:

```typescript
  // Per-tool scope backstop (Rule 3 parity) — runs REGARDLESS of P1AZ state.
  // Real P1AZ cannot express per-tool set-membership over TokenScopes
  // (snapshots/gen-authorize-snapshot.js:36-39); this is the gateway's own
  // enforcement of that rule, mirroring decision.js Rule 3.
  if (toolName) {
    const scopeBackstop = evaluateScopeDecisionUnconditionally(
      toolName, decoded.scope, actChainDepth(decoded.act),
    );
    if (scopeBackstop.decision === 'DENY') {
      // build and return the same 403 shape used elsewhere in this file for a
      // policy DENY — match the existing sendForbidden/response helper already
      // used by this file's other local denies (locate the exact helper name
      // used for the RAR-violation return a few lines above and reuse it).
    }
  }
```

Add `evaluateScopeDecisionUnconditionally` and `actChainDepth` to this file's existing imports (`actChainDepth` is exported from `../auth/PingOneAuthorizeClient`, already imported elsewhere in the gateway — confirm the exact re-export path used by `GatewayTokenPolicy.ts:18` and match it here: `import { actChainDepth } from '../auth/PingOneAuthorizeClient';`).

**Before finalizing this step:** read `authorizeMcpRequest.ts` around the RAR-violation return (`return { permitted: false, reason: ... }` — confirm the exact return shape this file's caller expects for a DENY, since the WS file's shape differs (`{ permitted: false, reason }`) from the HTTP file's (likely an HTTP response object or a thrown/returned policy object) — mirror whichever shape the RAR check three lines above already returns, not the WS shape.

- [ ] **Step 6: Wire into the WS transport**

In `demo_mcp_gateway/src/pingAuthorizeGuard.ts`, insert immediately after the RAR block (after the `enforceRarSubset` check, before the `isP1AZActive` branch, per research at approx. line 266-276):

```typescript
  // Per-tool scope backstop (Rule 3 parity) — runs REGARDLESS of P1AZ state.
  if (toolName) {
    const scopeBackstop = evaluateScopeDecisionUnconditionally(
      toolName, decoded.scope, actChainDepth(decoded.act),
    );
    if (scopeBackstop.decision === 'DENY') {
      return { permitted: false, reason: `scope_backstop: ${scopeBackstop.reason}`, engine: 'mock', policySource: 'local-fallback' };
    }
  }
```

Add `evaluateScopeDecisionUnconditionally` to this file's existing `from './auth/toolScopes'`-style import (it already imports `evaluateScopeDecisionLocally` from the same module per the research report).

- [ ] **Step 7: Manual A2A regression check**

Before running the full suite, specifically run any existing A2A-path tests to confirm the backstop doesn't regress delegation:

Run: `cd demo_mcp_gateway && npx jest a2a -v` (matches any test file with "a2a" in its name/describe block — confirm the actual filename via `ls demo_mcp_gateway/tests/ | grep -i a2a` first)
Expected: PASS, no new failures.

- [ ] **Step 8: Full suite + build**

Run: `cd demo_mcp_gateway && npm run build && npm test`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add demo_mcp_gateway/src/auth/toolScopes.ts demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/src/pingAuthorizeGuard.ts demo_mcp_gateway/tests/toolScopes.test.ts
git commit -m "feat(mcp-gateway): enforce per-tool scope as an unconditional backstop (Rule 3 parity, A2A-safe)"
```

---

### Task 4: Node gateway — tier (groupToTier) local enforcement

**Files:**
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`
- Modify: `demo_mcp_gateway/src/pingAuthorizeGuard.ts`
- Test: `demo_mcp_gateway/tests/tierEnforce.test.ts` (new)

**Design decision — data flow:** neither gateway can resolve PingOne group membership to a tier itself (no manifest, no group claim reliably present). The BFF already resolves this to a scalar `UserTier` for its own P1AZ preflight call (`groupPolicy.js:185-197`, "same flattening precedent as InRequiredGroup/TokenKidKnown" per the codebase's own convention). This task has the BFF (Task 5) additionally send the RESOLVED tier definition as 3 headers, so the gateway only compares — it never loads a manifest.

**Interfaces:**
- Consumes: `X-User-Tier`, `X-Tier-Max-Amount-Usd`, `X-Tier-Restricted-Tools` headers (produced by Task 5).
- Produces: `evaluateTierDecision(toolName: string, isWriteTool: boolean, amount: number | undefined, maxAmountUsd: number | undefined, restrictedTools: string[]): { decision: 'PERMIT' } | { decision: 'DENY'; reason: string }` in a new file `demo_mcp_gateway/src/tierEnforce.ts`.

- [ ] **Step 1: Write the failing tests**

Create `demo_mcp_gateway/tests/tierEnforce.test.ts`:

```typescript
import { evaluateTierDecision } from '../src/tierEnforce';

describe('evaluateTierDecision — mirrors decision.js Rule 3d (tier gate)', () => {
  test('PERMITs when no tier data is present (absence is not a violation)', () => {
    expect(evaluateTierDecision('create_withdrawal', true, 100, undefined, [])).toEqual({ decision: 'PERMIT' });
  });

  test('DENIEs a restricted tool for a Standard-tier caller', () => {
    const result = evaluateTierDecision('create_withdrawal', true, 100, 2000, ['create_withdrawal']);
    expect(result.decision).toBe('DENY');
  });

  test('PERMITs a non-restricted tool at any amount within the ceiling', () => {
    const result = evaluateTierDecision('create_transfer', true, 1500, 2000, ['create_withdrawal']);
    expect(result.decision).toBe('PERMIT');
  });

  test('DENIEs a write tool whose amount exceeds the tier ceiling', () => {
    const result = evaluateTierDecision('create_transfer', true, 3000, 2000, []);
    expect(result.decision).toBe('DENY');
  });

  test('does not apply the amount ceiling to non-write (read) tools', () => {
    const result = evaluateTierDecision('get_accounts', false, undefined, 2000, []);
    expect(result.decision).toBe('PERMIT');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd demo_mcp_gateway && npx jest tierEnforce -v`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `demo_mcp_gateway/src/tierEnforce.ts`:

```typescript
'use strict';

/**
 * Tier (groupToTier) local enforcement — mirrors decision.js Rule 3d
 * (demo_authz_server/routes/decision.js:823-855). Real P1AZ cannot map a
 * PingOne group ARRAY to a tier (no set-membership operator,
 * snapshots/gen-authorize-snapshot.js:44-47), so the BFF pre-resolves the
 * tier and its definition and forwards them as headers; this only compares.
 */
export function evaluateTierDecision(
  toolName: string,
  isWriteTool: boolean,
  amount: number | undefined,
  maxAmountUsd: number | undefined,
  restrictedTools: string[],
): { decision: 'PERMIT' } | { decision: 'DENY'; reason: string } {
  if (restrictedTools.includes(toolName)) {
    return { decision: 'DENY', reason: `tier_tool_not_allowed: "${toolName}" is not permitted at this tier` };
  }
  if (isWriteTool && typeof maxAmountUsd === 'number' && typeof amount === 'number' && amount > maxAmountUsd) {
    return { decision: 'DENY', reason: `tier_amount_exceeded: ${amount} exceeds tier ceiling ${maxAmountUsd}` };
  }
  return { decision: 'PERMIT' };
}

/** Parses the comma-joined X-Tier-Restricted-Tools header. Empty/absent -> []. */
export function parseRestrictedTools(header: string | undefined): string[] {
  return String(header || '').split(',').map((s) => s.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_mcp_gateway && npx jest tierEnforce -v`
Expected: PASS.

- [ ] **Step 5: Wire into the HTTP transport**

In `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`, next to wherever this file reads `X-Active-Vertical` (confirm exact line via `grep -n "X-Active-Vertical" demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`), read the 3 new headers and call `evaluateTierDecision` right after the Task 3 scope-backstop block:

```typescript
  const userTier = req.headers['x-user-tier'] as string | undefined;
  const tierMaxAmount = req.headers['x-tier-max-amount-usd'] as string | undefined;
  const tierRestrictedTools = parseRestrictedTools(req.headers['x-tier-restricted-tools'] as string | undefined);
  if (toolName) {
    const tierDecision = evaluateTierDecision(
      toolName,
      scopeTopology.toolRequiredScopes(toolName)?.includes('write') ?? false,
      toolArgs?.amount !== undefined ? Number(toolArgs.amount) : undefined,
      tierMaxAmount !== undefined ? Number(tierMaxAmount) : undefined,
      tierRestrictedTools,
    );
    if (tierDecision.decision === 'DENY') {
      // return the same DENY shape used by the Task 3 scope-backstop block above
    }
  }
```

Confirm the exact header-read syntax against how this file already reads `X-Active-Vertical`/`X-Use-Case-Id` (Node's `http.IncomingMessage.headers` are lowercased automatically) before finalizing — match the established pattern in this file rather than inventing a new one.

- [ ] **Step 6: Wire into the WS transport**

In `demo_mcp_gateway/src/pingAuthorizeGuard.ts`, same pattern — WS transport reads headers off the upgrade request (`req.headers`, confirm the exact variable name already used for `X-Active-Vertical` in this file's WS handshake path) and applies the same `evaluateTierDecision` call, returning `{ permitted: false, reason: ... }` on DENY, positioned after the Task 3 WS scope-backstop block.

- [ ] **Step 7: Full suite + build**

Run: `cd demo_mcp_gateway && npm run build && npm test`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add demo_mcp_gateway/src/tierEnforce.ts demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/src/pingAuthorizeGuard.ts demo_mcp_gateway/tests/tierEnforce.test.ts
git commit -m "feat(mcp-gateway): enforce tier (groupToTier) locally from BFF-forwarded headers"
```

---

### Task 5: BFF — forward resolved tier data to both gateways

**Files:**
- Modify: `demo_api_server/services/mcpGatewayClient.js`
- Test: locate and extend the existing test file for this service (`grep -rl "callToolViaGateway" demo_api_server/tests/` first — do not guess the filename)

**Interfaces:**
- Consumes: `groupPolicy.resolveUserTier(userGroups, verticalId)` and `groupPolicy.getTierDefinitions(verticalId)` (`demo_api_server/services/groupPolicy.js:185-207`, both already exist and are already used by `mcpToolAuthorizationService.js`).
- Produces: 3 new headers on every gateway tool call — `X-User-Tier`, `X-Tier-Max-Amount-Usd`, `X-Tier-Restricted-Tools` (comma-joined) — consumed by Task 4.

- [ ] **Step 1: Locate the caller and the WS-equivalent client**

Run: `grep -rln "callToolViaGateway" /Users/cmuir/Development/AI-DEMO2/demo_api_server/`
Identify (a) every call site of `callToolViaGateway` to find where `userGroups`/`verticalId` are already in scope at the call boundary, and (b) whether a separate WS client module exists (search `grep -rln "mcp-session-id\|WebSocket" demo_api_server/services/ | grep -i gateway`). Record both file paths before Step 2 — the WS client (if one exists) needs the identical header addition.

- [ ] **Step 2: Extend `callToolViaGateway`'s signature**

In `demo_api_server/services/mcpGatewayClient.js`, add an `opts.userGroups` and `opts.verticalId` (or reuse `opts.vertical`, already read at the point noted in research — confirm exact param name via the code) parameter, and inside the header-building block (next to the existing `X-Use-Case-Id` header, per research the block runs from roughly the point `opts.useCaseId` is read onward):

```javascript
  // Tier (groupToTier) — pre-resolved here because neither gateway can map a
  // PingOne group array to a tier locally (no set-membership operator in either
  // P1AZ's DSL or the gateways' own runtimes). Additive: gateways use this only
  // to DENY, never to widen a decision a token's own scopes wouldn't otherwise earn.
  const groupPolicy = require('./groupPolicy');
  const verticalForTier = (opts && opts.vertical) || configStore.getEffective('active_vertical') || 'banking';
  if (opts && Array.isArray(opts.userGroups)) {
      const tier = groupPolicy.resolveUserTier(opts.userGroups, verticalForTier);
      const tierDefs = groupPolicy.getTierDefinitions(verticalForTier);
      const tierDef = tierDefs[tier];
      headers['X-User-Tier'] = tier;
      if (tierDef) {
          if (typeof tierDef.maxAmountUsd === 'number') {
              headers['X-Tier-Max-Amount-Usd'] = String(tierDef.maxAmountUsd);
          }
          if (Array.isArray(tierDef.restrictedTools) && tierDef.restrictedTools.length) {
              headers['X-Tier-Restricted-Tools'] = tierDef.restrictedTools.join(',');
          }
      }
  }
```

- [ ] **Step 3: Wire `opts.userGroups` from every call site**

For each call site found in Step 1, pass the already-resolved user groups (the same value `mcpToolAuthorizationService.js` passes to `groupPolicy.resolveUserTier` for its own preflight call — reuse that resolution, don't re-derive it) into `opts.userGroups` when calling `callToolViaGateway`.

- [ ] **Step 4: Apply the same 3 headers to the WS client**

Using the file identified in Step 1(b), add the identical header-building block at its equivalent point (wherever it currently sets `X-Active-Vertical`/`X-Use-Case-Id` on the WS upgrade request).

- [ ] **Step 5: Write/extend tests**

In the test file located in Step 1, add:

```javascript
test('sends X-User-Tier and tier definition headers when userGroups is provided', async () => {
  // Arrange a call with opts.userGroups including a group that maps to PrivateBanking
  // in the banking manifest's tiers.groupToTier (read the actual group name from
  // demo_api_server/config/verticals/banking/manifest.json before writing this
  // assertion — do not invent a group name).
  // Assert the outgoing request headers include X-User-Tier: 'PrivateBanking' and
  // X-Tier-Max-Amount-Usd matching that tier's definitions.maxAmountUsd.
});

test('omits tier headers when userGroups is not provided (no regression to existing callers)', async () => {
  // Assert no X-User-Tier header on a call that omits opts.userGroups.
});
```

- [ ] **Step 6: Run the test suite for this service**

Run: `cd demo_api_server && CI=true npx jest <test-file-from-step-1> --forceExit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/mcpGatewayClient.js demo_api_server/tests/<test-file>
git commit -m "feat(bff): forward resolved user tier to both gateways for local enforcement"
```

---

### Task 6: IG groovy — mount scope-topology.json + local per-tool-scope deny

**Files:**
- Modify: `ping-gateway/docker-compose.yml`
- Modify: `ping-gateway/scripts/groovy/p1az-decision.groovy`
- Modify: `ping-gateway/scripts/check-groovy-params.sh`

**Interfaces:**
- Consumes: `scope-topology.json` (same SoT the Node gateway and BFF read), mounted read-only at `/var/gateway/config/scope-topology.json` (same directory pattern already used for `mcp-tool-schemas.json`, `mcp-request-validation.groovy:16`).
- Produces: a local DENY in `p1az-decision.groovy` before the parameters map is built, mirroring `decision.js` Rule 3 (gateway-hop bypass + A2A delegated-scope satisfaction, same logic as Task 3).

- [ ] **Step 1: Add the bind mount**

In `ping-gateway/docker-compose.yml`, find the existing `- ./config:/var/gateway/config:ro` line (per research, `ping-gateway/docker-compose.yml:32`) and add a sibling mount immediately after it:

```yaml
      - ../scope-topology.json:/var/gateway/config/scope-topology.json:ro
```

- [ ] **Step 2: Add the per-tool-scope local deny to p1az-decision.groovy**

Insert this block after the `tokenScopes`/`joinedAud` computation and before the `def parameters = [...]` map (locate via `grep -n "def tokenScopes" ping-gateway/scripts/groovy/p1az-decision.groovy` for the exact line):

```groovy
// ── Per-tool scope backstop (Rule 3 parity, decision.js:660-715) ──────────────
// Real P1AZ cannot express per-tool set-membership over TokenScopes
// (snapshots/gen-authorize-snapshot.js:36-39) — this is the PEP's own
// enforcement of that rule, mirroring the Node gateway's
// evaluateScopeDecisionUnconditionally (demo_mcp_gateway/src/auth/toolScopes.ts).
if (mcpMethod == 'tools/call' && toolName) {
    def topologyFile = new File('/var/gateway/config/scope-topology.json')
    if (topologyFile.exists()) {
        def topology = new JsonSlurper().parse(topologyFile)
        def toolEntry = topology.tools?.get(toolName)
        def requiredScopes = toolEntry?.requiredScopes ?: []
        def grantedScopes = tokenScopes.tokenize(' ').findAll { it } as Set
        def GATEWAY_HOP_SCOPES = ['gateway:mcp:invoke', 'pinggateway:invoke']
        def hasGatewayHopScope = GATEWAY_HOP_SCOPES.any { grantedScopes.contains(it) }
        def topologyScopes = (topology.scopes?.keySet() ?: []) as Set
        def suppliesPerToolScopes = grantedScopes.any {
            topologyScopes.contains(it) && !GATEWAY_HOP_SCOPES.contains(it)
        }
        def skipCheck = hasGatewayHopScope && !suppliesPerToolScopes
        def a2aDelegated = toolEntry?.a2aDelegated == true
        def a2aScope = toolEntry?.a2aDelegatedScope
        def satisfiedByA2a = actDepth >= 2 && a2aDelegated && a2aScope && grantedScopes.contains(a2aScope)
        if (!skipCheck && !satisfiedByA2a && !requiredScopes.isEmpty()) {
            def missing = requiredScopes.findAll { !grantedScopes.contains(it) }
            if (!missing.isEmpty()) {
                logger.warn('[P1AZ] local scope backstop DENY: tool=' + toolName + ' missing=' + missing.join(','))
                def rejected = new Response(Status.FORBIDDEN)
                rejected.headers.put('Content-Type', 'application/json')
                rejected.entity.setString(JsonOutput.toJson([
                    error: 'insufficient_scope',
                    message: 'missing ' + missing.join(', '),
                    tool: toolName,
                ]))
                return Promises.newResultPromise(rejected)
            }
        }
    } else {
        logger.warn('[P1AZ] scope-topology.json not mounted at /var/gateway/config — scope backstop skipped')
    }
}
```

Confirm the exact variable names `mcpMethod`, `toolName`, `tokenScopes`, `actDepth` (or whatever the actual chain-depth variable is named — per research it's computed via the `actChainDepth` closure) against the surrounding code before inserting — use the names already in scope at that point in the file, do not introduce new ones that shadow existing locals.

- [ ] **Step 3: Extend the static parity checker**

In `ping-gateway/scripts/check-groovy-params.sh`, add a new section before the final `Missing/violations` tally:

```bash
echo ""
echo "== Per-tool scope backstop (Task 6) =="
if grep -q "scope-topology.json" "$GROOVY"; then
  echo "  ok   reads scope-topology.json for local scope backstop"
else
  echo "  MISSING scope-topology.json read"
  missing=$((missing + 1))
fi
```

- [ ] **Step 4: Run the parity checker**

Run: `bash ping-gateway/scripts/check-groovy-params.sh`
Expected: `RESULT: PASS`, including the new section.

- [ ] **Step 5: Live verification**

Run: `docker restart ai-demo-ping-gateway` (bind-mounted, no rebuild). Then, with the stack up and `ff_mcp_gateway_pinggateway=true` and real P1AZ active, call a write tool (e.g. `create_transfer`) via a chip in the Super Sports vertical UI and confirm it still succeeds. Then use `docker logs ai-demo-ping-gateway` to confirm no `scope-topology.json not mounted` warning appears (proves the mount worked).

- [ ] **Step 6: Commit**

```bash
git add ping-gateway/docker-compose.yml ping-gateway/scripts/groovy/p1az-decision.groovy ping-gateway/scripts/check-groovy-params.sh
git commit -m "feat(ping-gateway): local per-tool scope backstop mirroring decision.js Rule 3"
```

---

### Task 7: IG groovy — local temporal (iat/nbf) and D-05 multi-aud deny

**Files:**
- Modify: `ping-gateway/scripts/groovy/p1az-decision.groovy`
- Modify: `ping-gateway/scripts/check-groovy-params.sh`

**Note on scope:** `exp` is effectively covered on this path already (PingOne introspection returns `active:false` for an expired token, which `McpGatewayProtection`/`OlbResourceServerFilter` rejects upstream of this filter — per `01-mcp-olb.json:40-48`). This task adds the two claims introspection does NOT enforce on the AS's behalf: `iat` max-age (a demo-specific replay-window rule, not something an AS "knows" to check) and `nbf` (some AS's don't gate on `nbf` in introspection `active`). It also adds D-05 multi-aud, already computed as `tokenAudActual`/`audEntries` but only ever forwarded, never locally denied.

- [ ] **Step 1: Find the upstream URI env vars for the D-05 blacklist**

Run: `grep -n "PG_OLB_RESOURCE_URI\|PG_MCP_RESOURCE_SERVER_URI\|BANKING_RESOURCE_SERVER_RESOURCE_URI\|PG_GATEWAY_RESOURCE_URI\|PG_GATEWAY_RESOURCE_ID" ping-gateway/docker-compose.yml`
Confirm all 5 env vars are actually set on the `ping-gateway` service (not just referenced in groovy scripts with a fallback default) before writing the blacklist — if `BANKING_RESOURCE_SERVER_RESOURCE_URI` is not set on this service, add it to the `environment:` block, sourced from the same value the Node gateway/BFF use (`BANKING_RESOURCE_SERVER_RESOURCE_URI` at `demo_mcp_gateway/src/config.ts:355`, default `https://banking-resource-server.ping.demo`).

- [ ] **Step 2: Add the temporal + D-05 local denies**

Insert immediately after the `tokenAudActual`/`audEntries` computation (per research, right after the `def tokenIss = tokenInfo['iss'] ?: ''` line) and before the `actChainDepth` closure:

```groovy
// ── Local temporal + D-05 backstops (decision.js Rules 0d/0e, 0b-2) ───────────
// exp is already covered upstream by introspection's active:false. iat max-age
// and nbf are demo-specific replay/validity rules an AS's introspection
// response doesn't assert — enforce them here, mirroring tokenValidator.ts's
// iat check (Task 1) and jwks-token-validation.groovy:184-191's nbf check.
def nowSecLocal = System.currentTimeMillis().intdiv(1000L)
def iatMaxAge = (System.getenv('PG_IAT_MAX_AGE_SECONDS') ?: '7200') as long
def skewLocal = 30L
if (tokenIat) {
    def iatVal = tokenIat as long
    if (iatVal > nowSecLocal + skewLocal) {
        return denyLocal('invalid_iat', 'token issued in the future', toolName)
    }
    if (nowSecLocal - iatVal > iatMaxAge) {
        return denyLocal('token_too_old', 'issued ' + (nowSecLocal - iatVal) + 's ago (max ' + iatMaxAge + 's)', toolName)
    }
}
if (tokenNbf) {
    def nbfVal = tokenNbf as long
    if (nowSecLocal < nbfVal - skewLocal) {
        return denyLocal('token_not_yet_valid', 'nbf=' + nbfVal, toolName)
    }
}
// D-05 anti-bypass: upstream audiences must never appear in the token's aud.
// Mirrors GatewayTokenPolicy.ts:117-144 — same blacklist shape, groovy env names.
def upstreamAudsLocal = [
    System.getenv('PG_OLB_RESOURCE_URI') ?: '',
    System.getenv('PG_MCP_RESOURCE_SERVER_URI') ?: '',
    System.getenv('BANKING_RESOURCE_SERVER_RESOURCE_URI') ?: '',
].findAll { it } - [System.getenv('PG_GATEWAY_RESOURCE_URI') ?: '', System.getenv('PG_GATEWAY_RESOURCE_ID') ?: '']
if (upstreamAudsLocal.any { audEntries.contains(it) }) {
    return denyLocal('bypass_attempt', 'token aud targets an upstream resource — cannot bypass gateway (D-05)', toolName)
}
```

Add a small helper above this block (or near the top of the file, next to the other closures) so each of the 4 call sites above doesn't repeat the Response-building boilerplate:

```groovy
def denyLocal = { String reason, String message, String tool ->
    logger.warn('[P1AZ] local backstop DENY: reason=' + reason + ' tool=' + tool + ' detail=' + message)
    def rejected = new Response(Status.FORBIDDEN)
    rejected.headers.put('Content-Type', 'application/json')
    rejected.entity.setString(JsonOutput.toJson([error: reason, message: message, tool: tool]))
    return Promises.newResultPromise(rejected)
}
```

Place `denyLocal` before its first use — confirm exact placement doesn't collide with an existing closure of the same name (`grep -n "denyLocal" ping-gateway/scripts/groovy/p1az-decision.groovy` should return nothing before this change).

- [ ] **Step 3: Extend the static parity checker**

Add to `ping-gateway/scripts/check-groovy-params.sh`:

```bash
echo ""
echo "== Local temporal + D-05 backstops (Task 7) =="
for marker in invalid_iat token_too_old token_not_yet_valid bypass_attempt; do
  if grep -q "'$marker'" "$GROOVY"; then
    echo "  ok   $marker"
  else
    echo "  MISSING $marker"
    missing=$((missing + 1))
  fi
done
```

- [ ] **Step 4: Run the parity checker**

Run: `bash ping-gateway/scripts/check-groovy-params.sh`
Expected: `RESULT: PASS`.

- [ ] **Step 5: Live verification**

Run: `docker restart ai-demo-ping-gateway`. Confirm a normal chip call still succeeds (temporal/D-05 checks pass for a legitimately-issued token). Negative-path verification (an actually-stale or multi-aud token) is impractical to construct live without a token-minting harness — cover this by unit-testing the Node-side equivalents (Tasks 1 and the existing `GatewayTokenPolicy.ts` tests) and treat this groovy mirror as verified-by-parity with that already-tested logic, per this repo's established practice for groovy (no groovy unit runner exists).

- [ ] **Step 6: Commit**

```bash
git add ping-gateway/scripts/groovy/p1az-decision.groovy ping-gateway/scripts/check-groovy-params.sh ping-gateway/docker-compose.yml
git commit -m "feat(ping-gateway): local iat/nbf and D-05 multi-aud backstops (decision.js parity)"
```

---

### Task 8 [DEFAULT-OFF — needs explicit sign-off]: IG groovy — RAR payee local deny

**Do not enable by default.** `ping-gateway/scripts/check-groovy-params.sh:78-81` is a repo-authored guard that WARNs specifically against this. Read the Global Constraints section above before starting this task.

**Files:**
- Modify: `ping-gateway/scripts/groovy/p1az-decision.groovy`
- Modify: `ping-gateway/docker-compose.yml` (new env var, unset by default)

**Interfaces:**
- Consumes: `rarPermittedPayees` (already computed at `p1az-decision.groovy` — space-joined string, per research), `toAccountId` (already computed for the parameters map).
- Produces: a local DENY, gated behind `PG_LOCAL_RAR_PAYEE_ENFORCE=true` (unset/false by default — this task ships the capability but does not turn it on).

- [ ] **Step 1: Add the gated local deny**

Insert immediately after the `rarPermittedPayees` computation in the `honorTrat` block (per research, right after `rarPermittedPayees = ...` is assigned):

```groovy
// ── RAR payee local deny — OPT-IN, default OFF (see check-groovy-params.sh:78-81) ──
// The amount half of RAR is already enforced by real P1AZ's RarMaxAmount rule
// (snapshots/gen-authorize-snapshot.js:20-22); only the payee half is
// unexpressable there (no set-membership operator). This mirrors
// rarEnforce.ts:67-73 (already active, unconditionally, on the Node gateway).
if (System.getenv('PG_LOCAL_RAR_PAYEE_ENFORCE') == 'true' && rarPermittedPayees) {
    def permittedList = rarPermittedPayees.tokenize(' ').findAll { it }
    def actualPayee = toAccountId ?: ''
    if (!actualPayee || !permittedList.contains(actualPayee)) {
        return denyLocal('rar_payee_not_permitted', 'payee ' + (actualPayee ?: '(missing)') + ' not in permitted list', toolName)
    }
}
```

This depends on the `denyLocal` helper from Task 7 — this task assumes Task 7 has already landed. If executed out of order, inline the same Response-building code Task 7 Step 2 shows instead of calling `denyLocal`.

- [ ] **Step 2: Add the env var to docker-compose.yml, commented, unset**

In `ping-gateway/docker-compose.yml`, next to the other `ping-gateway` environment entries, add a comment (not a live value):

```yaml
      # PG_LOCAL_RAR_PAYEE_ENFORCE: "true"  # OFF by default — see check-groovy-params.sh:78-81. Enable only after explicit review; this overrides the "P1AZ decides" convention that script guards.
```

- [ ] **Step 3: Extend the static parity checker to acknowledge the flag**

In `ping-gateway/scripts/check-groovy-params.sh`, soften the existing WARN (lines 78-81) so it distinguishes flag-gated from unconditional:

```bash
if grep -qE "rar_intent_violation|rar_intent_required" "$GROOVY"; then
  echo "  WARN local RAR DENY strings present — prefer PDP-only (check this is not primary)"
fi
if grep -q "rar_payee_not_permitted" "$GROOVY"; then
  if grep -q "PG_LOCAL_RAR_PAYEE_ENFORCE" "$GROOVY"; then
    echo "  ok   rar_payee_not_permitted is flag-gated (PG_LOCAL_RAR_PAYEE_ENFORCE, default off)"
  else
    echo "  FAIL rar_payee_not_permitted present WITHOUT a gating flag — violates PDP-only convention"
    missing=$((missing + 1))
  fi
fi
```

- [ ] **Step 4: Run the parity checker**

Run: `bash ping-gateway/scripts/check-groovy-params.sh`
Expected: `RESULT: PASS` (flag-gated, so the softened check passes; the original WARN for the unrelated `rar_intent_violation` strings, if any exist elsewhere, is unaffected).

- [ ] **Step 5: Do NOT flip the flag as part of this plan**

Leave `PG_LOCAL_RAR_PAYEE_ENFORCE` unset. Enabling it is a separate decision — surface it to the user after this plan's other tasks land, rather than bundling the decision into this commit.

- [ ] **Step 6: Commit**

```bash
git add ping-gateway/scripts/groovy/p1az-decision.groovy ping-gateway/docker-compose.yml ping-gateway/scripts/check-groovy-params.sh
git commit -m "feat(ping-gateway): add opt-in RAR payee local deny, default OFF (see check-groovy-params.sh guard)"
```

---

### Task 9: IG groovy — local tier deny

**Files:**
- Modify: `ping-gateway/scripts/groovy/p1az-decision.groovy`
- Modify: `ping-gateway/scripts/check-groovy-params.sh`

**Interfaces:**
- Consumes: `X-User-Tier`, `X-Tier-Max-Amount-Usd`, `X-Tier-Restricted-Tools` headers (produced by Task 5 — same 3 headers the Node gateway reads in Task 4).

- [ ] **Step 1: Add the local tier deny**

Insert in the same region as Task 6's per-tool-scope block (after it, same `if (mcpMethod == 'tools/call' && toolName)` guard, or its own adjacent block):

```groovy
// ── Tier (groupToTier) local deny — mirrors decision.js Rule 3d ───────────────
// BFF pre-resolves group->tier (neither gateway can do set-membership over a
// PingOne group array) and forwards the resolved definition as headers.
def userTierHeader = request.headers.getFirst('X-User-Tier') ?: ''
def tierMaxAmountHeader = request.headers.getFirst('X-Tier-Max-Amount-Usd') ?: ''
def tierRestrictedHeader = request.headers.getFirst('X-Tier-Restricted-Tools') ?: ''
if (mcpMethod == 'tools/call' && toolName && (tierMaxAmountHeader || tierRestrictedHeader)) {
    def restrictedTools = tierRestrictedHeader.tokenize(',').collect { it.trim() }.findAll { it }
    if (restrictedTools.contains(toolName)) {
        return denyLocal('tier_tool_not_allowed', '"' + toolName + '" is not permitted at tier ' + userTierHeader, toolName)
    }
    def maxAmount = tierMaxAmountHeader.isNumber() ? (tierMaxAmountHeader as BigDecimal) : null
    def txAmount = transactionAmount?.isNumber() ? (transactionAmount as BigDecimal) : null
    def isWriteToolLocal = tokenScopes.tokenize(' ').contains('write')
    if (maxAmount != null && txAmount != null && isWriteToolLocal && txAmount > maxAmount) {
        return denyLocal('tier_amount_exceeded', txAmount.toString() + ' exceeds tier ceiling ' + maxAmount.toString(), toolName)
    }
}
```

Confirm `transactionAmount` is the correct existing variable name for the tool's numeric amount at this point in the file (per research it's assigned before the `parameters` map is built — `grep -n "def transactionAmount" ping-gateway/scripts/groovy/p1az-decision.groovy`) before inserting.

- [ ] **Step 2: Extend the static parity checker**

```bash
echo ""
echo "== Tier local deny (Task 9) =="
for marker in tier_tool_not_allowed tier_amount_exceeded; do
  if grep -q "'$marker'" "$GROOVY"; then
    echo "  ok   $marker"
  else
    echo "  MISSING $marker"
    missing=$((missing + 1))
  fi
done
```

- [ ] **Step 3: Run the parity checker**

Run: `bash ping-gateway/scripts/check-groovy-params.sh`
Expected: `RESULT: PASS`.

- [ ] **Step 4: Live verification**

Run: `docker restart ai-demo-ping-gateway`. With the BFF changes from Task 5 live, call `create_withdrawal` (a `Standard`-tier-restricted tool per `groupPolicy.js`'s fallback definitions) as a Standard-tier demo user and confirm a local DENY (`tier_tool_not_allowed`) — check `docker logs ai-demo-ping-gateway` for the `[P1AZ] local backstop DENY` line. Then confirm the same call succeeds for a PrivateBanking-tier user.

- [ ] **Step 5: Commit**

```bash
git add ping-gateway/scripts/groovy/p1az-decision.groovy ping-gateway/scripts/check-groovy-params.sh
git commit -m "feat(ping-gateway): local tier (groupToTier) deny from BFF-forwarded headers"
```

---

## Self-Review

**Spec coverage** — the 5 originally-scoped gaps, mapped to tasks:
1. Temporal (iat/nbf) — Task 1 (Node), Task 7 (groovy). `exp`/`iss` already covered pre-existing.
2. Per-tool scope — Task 2+3 (Node), Task 6 (groovy).
3. RAR payee — already done on Node (no task needed); Task 8 (groovy, default-off, flagged conflict).
4. D-05 multi-aud — already done on Node (no task needed); Task 7 (groovy).
5. Tier (groupToTier) — Task 4 (Node) + Task 5 (BFF data plumbing) + Task 9 (groovy).

**Placeholder scan** — two steps (Task 3 Step 5, Task 4 Step 5/6) intentionally defer to "match the existing pattern in this file" rather than inventing an unverified return shape or header-read syntax; this is a deliberate call for the implementer to read 3-5 lines of adjacent, already-working code before writing 2 lines that must match its shape exactly — not a placeholder for logic. Every DENY condition, every header name, every function signature, and every test assertion elsewhere in this plan is concrete.

**Type/name consistency** — `evaluateScopeDecisionUnconditionally` (Task 3), `evaluateTierDecision`/`parseRestrictedTools` (Task 4), `allowedScopes`/`isA2aDelegatedTool`/`a2aDelegatedScope` (Task 2) are each defined once and referenced by the same name in every later task that uses them. `denyLocal` (Task 7) is defined once and reused by Tasks 8 and 9.
