# Per-Request JWKS Token Validation Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A demo-visible feature flag (`ff_mcp_gateway_jwks`) that switches PingGateway MCP token validation from remote PingOne introspection to local JWT validation (RS256 via PingOne JWKS, HS256 via the mock shared secret), per request, with no gateway restart.

**Architecture:** The BFF stamps an `X-Token-Validation: jwks|introspect` header on PingGateway-bound requests (mirroring the existing `X-Authz-Simulated` pattern). A new route file `00-mcp-olb-jwks.json` sorts ahead of the untouched `01-mcp-olb.json` and matches only when the header is `jwks`; its chain replaces the introspection resource-server stage with a Groovy validator script that verifies the JWT locally and populates `attributes['oauth2AccessToken']` — the fallback `p1az-decision.groovy` already reads — so the downstream authorize + token-exchange filters run unmodified.

**Tech Stack:** Node/Express BFF (jest), PingGateway (ForgeRock IG) route JSON + Groovy ScriptableFilter, docker compose.

**Spec:** `docs/superpowers/specs/2026-07-02-jwks-token-validation-flag-design.md`

## Global Constraints

- Flag id: `ff_mcp_gateway_jwks`, default `'false'`, env alias `FF_MCP_GATEWAY_JWKS`.
- Request header: `X-Token-Validation`, values exactly `jwks` or `introspect`; sent ONLY when `ff_mcp_gateway_pinggateway === 'true'`.
- Response header on the JWKS path: `X-Token-Validation-Mode: jwks`.
- New route file: `ping-gateway/config/routes/00-mcp-olb-jwks.json` (name `mcp-olb-jwks`). Existing route files stay byte-for-byte unchanged.
- Groovy script: `ping-gateway/scripts/groovy/jwks-token-validation.groovy`.
- New gateway env vars: `PINGONE_JWKS_URI` (default `${PINGONE_ISSUER_URI}/jwks`), `AUTHZ_JWT_SECRET` (HS256 mock secret, fail closed if unset), `AUTHZ_ISSUER_URI` (optional; HS256 `iss` checked only when set).
- Primary OLB route only; `/mcp/invest` keeps introspection (follow-up).
- All work on branch `worktree-jwks-validation-flag` in the worktree at `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jwks-validation-flag`. Stage files explicitly (`git add <file>`), never `git add -A`.
- Do NOT touch the running demo stack (containers `ping-gateway` / `ai-demo-ping-gateway`, ports 3006/3036). Verification uses a throwaway container `ping-gateway-jwks-test` on port 3037.

---

### Task 1: BFF flag + `X-Token-Validation` header (TDD)

**Files:**

- Test (create): `demo_api_server/tests/pinggatewayJwksHeader.test.js`
- Modify: `demo_api_server/routes/featureFlags.js` (insert after the `ff_mcp_gateway_pinggateway` registry entry, which starts at line 613 and ends `defaultValue: false,\n  },`)
- Modify: `demo_api_server/services/configStore.js:311-312` area (FIELD_DEFS), `:1044` area (env alias map), `:1915` area (FF_ENV_MAP)
- Modify: `demo_api_server/services/mcpGatewayClient.js:130-133`

**Interfaces:**

- Consumes: `configStore.getEffective(key) → string|undefined` (existing).
- Produces: config key `ff_mcp_gateway_jwks` resolvable via `getEffective`; outbound header `X-Token-Validation: 'jwks'|'introspect'` on PingGateway-bound requests. Tasks 2–4 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/pinggatewayJwksHeader.test.js` (mirrors the existing `tests/pinggatewayHeader.test.js` conventions):

```js
'use strict';

// Unit test for the X-Token-Validation header that callToolViaGateway stamps on
// PingGateway-bound requests. The BFF carries the effective ff_mcp_gateway_jwks
// value so the gateway selects the validation route per request: 'jwks' matches
// route 00-mcp-olb-jwks.json (local JWT validation), 'introspect' falls through
// to route 01-mcp-olb.json (RFC 7662 introspection, today's behavior). Added
// ONLY when ff_mcp_gateway_pinggateway is ON, so the Node-gateway request shape
// is unchanged.

const mockGetEffective = jest.fn();
jest.mock('../services/configStore', () => ({
  getEffective: (...args) => mockGetEffective(...args),
}));
jest.mock('../services/mcpActorBridge', () => ({
  buildActorBridgeHeaders: () => ({}),
}));
jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const { callToolViaGateway } = require('../services/mcpGatewayClient');

