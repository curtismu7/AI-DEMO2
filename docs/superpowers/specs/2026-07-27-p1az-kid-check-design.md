# P1AZ signing-key (`kid`) check — design

**Date:** 2026-07-27
**Status:** approved design, not yet implemented
**Branch:** `worktree-p1az-kid-check`

## Goal

Send the presented MCP token's JWT header `kid`, and a BFF-resolved "is this
`kid` actually in the issuer's live JWKS" boolean, to the authorization engines
as an **additional** input, so a policy rule can DENY a token signed by a key
that PingOne does not publish.

This is additive. Local JWT decode stays exactly as it is — this design does not
introduce signature verification anywhere, and does not change any existing
check.

### What this is not

Checking `kid` is **not** signature verification. `kid` is an attacker-controlled
header field; on its own it proves nothing about a token's authenticity. What
this check buys is narrower and worth stating precisely: it detects a token
whose header names a signing key the issuer does not publish. It raises the cost
of a forged or stale-key token; it does not make one impossible. Any claim that
this check "validates the JWKS" would be false.

## Decisions taken

| Fork | Decision |
|---|---|
| What the check asserts | BFF pre-resolves JWKS membership; P1AZ policy decides |
| Scope | BFF `McpFirstTool` gate only — not the Node gateway, not the IG groovy path |
| JWKS fetch failure | Omit `TokenKidKnown` — fail open on this check |
| Simulated engine | Mirror the rule, so the check works in both modes |

### Accepted tradeoffs

- **C1 gate divergence.** `demo_mcp_gateway`'s `McpToolCall` evaluation of the
  same call will not send these attributes. The BFF and gateway gates therefore
  see different inputs for the `kid` attribute specifically. This is the same
  class of divergence that caused bug F3. Accepted deliberately to keep the diff
  small; recorded here so it is a known gap and not a silent one. Closing it
  later means adding the same two attributes in `demo_mcp_gateway/src/tokenValidator.ts`.
- **Fail-open on JWKS outage.** A PingOne JWKS outage silently disables this
  check. Justification: the check is additive, so failing open on it returns
  behaviour to exactly today's baseline, where every other C1 check still
  enforces — it does not open a hole that is closed today. A warning is logged so
  the degradation is observable rather than invisible.

## Why the BFF pre-resolves, rather than P1AZ checking

The P1AZ snapshot DSL cannot fetch a JWKS, and has no array-contains operator.
This is the same constraint that already forces `InRequiredGroup` and `UserTier`
to be pre-resolved scalars rather than P1AZ evaluating a list. `TokenKidKnown`
follows that established precedent.

## Correction — `getPublicKey` cannot perform this check

`jwksService.getPublicKey(kid)` deliberately falls back to the first signature
key when `kid` is absent from the keyset (`services/jwksService.js:99-103`):

```js
  // Fall back to first signature key
  for (const entry of (keys.values())) {
    if (entry.use === 'sig') return entry;
  }
```

So `!!(await getPublicKey(kid))` returns `true` for **any** `kid` whenever the
JWKS is reachable. Building the check on it would produce a check that always
passes — a false green. Existing verify-path callers depend on that fallback, so
`getPublicKey` must not be modified.

The correct primitive is the keyset Map itself: `getKeys()` returns
`Map<kid, {...}>`, so `.has(kid)` is an exact membership test.

## Component 1 — `jwksService.hasKid(kid)`

New export in `demo_api_server/services/jwksService.js`, alongside
`getPublicKey` (which is left untouched).

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

The rotation refresh is load-bearing, not defensive padding: `getKeys()` returns
a stale cache on network failure (`jwksService.js:74`), so a bare `.has()` would
report `false` — i.e. "forged" — for a key that PingOne rotated to legitimately.

Steady state costs nothing: the refresh only fires on an actual cache miss, and
`getKeys()` is served from memory within `CACHE_MAX_AGE_MS`.

## Component 2 — BFF gate wiring

`demo_api_server/services/mcpToolAuthorizationService.js`, inside
`evaluateMcpFirstToolGate` (already `async`, line 474), beside the existing C1
token reads at lines 550-553:

```js
// Signing-key identity (additional check). kid comes off the token HEADER,
// which decodeJwt already returns (utils/tokenUtils.js:25) and every caller
// so far discarded. tokenKidKnown is BFF-pre-resolved because the P1AZ
// snapshot DSL can neither fetch a JWKS nor do array-contains — the same
// reason InRequiredGroup and UserTier are pre-resolved. null → key OMITTED
// (C1 rule 3: omission means "unknown", never "verified absent").
const tokenKid = decoded?.header?.kid ? String(decoded.header.kid) : null;
const tokenKidKnown = await jwksService.hasKid(tokenKid);
```

Requires adding a `jwksService` require to this module.

Both values are then passed to whichever engine runs (line 510 picks between
them), so live and simulated see identical inputs.