function stubConfig(map = {}) {
  mockGetEffective.mockImplementation((key) => {
    if (key in map) return map[key];
    if (key === 'ff_mcp_gateway_pinggateway') return 'false';
    return undefined;
  });
}

function okResponse() {
  return {
    status: 200,
    data: { jsonrpc: '2.0', id: '1', result: { ok: true } },
    headers: {},
  };
}

function lastHeaders() {
  const call = axios.post.mock.calls[axios.post.mock.calls.length - 1];
  return call[2].headers;
}

describe('callToolViaGateway X-Token-Validation header', () => {
  beforeEach(() => {
    mockGetEffective.mockReset();
    axios.post.mockReset();
    axios.post.mockResolvedValue(okResponse());
  });

  test('gateway flag ON + ff_mcp_gateway_jwks true -> X-Token-Validation: jwks', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true', ff_mcp_gateway_jwks: 'true' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-Token-Validation']).toBe('jwks');
  });

  test('gateway flag ON + ff_mcp_gateway_jwks false -> X-Token-Validation: introspect', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true', ff_mcp_gateway_jwks: 'false' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-Token-Validation']).toBe('introspect');
  });

  test('gateway flag ON + jwks flag unset -> X-Token-Validation: introspect (safe default)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-Token-Validation']).toBe('introspect');
  });

  test('gateway flag OFF -> no X-Token-Validation header (Node path unchanged)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'false', ff_mcp_gateway_jwks: 'true' });

    await callToolViaGateway('http://mcp-gateway:3005', 'tok', 'get_accounts', {});

    expect(lastHeaders()).not.toHaveProperty('X-Token-Validation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `demo_api_server/`): `npx jest tests/pinggatewayJwksHeader.test.js --forceExit`
Expected: FAIL — `expect(lastHeaders()['X-Token-Validation']).toBe('jwks')` receives `undefined`.

- [ ] **Step 3: Implement**

3a. `demo_api_server/services/mcpGatewayClient.js` — extend the existing block at lines 130–133:

```js
    if (configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true') {
        const simulated = configStore.getEffective('ff_authorize_simulated') === 'true';
        headers['X-Authz-Simulated'] = simulated ? 'true' : 'false';
        // Per-request token-validation mode for the gateway: 'jwks' selects route
        // 00-mcp-olb-jwks.json (local JWT validation, no introspection round-trip);
        // 'introspect' (default) falls through to route 01-mcp-olb.json unchanged.
        const jwksMode = configStore.getEffective('ff_mcp_gateway_jwks') === 'true';
        headers['X-Token-Validation'] = jwksMode ? 'jwks' : 'introspect';
    }
```

3b. `demo_api_server/routes/featureFlags.js` — insert this entry in `FLAG_REGISTRY` immediately after the `ff_mcp_gateway_pinggateway` entry's closing `},` (entry begins at line 613):

```js
  {
    id:           'ff_mcp_gateway_jwks',
    name:         'Local JWKS Token Validation (PingOne Agent Gateway)',
    category:     'MCP / Agent',
    description:
      'When **ON** and MCP traffic routes through the **PingOne Agent Gateway** (ff_mcp_gateway_pinggateway), ' +
      'the gateway validates inbound MCP access tokens **locally**: RS256 tokens against the PingOne **JWKS** ' +
      '(signature, exp/nbf, iss, aud, scope) and mock demo_authz_server HS256 tokens against the shared demo ' +
      'secret — no introspection round-trip to the authorization server. When **OFF** (default), the gateway ' +
      'uses **remote token introspection** (RFC 7662) as today. Carried per request via the ' +
      'X-Token-Validation header; switching requires no gateway restart.',
    impact:
      'OFF (default) = introspection: every request round-trips to the authorization server, so revoked tokens ' +
      'are caught immediately. ON = local JWKS validation: faster and works offline, but **cannot detect ' +
      'revoked tokens** until they expire — the educational tradeoff this toggle demonstrates.',
    type:         'boolean',
    defaultValue: false,
  },
```

3c. `demo_api_server/services/configStore.js` — three one-line additions following the `ff_mcp_gateway_pinggateway` pattern:

FIELD_DEFS (after line 311 `ff_mcp_gateway_pinggateway: ...`):

```js
  ff_mcp_gateway_jwks:             { public: true, default: 'false' }, // PingGateway validates MCP tokens locally (JWKS/HS256) instead of introspecting
```

Env alias map (after line 1044 `ff_mcp_gateway_pinggateway: ['FF_MCP_GATEWAY_PINGGATEWAY'],`):

```js
      ff_mcp_gateway_jwks:             ['FF_MCP_GATEWAY_JWKS'],
```

FF_ENV_MAP (after line 1915 `ff_mcp_gateway_pinggateway: 'FF_MCP_GATEWAY_PINGGATEWAY',`):

```js
    ff_mcp_gateway_jwks:        'FF_MCP_GATEWAY_JWKS',
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `demo_api_server/`): `npx jest tests/pinggatewayJwksHeader.test.js tests/pinggatewayHeader.test.js --forceExit`
Expected: both suites PASS (the pre-existing X-Authz-Simulated suite guards against regression in the shared block).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/tests/pinggatewayJwksHeader.test.js demo_api_server/routes/featureFlags.js demo_api_server/services/configStore.js demo_api_server/services/mcpGatewayClient.js
git commit -m "feat: ff_mcp_gateway_jwks flag + X-Token-Validation header on PingGateway requests"
```

---

### Task 2: Groovy local-validation script

**Files:**

- Create: `ping-gateway/scripts/groovy/jwks-token-validation.groovy`

**Interfaces:**

- Consumes: env vars from Global Constraints; IG script bindings `request`, `context`, `next`, `logger`, `globals`, `attributes` (same bindings `p1az-decision.groovy` uses).
- Produces: on success, `attributes['oauth2AccessToken']` = the JWT claims `Map` (exactly what `p1az-decision.groovy`'s fallback at its "falling back to attributes" branch reads: `sub`, `scope`, `act`, `may_act`, `aud`, `exp`, `iat`, `nbf`, `iss`), plus response header `X-Token-Validation-Mode: jwks`. On failure, HTTP 401 with body `{"error":"invalid_token","validation":"jwks","reason":"<check>"}`.
- No runnable test at this task (the script only executes inside the IG container); Task 4 is its test cycle. Reviewer gate: code review against this listing + the spec.

- [ ] **Step 1: Write the script**

Full content of `ping-gateway/scripts/groovy/jwks-token-validation.groovy` (idioms — `new Response(Status.X)`, `Promises.newResultPromise`, `HttpURLConnection`, `globals` cache — match `p1az-decision.groovy`):

```groovy
/*
 * Local (no-introspection) inbound token validation for the JWKS demo route
 * (00-mcp-olb-jwks.json). Selected per request when the BFF stamps
 * X-Token-Validation: jwks (effective ff_mcp_gateway_jwks). Replaces the
 * TokenIntrospectionAccessTokenResolver/OAuth2ResourceServerFilter stage of
 * route 01-mcp-olb.json.
 *
 * Branches on the JWT alg header:
 *   RS256 -> verify against the PingOne JWKS (PINGONE_JWKS_URI, cached ~5 min)
 *   HS256 -> verify against the mock demo_authz_server shared secret
 *            (AUTHZ_JWT_SECRET); fail closed when unset
 *   anything else (incl. none) -> 401
 *
 * Claim checks: exp/nbf (30s skew), aud must contain PG_GATEWAY_RESOURCE_URI or
 * PG_GATEWAY_RESOURCE_ID, scope must contain PG_INBOUND_SCOPE. iss: RS256
 * requires PINGONE_ISSUER_URI; HS256 checks AUTHZ_ISSUER_URI only when set
 * (secret possession is the mock trust anchor).
 *
 * On success the claims Map is stored in attributes['oauth2AccessToken'] — the
 * documented fallback p1az-decision.groovy reads when no OAuth2Context exists —
 * so the downstream authorize + token-exchange filters run unmodified.
 *
 * EDUCATIONAL TRADEOFF (by design): no round-trip to the authorization server,
 * so revocation is NOT detected until the token expires.
 */

import groovy.json.JsonSlurper
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.RSAPublicKeySpec

def issuerUri          = System.getenv('PINGONE_ISSUER_URI') ?: ''
def jwksUri            = System.getenv('PINGONE_JWKS_URI') ?: (issuerUri ? issuerUri + '/jwks' : '')
def mockSecret         = System.getenv('AUTHZ_JWT_SECRET') ?: ''
def mockIssuer         = System.getenv('AUTHZ_ISSUER_URI') ?: ''
def gatewayResourceUri = System.getenv('PG_GATEWAY_RESOURCE_URI') ?: ''
def gatewayResourceId  = System.getenv('PG_GATEWAY_RESOURCE_ID') ?: ''
def requiredScope      = System.getenv('PG_INBOUND_SCOPE') ?: 'mcp:invoke'

def deny = { String reason ->
    logger.info('[JWKS] validation FAILED: ' + reason)
    def resp = new Response(Status.UNAUTHORIZED)
    resp.headers.put('Content-Type', 'application/json')
    resp.headers.put('WWW-Authenticate',
        'Bearer realm="mcp", error="invalid_token", error_description="' + reason + '"')
    resp.entity = '{"error":"invalid_token","validation":"jwks","reason":"' + reason + '"}'
    return Promises.newResultPromise(resp)
}

def b64url = { String s -> java.util.Base64.getUrlDecoder().decode(s) }

// ── 1. Extract and split the bearer JWT ───────────────────────────────────────
def authz = request.headers.getFirst('Authorization') ?: ''
if (!authz.toLowerCase().startsWith('bearer ')) return deny('missing_bearer')
def token = authz.substring(7).trim()
def parts = token.split('\\.')
if (parts.length != 3) return deny('malformed_jwt')

def slurper = new JsonSlurper()
def jwtHeader, claims
try {
    jwtHeader = slurper.parse(b64url(parts[0]))
    claims    = slurper.parse(b64url(parts[1]))
} catch (Exception e) {
    return deny('undecodable_jwt')
}
def signedBytes = (parts[0] + '.' + parts[1]).getBytes('US-ASCII')
byte[] sigBytes
try {
    sigBytes = b64url(parts[2])
} catch (Exception e) {
    return deny('undecodable_signature')
}
def alg = (jwtHeader['alg'] ?: '') as String

// ── 2. Signature verification, branched on alg ────────────────────────────────
// JWKS fetch with ~5-minute cache in script globals (survives across requests).
def fetchJwks = { boolean forceRefresh ->
    long nowMs = System.currentTimeMillis()
    def cache = globals._jwksCache
    if (!forceRefresh && cache?.keys && nowMs < (cache.expiresAt as long)) {
        return cache.keys
    }
    def conn = new URL(jwksUri).openConnection() as java.net.HttpURLConnection
    conn.connectTimeout = 5000
    conn.readTimeout    = 5000
    def keys = new JsonSlurper().parse(conn.inputStream)['keys'] ?: []
    globals._jwksCache = [keys: keys, expiresAt: nowMs + 300_000L]
    logger.info('[JWKS] fetched ' + keys.size() + ' key(s) from ' + jwksUri)
    return keys
}
def rsaKeyFor = { Map jwk ->
    def n = new BigInteger(1, b64url(jwk['n'] as String))
    def e = new BigInteger(1, b64url(jwk['e'] as String))
    KeyFactory.getInstance('RSA').generatePublic(new RSAPublicKeySpec(n, e))
}
def findJwk = { List keys, String kid ->
    def rsaKeys = keys.findAll { it['kty'] == 'RSA' && (it['use'] == 'sig' || !it['use']) }
    kid ? rsaKeys.find { it['kid'] == kid } : (rsaKeys.size() == 1 ? rsaKeys[0] : null)
}

if (alg == 'RS256') {
    if (!jwksUri) return deny('jwks_uri_not_configured')
    def kid = jwtHeader['kid'] as String
    def jwk
    try {
        jwk = findJwk(fetchJwks(false), kid)
        if (jwk == null) {
            // Key rotation: refetch once on kid miss before rejecting.
            jwk = findJwk(fetchJwks(true), kid)
        }
    } catch (Exception e) {
        logger.warn('[JWKS] JWKS fetch failed: ' + e.message)
        return deny('jwks_fetch_failed')
    }
    if (jwk == null) return deny('no_matching_jwk')
    def sig = Signature.getInstance('SHA256withRSA')
    sig.initVerify(rsaKeyFor(jwk))
    sig.update(signedBytes)
    if (!sig.verify(sigBytes)) return deny('bad_signature')
} else if (alg == 'HS256') {
    if (!mockSecret) return deny('hs256_secret_not_configured')
    def mac = Mac.getInstance('HmacSHA256')
    mac.init(new SecretKeySpec(mockSecret.getBytes('UTF-8'), 'HmacSHA256'))
    def expected = mac.doFinal(signedBytes)
    if (!MessageDigest.isEqual(expected, sigBytes)) return deny('bad_signature')
} else {
    return deny('unsupported_alg')
}

// ── 3. Claim checks ────────────────────────────────────────────────────────────
long now = System.currentTimeMillis().intdiv(1000L)  // NOT `/` — Groovy `/` on longs yields BigDecimal
long skew = 30L
def expClaim = claims['exp']
if (!(expClaim instanceof Number)) return deny('missing_exp')
if (now > (expClaim as long) + skew) return deny('token_expired')
def nbfClaim = claims['nbf']
if (nbfClaim instanceof Number && now < (nbfClaim as long) - skew) return deny('token_not_yet_valid')

def iss = (claims['iss'] ?: '') as String
if (alg == 'RS256') {
    if (!issuerUri || iss != issuerUri) return deny('issuer_mismatch')
} else if (mockIssuer) {
    if (iss != mockIssuer) return deny('issuer_mismatch')
}

def rawAud = claims['aud']
def audList = rawAud instanceof List ? rawAud.collect { it as String } : (rawAud ? [rawAud as String] : [])
def audOk = audList.any { it == gatewayResourceUri || it == gatewayResourceId }
if (!audOk) return deny('audience_mismatch')

def scopes = ((claims['scope'] ?: '') as String).tokenize(' ')
if (!scopes.contains(requiredScope)) return deny('insufficient_scope')

// ── 4. Success: expose claims to downstream filters, stamp the demo header ────
attributes['oauth2AccessToken'] = claims
logger.info('[JWKS] validation ok: alg=' + alg + ' sub=' + (claims['sub'] ?: '') +
    ' aud=' + audList.join(',') + ' (local validation — no introspection call)')

return next.handle(context, request).thenOnResult { rsp ->
    rsp.headers.add('X-Token-Validation-Mode', 'jwks')
}
```

- [ ] **Step 2: Sanity-check the Groovy parses**

If a local `groovy` CLI exists (`command -v groovy`), run: `groovy -e "new GroovyShell().parse(new File('ping-gateway/scripts/groovy/jwks-token-validation.groovy'))"` — expect it to fail ONLY on unresolvable `org.forgerock.*` imports (those exist solely inside IG), and report no other syntax errors. If no groovy CLI is installed, skip — Task 4's container boot is the parse check (IG refuses to load a route whose script doesn't compile).

- [ ] **Step 3: Commit**

```bash
git add ping-gateway/scripts/groovy/jwks-token-validation.groovy
git commit -m "feat: Groovy local JWKS/HS256 token validation script for PingGateway"
```

---

### Task 3: JWKS route file + env plumbing + docs

**Files:**

- Create: `ping-gateway/config/routes/00-mcp-olb-jwks.json`
- Modify: `ping-gateway/.env.example` (append new section after the "Inbound token validation" section that ends at line 19)
- Modify: `ping-gateway/README.md` (add a short "Local JWKS validation route" subsection wherever the existing route table/description lives)

**Interfaces:**

- Consumes: `jwks-token-validation.groovy` from Task 2 (referenced by file name); the `X-Token-Validation` header from Task 1; existing scripts `p1az-decision.groovy` / `olb-token-exchange.groovy` unchanged.
- Produces: route `mcp-olb-jwks` matched before `mcp-olb-primary` iff header == `jwks`. IG evaluates route files in lexicographic file-name order, so `00-` wins; absent/other header values fall through to `01-mcp-olb.json` untouched.

- [ ] **Step 1: Write the route file**

Full content of `ping-gateway/config/routes/00-mcp-olb-jwks.json`. It is route `01-mcp-olb.json` with (a) a header-guarded condition, (b) the introspection heap objects (`IntrospectionProviderHandler`, `RsFilterTokenResolver`, `OlbResourceServerFilter`) and the `McpGatewayProtection` filter removed, and (c) the Groovy validator as the first chain filter (it performs the audience check `McpProtectionFilter` did). `TokenExchangeEndpointHandler`/`TokenExchangeFailureHandler` heap entries are kept identical to route 01 (copied verbatim below) since `olb-token-exchange.groovy` runs in this chain too:

```json
{
  "name": "mcp-olb-jwks",
  "condition": "${find(request.uri.path, '^/mcp(?!/invest)') and not empty request.headers['X-Token-Validation'] and request.headers['X-Token-Validation'][0] == 'jwks'}",
  "heap": [
    {
      "name": "SecretsStore",
      "type": "SystemAndEnvSecretStore",
      "config": {
        "format": "PLAIN"
      }
    },
    {
      "name": "TokenExchangeEndpointHandler",
      "type": "Chain",
      "config": {
        "filters": [
          {
            "name": "TokenExchangeClientAuth",
            "type": "ScriptableFilter",
            "config": {
              "type": "application/x-groovy",
              "source": "import java.net.URLEncoder\ndef body = request.entity.string ?: ''\ndef cid = System.getenv('TE_CLIENT_ID') ?: ''\ndef cs  = System.getenv('TE_CLIENT_SECRET') ?: ''\nlogger.info('[TEClientAuth] body_len=' + body.length() + ' cid_len=' + cid.length())\nif (cid) { def newBody = body + '&client_id=' + URLEncoder.encode(cid, 'UTF-8') + '&client_secret=' + URLEncoder.encode(cs, 'UTF-8'); logger.info('[TEClientAuth] newBody_len=' + newBody.length()); request.entity.setString(newBody) }\nreturn next.handle(context, request)"
            }
          }
        ],
        "handler": {
          "type": "ClientHandler"
        }
      }
    },
    {
      "name": "TokenExchangeFailureHandler",
      "type": "StaticResponseHandler",
      "config": {
        "status": 401,
        "headers": {
          "Content-Type": [
            "application/json"
          ]
        },
        "entity": "{\"error\":\"token_exchange_failed\"}"
      }
    }
  ],
  "handler": {
    "type": "Chain",
    "config": {
      "filters": [
        {
          "name": "JwksTokenValidation",
          "type": "ScriptableFilter",
          "config": {
            "type": "application/x-groovy",
            "file": "jwks-token-validation.groovy"
          }
        },
        {
          "name": "McpProtocol",
          "type": "McpValidationFilter",
          "config": {
            "acceptedOrigins": ".*"
          }
        },
        {
          "name": "P1AZDecision",
          "type": "ScriptableFilter",
          "config": {
            "type": "application/x-groovy",
            "file": "p1az-decision.groovy"
          }
        },
        {
          "name": "GatewayToOlbTokenExchange",
          "type": "ScriptableFilter",
          "config": {
            "type": "application/x-groovy",
            "file": "olb-token-exchange.groovy"
          }
        }
      ],
      "handler": {
        "type": "ReverseProxyHandler",
        "config": {
          "baseURI": "${env['PG_OLB_BACKEND_URL']}"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Append the env section to `.env.example`**

Append after the "Inbound token validation" section (after line 19, before the "Inbound gateway resource identity" section):

```bash
# --- Local JWKS validation (ff_mcp_gateway_jwks / X-Token-Validation: jwks) ---
# Route 00-mcp-olb-jwks.json validates the inbound JWT locally instead of
# introspecting. RS256 tokens verify against this JWKS endpoint (default when
# unset: ${PINGONE_ISSUER_URI}/jwks). Educational tradeoff: local validation
# cannot detect revoked tokens until they expire.
PINGONE_JWKS_URI=https://auth.pingone.com/d02d2305-f445-406d-82ee-7cdbf6eeabfd/as/jwks
# Mock demo_authz_server HS256 tokens (ff_authorize_simulated=true) verify with
# this shared secret — SAME value the authz-server signs with. Unset = HS256
# tokens fail closed (401) on the JWKS route.
AUTHZ_JWT_SECRET=<authz-jwt-secret>
# Optional expected issuer for mock HS256 tokens; unset = iss not checked on the
# HS256 branch (possession of the shared secret is the trust anchor).
AUTHZ_ISSUER_URI=
```

- [ ] **Step 3: Add the README subsection**

In `ping-gateway/README.md`, next to the existing route descriptions, add:

```markdown
### Local JWKS validation route (`00-mcp-olb-jwks.json`)

When the BFF flag `ff_mcp_gateway_jwks` is ON it stamps `X-Token-Validation: jwks`
on each request; this route (file name sorts before `01-mcp-olb.json`, so it is
matched first) then validates the inbound token **locally** in
`jwks-token-validation.groovy` — RS256 via `PINGONE_JWKS_URI`, mock HS256 via
`AUTHZ_JWT_SECRET` — with `exp`/`nbf`, `iss`, `aud`, and scope checks, instead of
introspecting. Success stamps `X-Token-Validation-Mode: jwks` on the response;
failure returns 401 `{"error":"invalid_token","validation":"jwks","reason":...}`.
Any other header value (or none) falls through to the unchanged introspection
route. Tradeoff (educational, by design): no revocation detection until expiry.
```

- [ ] **Step 4: Validate the route JSON parses**

Run: `python3 -c "import json; json.load(open('ping-gateway/config/routes/00-mcp-olb-jwks.json')); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add ping-gateway/config/routes/00-mcp-olb-jwks.json ping-gateway/.env.example ping-gateway/README.md
git commit -m "feat: header-selected JWKS validation route for PingGateway MCP path"
```

---

### Task 4: Live verification harness (throwaway gateway container + curl matrix)

**Files:**

- Create (scratchpad, NOT committed): `/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/mint-tokens.js`, `/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/compose.override.yml`, `/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/jwks.json` (generated)
- Create (committed): `test-results/2026-07-02-jwks-validation-results.md`

**Interfaces:**

- Consumes: Tasks 2–3 artifacts; Docker; node; python3.
- Produces: evidence that every row of the validation matrix behaves per spec; the results markdown.

**Scope note:** this harness proves the *validation layer* (the deliverable of this plan) with self-minted tokens against a fake JWKS — it asserts 401-vs-pass at the validator. Full 200 end-to-end on the live demo stack (real PingOne tokens, P1AZ, backend exchange) happens after merge, since the running Docker stack serves the main checkout.

- [ ] **Step 1: Write the token minter**

`/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/mint-tokens.js` (plain node crypto, no deps). It writes `jwks.json` plus one file per token into the same directory:

```js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ISS = 'https://auth.pingone.com/test/as';
const AUD = 'mcpgateway.ping.demo';
const SCOPE = 'openid banking:mcp:invoke';
const HS_SECRET = 'jwks-test-secret';
const now = Math.floor(Date.now() / 1000);

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const enc = (obj) => b64u(JSON.stringify(obj));

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
fs.writeFileSync(path.join(DIR, 'jwks.json'),
  JSON.stringify({ keys: [{ ...jwk, kid: 'test-1', use: 'sig', alg: 'RS256' }] }));

function rs256(claims) {
  const h = enc({ alg: 'RS256', typ: 'JWT', kid: 'test-1' });
  const p = enc(claims);
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), privateKey);
  return `${h}.${p}.${b64u(sig)}`;
}
function hs256(claims) {
  const h = enc({ alg: 'HS256', typ: 'JWT' });
  const p = enc(claims);
  const sig = crypto.createHmac('sha256', HS_SECRET).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64u(sig)}`;
}

const base = { iss: ISS, sub: 'user-jwks-test', aud: AUD, scope: SCOPE, iat: now, nbf: now, exp: now + 600 };
const tokens = {
  'rs256-valid':     rs256(base),
  'rs256-expired':   rs256({ ...base, exp: now - 3600, iat: now - 7200, nbf: now - 7200 }),
  'rs256-wrong-aud': rs256({ ...base, aud: 'some-other-api' }),
  'rs256-no-scope':  rs256({ ...base, scope: 'openid' }),
  'rs256-bad-iss':   rs256({ ...base, iss: 'https://evil.example/as' }),
  'hs256-valid':     hs256(base),
  'alg-none':        `${enc({ alg: 'none', typ: 'JWT' })}.${enc(base)}.`,
};
// Tampered: valid RS256 token with one payload character flipped (signature no longer matches).
const t = tokens['rs256-valid'].split('.');
t[1] = t[1].slice(0, -2) + (t[1].slice(-2, -1) === 'A' ? 'B' : 'A') + t[1].slice(-1);
tokens['rs256-tampered'] = t.join('.');

for (const [name, tok] of Object.entries(tokens)) fs.writeFileSync(path.join(DIR, `${name}.jwt`), tok);
console.log('minted:', Object.keys(tokens).join(', '));
```

Run: `node /private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/mint-tokens.js` — expected: `minted: rs256-valid, ...`

- [ ] **Step 2: Write the compose override and boot the throwaway gateway**

`/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/compose.override.yml` (requires docker compose ≥ 2.24 for `!override`):

```yaml
services:
  ping-gateway:
    container_name: ping-gateway-jwks-test
    ports: !override
      - "3037:8080"
    restart: "no"
    environment:
      PINGONE_ISSUER_URI: https://auth.pingone.com/test/as
      PINGONE_JWKS_URI: http://host.docker.internal:9777/jwks.json
      AUTHZ_JWT_SECRET: jwks-test-secret
      AUTHZ_ISSUER_URI: ""
      PG_GATEWAY_RESOURCE_URI: mcpgateway.ping.demo
      PG_GATEWAY_RESOURCE_ID: https://api.ping.demo:3006/mcp
      PG_INBOUND_SCOPE: banking:mcp:invoke
```

Boot (from the worktree's `ping-gateway/` directory; the compose file requires a `.env` — synthesize one from the example if the real one isn't present):

```bash
cd ping-gateway
[ -f .env ] || { cp /Users/cmuir/Development/AI-DEMO2/ping-gateway/.env .env 2>/dev/null || sed 's/<[^>]*>/placeholder/g' .env.example > .env; }
( cd /private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify && python3 -m http.server 9777 & echo $! > /private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/http.pid )
docker compose -p jwks-test -f docker-compose.yml -f /private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/compose.override.yml up -d
sleep 20 && docker logs ping-gateway-jwks-test 2>&1 | tail -20
```