## Component 3 — live P1AZ parameters

`demo_api_server/services/pingOneAuthorizeService.js`, `evaluateMcpToolDelegation`:
two new named params (`tokenKid = null`, `tokenKidKnown = null`) and two
conditional spreads beside `TokenIss` (line 606):

```js
...(tokenKid ? { TokenKid: tokenKid } : {}),
...(tokenKidKnown != null ? { TokenKidKnown: tokenKidKnown } : {}),
```

Also add `mcp-invalid-kid` to `KNOWN_STATEMENT_CODES` (line 1231), or F8 will
warn "unrecognised statement code" on every real decision that carries it.

## Component 4 — simulated engine parity

`demo_api_server/services/simulatedAuthorizeService.js`, `evaluateMcpFirstTool`:
two new named params, both surfaced in the `parameters` object (line 222) so the
simulated decision record shows the same inputs as a live one, plus a guard.

**Placement:** immediately after the missing-user-id guard and *before* the
audience guard. Both are token-integrity checks, but an unpublished signing key
is the more fundamental failure — it means the token is not ours at all, whereas
an audience mismatch means a real token was presented to the wrong place. When
both would fire, the signing-key reason is the more accurate one to surface.

```js
// ── Signing-key guard (parity with the P1AZ "MCP Deny — Invalid Kid" rule).
// tokenKidKnown is resolved by the caller against the live JWKS; false means
// the token header names a signing key PingOne does not publish. null (JWKS
// unavailable, or no kid in the header) skips the guard — parity with the
// live path, where the attribute is omitted and the rule cannot fire.
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

`tokenKid` is included in the reason string, so it must be a param of this
function too, not only `tokenKidKnown`.

## Component 5 — live policy authoring (out of code scope)

The BFF sending `TokenKidKnown` changes nothing on its own — P1AZ ignores
parameters no rule reads. Enforcement on the live path requires a rule authored
in the PingOne Authorize console:

```
DENY if TokenKidKnown == false   →  statement code: mcp-invalid-kid
```

Per prior experience in this repo, rules that exist only in the snapshot file
were never live cloud-side, and re-importing did not fix that. So the honest
phasing is:

- **Code lands:** attribute is provably sent; simulated mode enforces immediately.
- **Live enforcement:** arrives only when the console rule exists.

Until then the live path is inert for this check. That is expected, not a bug,
and the tests below assert what is actually true at each stage.

## Testing

### Unit — `hasKid`

- known `kid` → `true`
- unknown `kid`, refresh finds it (rotation) → `true`
- unknown `kid`, refresh does not find it → `false`
- JWKS unavailable (`getKeys()` → `null`) → `null`
- no `kid` passed → `null`

### Revert-to-RED (required)

Replace `hasKid` with `getPublicKey` in the gate and confirm the unknown-`kid`
case flips from `false` to `true`. A fix for the false-green trap documented
above is unproven until the old behaviour has been restored and observed
failing. Without this step the `hasKid` tests could pass against an
implementation that never actually distinguishes.

### Gate — live path

- token with unpublished `kid` → `TokenKidKnown: false` present in the P1AZ
  request body
- token with published `kid` → `TokenKidKnown: true`
- JWKS unavailable → key **absent** from the body, every other C1 parameter
  unchanged
- no `kid` in header → both keys absent

Extend the existing `C1 canonical parameter set` block in
`src/__tests__/mcpDelegationParity.test.js`.

### Gate — simulated path

- `tokenKidKnown === false` → `DENY` with `deny_reason: 'invalid_kid'`
- `tokenKidKnown === null` → guard skipped, decision unchanged from today
- `tokenKidKnown === true` → decision unchanged from today

## Success criteria

- ✅ `hasKid` returns `false` for an unpublished kid, and the revert-to-RED step
  has been run and observed failing
- ✅ Live path emits both attributes; JWKS outage omits `TokenKidKnown` and
  leaves all other parameters intact
- ✅ Simulated path denies on `false`, is inert on `null`
- ✅ `CI=true npm test -- --forceExit` green, output pasted as evidence
- ✅ No existing check altered; `getPublicKey` untouched
- ✅ Staged explicitly on `worktree-p1az-kid-check`

## Files touched

| File | Change |
|---|---|
| `demo_api_server/services/jwksService.js` | add `hasKid`, export it |
| `demo_api_server/services/mcpToolAuthorizationService.js` | read `kid`, resolve, pass to both engines |
| `demo_api_server/services/pingOneAuthorizeService.js` | 2 params, 2 spreads, 1 statement code |
| `demo_api_server/services/simulatedAuthorizeService.js` | 2 params, parameters entry, 1 guard |
| tests | `hasKid` unit spec + parity spec extension |

Not touched: `demo_mcp_gateway/src/tokenValidator.ts`,
`ping-gateway/scripts/groovy/p1az-decision.groovy`, `getPublicKey`, and every
existing gate check.