Expected: IG starts and the logs show routes `mcp-olb-jwks`, `mcp-olb-primary`, `mcp-resource-server`, `oauth-passthrough` loaded with no route-load errors. A Groovy compile error in the script appears here as a route failure — fix before proceeding.

- [ ] **Step 3: Run the curl matrix**

Helper (body is a minimal MCP JSON-RPC call so requests that pass validation proceed into the chain):

```bash
call() { # $1=token-file  $2=header-value
  curl -s -o /tmp/jwks-body.$$ -w '%{http_code}' -X POST http://localhost:3037/mcp \
    -H "Authorization: Bearer $(cat /private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/$1.jwt)" \
    -H "X-Token-Validation: $2" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'; echo " $(cat /tmp/jwks-body.$$)"; }
```

| # | Command | Expected |
| --- | --- | --- |
| 1 | `call rs256-valid jwks` | NOT a `"validation":"jwks"` 401; gateway log contains `[JWKS] validation ok: alg=RS256`; response has `X-Token-Validation-Mode: jwks` (check with `curl -si`) |
| 2 | `call rs256-tampered jwks` | `401` body reason `bad_signature` |
| 3 | `call rs256-expired jwks` | `401` reason `token_expired` |
| 4 | `call rs256-wrong-aud jwks` | `401` reason `audience_mismatch` |
| 5 | `call rs256-no-scope jwks` | `401` reason `insufficient_scope` |
| 6 | `call rs256-bad-iss jwks` | `401` reason `issuer_mismatch` |
| 7 | `call hs256-valid jwks` | log contains `[JWKS] validation ok: alg=HS256`; not a `"validation":"jwks"` 401 |
| 8 | `call alg-none jwks` | `401` reason `unsupported_alg` |
| 9 | `call rs256-valid introspect` | Response does NOT contain `"validation":"jwks"` (introspection route 01 handled it — proves fall-through) |
| 10 | `curl -s http://localhost:3037/mcp -X POST -d '{}' -H 'Content-Type: application/json'` (no auth, no header) | Handled by route 01, not the JWKS route (no `"validation":"jwks"` in body) |

Check logs after each pass/fail case: `docker logs ping-gateway-jwks-test 2>&1 | grep '\[JWKS\]' | tail -30`. Also confirm case 1 triggers exactly ONE `[JWKS] fetched ... key(s)` line across repeated calls (cache works): run `call rs256-valid jwks` three times, expect one fetch line.

- [ ] **Step 4: Tear down**

```bash
docker compose -p jwks-test -f docker-compose.yml -f /private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/compose.override.yml down
kill "$(cat /private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/e2ea3b04-a2ed-4c26-b4a8-6abcd1eaf4a5/scratchpad/jwks-verify/http.pid)"
docker ps --format '{{.Names}}' | grep -c '^ping-gateway$' # expect the REAL stack untouched
```

- [ ] **Step 5: Record results and commit**

Write `test-results/2026-07-02-jwks-validation-results.md` with: the matrix table above plus actual status codes/bodies/log lines observed, the jest output from Task 1, and the explicit note that full-stack 200 E2E awaits merge to the live (main-checkout-served) stack.

```bash
git add test-results/2026-07-02-jwks-validation-results.md
git commit -m "test: JWKS validation route verification matrix results"
```
