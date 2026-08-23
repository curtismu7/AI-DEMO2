# Native ID-JAG and Centralized MCP Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mint a real signed ID-JAG at the BFF, redeem it at `oauth-mcp` via the `jwt-bearer` grant so that token carries the MCP tool call, and add UC39 demonstrating that removing a user from a PingOne group revokes their MCP access.

**Architecture:** The BFF gains a demo "enterprise IdP" surface (`/api/enterprise-idp/jwks` + `/token`) that evaluates the existing group policy and, on PERMIT, signs a spec-shaped ID-JAG with a new RS256 key. `oauth-mcp` — which is already the MCP Authorization Server and whose tokens `TokenIntrospector` already accepts — gains a `jwt-bearer` grant handler that verifies the assertion against the BFF's remote JWKS and issues its own access token. Native mode auto-engages only when `ENTERPRISE_IDP_ISSUER` and `ENTERPRISE_IDP_JWKS_URL` are configured; both are unset by default, so the existing RFC 8693 stand-in path is untouched.

**Tech Stack:** Node >= 22. `oauth-mcp`: TypeScript, `jose` ^6.2.3, jest + ts-jest. `demo_api_server` (BFF): CommonJS, Express, `jsonwebtoken`, jest + supertest. `demo_api_ui`: React 19.2, **vitest** (not jest). `langchain_agent`: Python, pytest.

**Spec:** [`docs/superpowers/specs/2026-08-22-enterprise-managed-mcp-authorization-design.md`](../specs/2026-08-22-enterprise-managed-mcp-authorization-design.md)

## Global Constraints

- **Flag OFF, and flag ON with native unconfigured, must be byte-identical to today.** This is the primary regression surface: every existing demo runs the second of those. Task 6 carries an explicit test for it.
- **Native mode activates only when BOTH `enterprise_idp_issuer` AND `enterprise_idp_jwks_url` are non-empty.** Both default to `''`.
- **Emoji allowlist (REGRESSION_PLAN §0), hard rule:** only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. Everything else is plain text, CSS, or semantic HTML.
- **Never weaken assertion verification.** `alg: none` must always be rejected (Task 3, Step 7). `demo_api_server/utils/demoJwt.js` mints unsigned tokens and must never feed a real token endpoint.
- **Worktree discipline (CLAUDE.md):** work in an isolated worktree, stage explicitly with `git add <files>`, never `git add -A`. A BFF jest run regenerates ~443 artifact files.
- **Do not modify** `demo_api_server/routes/xaaIdJagDemo.js`, `demo_api_server/utils/demoJwt.js`, or any gateway token validation.
- **ID-JAG lifetime is 120 seconds.** MCP access token lifetime stays at the existing 3600.
- **Exact URNs** (copy verbatim, these are typo-prone):
  - `urn:ietf:params:oauth:grant-type:token-exchange`
  - `urn:ietf:params:oauth:token-type:id-jag`
  - `urn:ietf:params:oauth:token-type:id_token`
  - `urn:ietf:params:oauth:grant-type:jwt-bearer`
  - `urn:ietf:params:oauth:grant-profile:id-jag`
  - Extension id: `io.modelcontextprotocol/enterprise-managed-authorization`
  - ID-JAG JWT header `typ`: `oauth-id-jag+jwt`

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `demo_api_server/services/enterpriseIdpKey.js` | RS256 key singleton for the demo IdP. Nothing else. |
| `demo_api_server/routes/enterpriseIdp.js` | The demo IdP HTTP surface: `/jwks`, `/token`. Policy gate lives here. |
| `demo_api_server/services/idJagService.js` | Client half: request an ID-JAG, redeem it at the MCP AS. |
| `oauth-mcp/src/oauth/IdJagGrantHandler.ts` | Verify an ID-JAG and issue an access token. Verification only — no HTTP. |

**Modified**

| File | Change |
|---|---|
| `oauth-mcp/src/oauth/OAuthRouter.ts` | `jwt-bearer` grant case; metadata additions |
| `demo_api_server/services/configStore.js` | 4 new keys |
| `demo_api_server/server.js` | Mount `/api/enterprise-idp` |
| `demo_api_server/services/agentMcpTokenService.js` | Native-mode branch |
| `demo_api_server/services/enterpriseMcpPolicyService.js` | Configurable cache TTL |
| `demo_api_ui/src/components/TokenChainDisplay.jsx` | Render new steps |
| `demo_api_ui/src/services/traceGraph.js` | Render new steps |
| `langchain_agent/src/mcp/connection.py` | `_meta` extension declaration |
| `demo_api_server/config/useCases.js` | UC39 |
| `demo_api_server/config/auth-requirements.json` | UC39 |
| `demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js` | Correct the "blocked" claim |

---

## Task 1: Enterprise IdP signing key

**Files:**
- Create: `demo_api_server/services/enterpriseIdpKey.js`
- Test: `demo_api_server/src/__tests__/enterpriseIdpKey.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `getPrivateKeyPem(): string` — PKCS#8 PEM
  - `getPublicJwk(): { kty, n, e, kid, use: 'sig', alg: 'RS256' }`
  - `getKid(): string`
  - `resetForTests(): void`

This mirrors `oauth-mcp/src/oauth/SigningKeyManager.ts`. It deliberately does **not** reuse the `private_key_jwt` key in `clientAssertionService.js`: that key is the BFF's identity as an OAuth *client* to PingOne, a different trust role, and it is frequently unconfigured.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

const keyMod = require('../../services/enterpriseIdpKey');

describe('enterpriseIdpKey', () => {
  const ORIG = { ...process.env };
  beforeEach(() => { keyMod.resetForTests(); delete process.env.ENTERPRISE_IDP_SIGNING_KEY_PEM; });
  afterEach(() => { process.env = { ...ORIG }; keyMod.resetForTests(); });

  test('generates a usable RSA private key when unconfigured', () => {
    const pem = keyMod.getPrivateKeyPem();
    expect(pem).toContain('BEGIN PRIVATE KEY');
  });

  test('is stable across calls (memoised)', () => {
    expect(keyMod.getPrivateKeyPem()).toBe(keyMod.getPrivateKeyPem());
    expect(keyMod.getKid()).toBe(keyMod.getKid());
  });

  test('publishes an RS256 signing JWK carrying the same kid', () => {
    const jwk = keyMod.getPublicJwk();
    expect(jwk.kty).toBe('RSA');
    expect(jwk.use).toBe('sig');
    expect(jwk.alg).toBe('RS256');
    expect(jwk.kid).toBe(keyMod.getKid());
    expect(jwk.n).toBeTruthy();
    expect(jwk.e).toBeTruthy();
  });

  test('never exposes private material in the public JWK', () => {
    const jwk = keyMod.getPublicJwk();
    expect(jwk.d).toBeUndefined();
    expect(jwk.p).toBeUndefined();
    expect(jwk.q).toBeUndefined();
  });

  test('honours ENTERPRISE_IDP_SIGNING_KEY_PEM when set', () => {
    const crypto = require('crypto');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    process.env.ENTERPRISE_IDP_SIGNING_KEY_PEM = pem;
    keyMod.resetForTests();
    expect(keyMod.getPrivateKeyPem()).toBe(pem);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseIdpKey.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../services/enterpriseIdpKey'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';

/**
 * enterpriseIdpKey.js
 * RS256 signing key for the demo Enterprise IdP that mints ID-JAG assertions.
 *
 * Deliberately NOT the private_key_jwt key from clientAssertionService: that one
 * is the BFF's identity as an OAuth *client* to PingOne. Signing IdP assertions
 * with it would conflate two trust roles, and it is often unconfigured.
 *
 * Mirrors oauth-mcp/src/oauth/SigningKeyManager.ts.
 */

const crypto = require('crypto');

let cached = null;

function build() {
  const pemEnv = process.env.ENTERPRISE_IDP_SIGNING_KEY_PEM;
  const privateKey = pemEnv
    ? crypto.createPrivateKey(pemEnv)
    : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

  const pem = pemEnv || privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  const kid = crypto.createHash('sha256').update(JSON.stringify(jwk)).digest('hex').slice(0, 16);

  return { pem, jwk, kid };
}

function load() {
  if (!cached) cached = build();
  return cached;
}

function getPrivateKeyPem() { return load().pem; }
function getKid() { return load().kid; }

function getPublicJwk() {
  const { jwk, kid } = load();
  return { ...jwk, kid, use: 'sig', alg: 'RS256' };
}

/** Test-only: clears the memoised key so each test starts fresh. */
function resetForTests() { cached = null; }

module.exports = { getPrivateKeyPem, getPublicJwk, getKid, resetForTests };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseIdpKey.test.js --forceExit`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/enterpriseIdpKey.js demo_api_server/src/__tests__/enterpriseIdpKey.test.js
git commit -m "feat(bff): RS256 signing key for the demo enterprise IdP"
```

---

## Task 2: Config keys

**Files:**
- Modify: `demo_api_server/services/configStore.js:369-371` (insert after `enterprise_mcp_resource_uris`)
- Test: `demo_api_server/src/__tests__/enterpriseIdpConfig.test.js`

**Interfaces:**
- Produces: config keys `enterprise_idp_issuer`, `enterprise_idp_jwks_url`, `enterprise_mcp_as_token_url`, `enterprise_mcp_policy_cache_ttl_ms`.

`mcp_server_url` is a `ws://` URL and cannot be reused for an HTTP token POST, which is why `enterprise_mcp_as_token_url` is its own key rather than derived.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

const configStore = require('../../services/configStore');

describe('enterprise IdP config keys', () => {
  test('native-mode keys default to empty so native mode is OFF by default', () => {
    expect(configStore.getEffective('enterprise_idp_issuer')).toBe('');
    expect(configStore.getEffective('enterprise_idp_jwks_url')).toBe('');
    expect(configStore.getEffective('enterprise_mcp_as_token_url')).toBe('');
  });

  test('policy cache TTL default is unchanged at 5 minutes', () => {
    expect(String(configStore.getEffective('enterprise_mcp_policy_cache_ttl_ms'))).toBe('300000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseIdpConfig.test.js --forceExit`
Expected: FAIL — values are `undefined`, not `''`

- [ ] **Step 3: Write minimal implementation**

Insert directly after the `enterprise_mcp_resource_uris` line:

```javascript
  // Native ID-JAG (Phase 3). Native mode engages ONLY when enterprise_idp_issuer
  // AND enterprise_idp_jwks_url are both non-empty; otherwise the RFC 8693
  // stand-in runs unchanged. Both default empty so demo behaviour does not move.
  enterprise_idp_issuer:           { public: true, default: '' }, // ID-JAG `iss`
  enterprise_idp_jwks_url:         { public: true, default: '' }, // where oauth-mcp fetches verification keys
  enterprise_mcp_as_token_url:     { public: true, default: '' }, // MCP AS token endpoint (HTTP; mcp_server_url is ws://)
  enterprise_mcp_policy_cache_ttl_ms: { public: true, default: '300000' }, // unchanged default; demos lower it for UC39
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseIdpConfig.test.js --forceExit`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/configStore.js demo_api_server/src/__tests__/enterpriseIdpConfig.test.js
git commit -m "feat(bff): config keys for native ID-JAG mode"
```

---

## Task 3: Demo IdP routes — JWKS and ID-JAG mint

**Files:**
- Create: `demo_api_server/routes/enterpriseIdp.js`
- Modify: `demo_api_server/server.js` (mount alongside the existing `xaaIdJagDemoRoutes` mount at ~line 1566)
- Test: `demo_api_server/src/__tests__/enterpriseIdpRoutes.test.js`

**Interfaces:**
- Consumes: `enterpriseIdpKey.getPrivateKeyPem/getPublicJwk/getKid` (Task 1); `enterpriseMcpPolicyService.checkPolicy(req)`.
- Produces: `GET /api/enterprise-idp/jwks` → `{ keys: [jwk] }`; `POST /api/enterprise-idp/token` → `{ issued_token_type, access_token, token_type: 'N_A', expires_in }`.

**This is where the policy gate moves.** Today `checkPolicy` runs after PingOne has already minted. The spec requires the IdP to refuse issuance, so a DENY here returns an OAuth error and **no assertion is minted**.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

jest.mock('../../services/enterpriseMcpPolicyService', () => ({
  checkPolicy: jest.fn(),
  getAllowedResourceUris: jest.fn(() => ['https://mcpserver.ping.demo']),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const policy = require('../../services/enterpriseMcpPolicyService');
const configStore = require('../../services/configStore');
const keyMod = require('../../services/enterpriseIdpKey');

const AS_ISSUER = 'https://mcpserver.ping.demo:8080';
const RESOURCE = 'https://mcpserver.ping.demo';

function appWithSession(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/enterprise-idp', require('../../routes/enterpriseIdp'));
  return app;
}

const VALID_BODY = {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
  subject_token: 'the-users-id-token',
  subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  audience: AS_ISSUER,
  resource: RESOURCE,
  scope: 'banking:read',
};

describe('enterprise IdP routes', () => {
  const session = { user: { oauthId: 'user-123', username: 'alice', email: 'alice@example.com' } };

  beforeEach(() => {
    jest.clearAllMocks();
    keyMod.resetForTests();
    policy.checkPolicy.mockResolvedValue({ allowed: true, matchDetail: 'group:banking-agents' });
    configStore.getEffective.mockImplementation((k) => {
      if (k === 'enterprise_idp_issuer') return 'https://idp.ping.demo';
      if (k === 'enterprise_mcp_as_token_url') return `${AS_ISSUER}/token`;
      return '';
    });
  });

  test('GET /jwks publishes the signing key and no private material', async () => {
    const res = await request(appWithSession(session)).get('/api/enterprise-idp/jwks');
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0].alg).toBe('RS256');
    expect(res.body.keys[0].d).toBeUndefined();
  });

  test('mints an ID-JAG with the spec-mandated header and claims', async () => {
    const res = await request(appWithSession(session)).post('/api/enterprise-idp/token').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(res.body.token_type).toBe('N_A');

    const decoded = jwt.decode(res.body.access_token, { complete: true });
    expect(decoded.header.typ).toBe('oauth-id-jag+jwt');
    expect(decoded.header.alg).toBe('RS256');
    expect(decoded.header.kid).toBe(keyMod.getKid());
    expect(decoded.payload.iss).toBe('https://idp.ping.demo');
    expect(decoded.payload.sub).toBe('user-123');
    expect(decoded.payload.email).toBe('alice@example.com');
    expect(decoded.payload.aud).toBe(AS_ISSUER);
    expect(decoded.payload.resource).toBe(RESOURCE);
    expect(decoded.payload.scope).toBe('banking:read');
    expect(decoded.payload.jti).toBeTruthy();
    expect(decoded.payload.exp - decoded.payload.iat).toBe(120);
  });

  test('DENY mints NOTHING and reports enterprise_mcp_policy_denied', async () => {
    policy.checkPolicy.mockResolvedValue({
      allowed: false, code: 'enterprise_mcp_policy_denied', httpStatus: 403, message: 'Not authorized.',
    });
    const res = await request(appWithSession(session)).post('/api/enterprise-idp/token').send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('access_denied');
    expect(res.body.code).toBe('enterprise_mcp_policy_denied');
    expect(res.body.access_token).toBeUndefined();
  });

  test('rejects a resource outside the allowed set', async () => {
    const res = await request(appWithSession(session))
      .post('/api/enterprise-idp/token')
      .send({ ...VALID_BODY, resource: 'https://evil.example' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_target');
  });

  test('rejects a wrong requested_token_type', async () => {
    const res = await request(appWithSession(session))
      .post('/api/enterprise-idp/token')
      .send({ ...VALID_BODY, requested_token_type: 'urn:ietf:params:oauth:token-type:access_token' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('requires a signed-in session', async () => {
    const res = await request(appWithSession({})).post('/api/enterprise-idp/token').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.access_token).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseIdpRoutes.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../routes/enterpriseIdp'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';

/**
 * enterpriseIdp.js — demo Enterprise IdP for MCP Enterprise-Managed Authorization.
 *
 * PingOne does not yet issue ID-JAG assertions, so this endpoint performs the
 * signing step only. PingOne remains the authority for identity and group policy:
 * enterpriseMcpPolicyService.checkPolicy is what decides PERMIT/DENY here.
 *
 * The policy gate runs BEFORE minting on purpose. The extension requires that a
 * client never receive a token for a server it is not authorized for, so a denied
 * user gets an OAuth error and no assertion at all.
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const router = express.Router();
const configStore = require('../services/configStore');
const enterpriseMcpPolicy = require('../services/enterpriseMcpPolicyService');
const enterpriseIdpKey = require('../services/enterpriseIdpKey');

const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ID_JAG_LIFETIME_SECONDS = 120;

/** Public JWKS so the MCP Authorization Server can verify our assertions. */
router.get('/jwks', (_req, res) => {
  res.json({ keys: [enterpriseIdpKey.getPublicJwk()] });
});

/**
 * RFC 8693 exchange issuing an ID-JAG.
 * Body: grant_type, requested_token_type, subject_token, subject_token_type,
 *       audience (MCP AS issuer), resource (MCP server), scope.
 */
router.post('/token', express.json(), async (req, res) => {
  const { grant_type, requested_token_type, subject_token, audience, resource, scope } = req.body || {};

  if (grant_type !== TOKEN_EXCHANGE_GRANT || requested_token_type !== ID_JAG_TOKEN_TYPE || !subject_token || !audience) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'grant_type=...token-exchange, requested_token_type=...id-jag, subject_token and audience are required',
    });
  }

  const user = req.session?.user;
  if (!user?.oauthId) {
    return res.status(401).json({ error: 'invalid_grant', error_description: 'No signed-in user for this exchange.' });
  }

  if (resource) {
    const allowed = enterpriseMcpPolicy.getAllowedResourceUris();
    if (allowed.length && !allowed.includes(resource)) {
      return res.status(400).json({ error: 'invalid_target', error_description: `resource ${resource} is not an approved MCP server.` });
    }
  }

  const policy = await enterpriseMcpPolicy.checkPolicy(req);
  if (!policy.allowed) {
    return res.status(policy.httpStatus || 403).json({
      error: 'access_denied',
      error_description: policy.message || 'Enterprise MCP policy denied.',
      code: policy.code || 'enterprise_mcp_policy_denied',
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const id_jag = jwt.sign(
    {
      jti: crypto.randomUUID(),
      iss: configStore.getEffective('enterprise_idp_issuer') || '',
      sub: user.oauthId,
      ...(user.email ? { email: user.email } : {}),
      aud: audience,
      ...(resource ? { resource } : {}),
      client_id: req.body.client_id || 'demo-bff-mcp-client',
      iat: now,
      exp: now + ID_JAG_LIFETIME_SECONDS,
      scope: scope || '',
    },
    enterpriseIdpKey.getPrivateKeyPem(),
    { algorithm: 'RS256', header: { alg: 'RS256', typ: 'oauth-id-jag+jwt', kid: enterpriseIdpKey.getKid() } },
  );

  res.json({
    issued_token_type: ID_JAG_TOKEN_TYPE,
    access_token: id_jag,
    token_type: 'N_A',
    expires_in: ID_JAG_LIFETIME_SECONDS,
  });
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseIdpRoutes.test.js --forceExit`
Expected: PASS, 6 tests

- [ ] **Step 5: Mount the router**

In `demo_api_server/server.js`, immediately after the existing two `xaaIdJagDemoRoutes` lines (~1566):

```javascript
const enterpriseIdpRoutes = require('./routes/enterpriseIdp');
app.use('/api/enterprise-idp', enterpriseIdpRoutes);
```

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/enterpriseIdp.js demo_api_server/server.js demo_api_server/src/__tests__/enterpriseIdpRoutes.test.js
git commit -m "feat(bff): demo enterprise IdP mints signed ID-JAG behind the policy gate"
```

---

## Task 4: `oauth-mcp` verifies an ID-JAG

**Files:**
- Create: `oauth-mcp/src/oauth/IdJagGrantHandler.ts`
- Test: `oauth-mcp/src/oauth/__tests__/IdJagGrantHandler.test.ts`

**Interfaces:**
- Consumes: `resolveEmbeddedIssuer()` from `../oauth/embeddedIssuer`.
- Produces:
  - `verifyIdJag(assertion: string, opts: VerifyOpts): Promise<IdJagClaims>` — throws `IdJagError` on any failure
  - `class IdJagError extends Error { oauthError: string }`
  - `interface IdJagClaims { jti, iss, sub, email?, aud, resource, client_id, scope, exp, iat }`
  - `resetReplayCacheForTests(): void`

Verification is pure — no HTTP, no token issuance. Task 5 wires it to the router.

- [ ] **Step 1: Write the failing test**

```typescript
import * as jose from 'jose';
import * as crypto from 'crypto';
import { verifyIdJag, IdJagError, resetReplayCacheForTests } from '../IdJagGrantHandler';

const IDP_ISSUER = 'https://idp.ping.demo';
const AS_ISSUER = 'https://mcpserver.ping.demo:8080';
const RESOURCE = 'https://mcpserver.ping.demo';

let privateKey: crypto.KeyObject;
let publicKey: crypto.KeyObject;

const OPTS = () => ({
  idpIssuer: IDP_ISSUER,
  ownIssuer: AS_ISSUER,
  acceptedResources: [RESOURCE],
  getKey: async () => publicKey,
});

async function mintIdJag(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    jti: crypto.randomUUID(), email: 'alice@example.com',
    resource: RESOURCE, client_id: 'demo-bff-mcp-client', scope: 'banking:read', ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'oauth-id-jag+jwt', ...header })
    .setIssuer((overrides.iss as string) ?? IDP_ISSUER)
    .setSubject((overrides.sub as string) ?? 'user-123')
    .setAudience((overrides.aud as string) ?? AS_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime((overrides.exp as number) ?? now + 120)
    .sign(privateKey);
}

beforeAll(() => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey; publicKey = pair.publicKey;
});
beforeEach(() => resetReplayCacheForTests());

describe('verifyIdJag', () => {
  it('accepts a well-formed assertion and returns its claims', async () => {
    const claims = await verifyIdJag(await mintIdJag(), OPTS());
    expect(claims.sub).toBe('user-123');
    expect(claims.email).toBe('alice@example.com');
    expect(claims.resource).toBe(RESOURCE);
    expect(claims.scope).toBe('banking:read');
  });

  it('rejects alg:none — an unsigned assertion is attacker-authored', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'oauth-id-jag+jwt' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: IDP_ISSUER, sub: 'user-123', aud: AS_ISSUER, resource: RESOURCE,
      scope: 'banking:read', jti: 'x', exp: Math.floor(Date.now() / 1000) + 120,
    })).toString('base64url');
    await expect(verifyIdJag(`${header}.${payload}.`, OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects a signature from the wrong key', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(
      verifyIdJag(await mintIdJag(), { ...OPTS(), getKey: async () => other.publicKey }),
    ).rejects.toThrow(IdJagError);
  });

  it('rejects a wrong typ header', async () => {
    await expect(verifyIdJag(await mintIdJag({}, { typ: 'JWT' }), OPTS())).rejects.toThrow(/typ/i);
  });

  it('rejects an assertion from an unknown issuer', async () => {
    await expect(verifyIdJag(await mintIdJag({ iss: 'https://evil.example' }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects an assertion audienced at another AS', async () => {
    await expect(verifyIdJag(await mintIdJag({ aud: 'https://other.as' }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects a resource this server does not serve', async () => {
    await expect(verifyIdJag(await mintIdJag({ resource: 'https://evil.example' }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects an expired assertion', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyIdJag(await mintIdJag({ exp: now - 10 }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects replay of the same jti', async () => {
    const assertion = await mintIdJag({ jti: 'replay-me' });
    await expect(verifyIdJag(assertion, OPTS())).resolves.toBeTruthy();
    await expect(verifyIdJag(assertion, OPTS())).rejects.toThrow(/replay|already/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd oauth-mcp && NODE_ENV=test npx jest src/oauth/__tests__/IdJagGrantHandler.test.ts --forceExit`
Expected: FAIL — cannot find module `../IdJagGrantHandler`

- [ ] **Step 3: Write minimal implementation**

```typescript
import * as jose from 'jose';
import * as crypto from 'crypto';

export const ID_JAG_TYP = 'oauth-id-jag+jwt';
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const ID_JAG_GRANT_PROFILE = 'urn:ietf:params:oauth:grant-profile:id-jag';

export class IdJagError extends Error {
  constructor(message: string, public oauthError: string = 'invalid_grant') {
    super(message);
    this.name = 'IdJagError';
  }
}

export interface IdJagClaims {
  jti: string; iss: string; sub: string; email?: string;
  aud: string; resource: string; client_id?: string; scope: string;
  exp: number; iat: number;
}

export interface VerifyOpts {
  idpIssuer: string;
  ownIssuer: string;
  acceptedResources: string[];
  /** Resolves the verification key. Production passes a jose remote JWKS. */
  getKey: (protectedHeader: jose.JWTHeaderParameters) => Promise<crypto.KeyObject | jose.CryptoKey | Uint8Array>;
}

// ponytail: in-memory replay cache, single-process. A shared store is needed
// only if oauth-mcp is scaled to multiple replicas.
const seenJti = new Map<string, number>();

function rememberJti(jti: string, expSeconds: number): void {
  const nowMs = Date.now();
  for (const [key, expiresAtMs] of seenJti) {
    if (expiresAtMs <= nowMs) seenJti.delete(key);
  }
  seenJti.set(jti, expSeconds * 1000);
}

export function resetReplayCacheForTests(): void { seenJti.clear(); }

/**
 * Verify an ID-JAG assertion. Fail-closed at every step: anything unverified is
 * attacker-authored, so a failure throws rather than returning partial claims.
 */
export async function verifyIdJag(assertion: string, opts: VerifyOpts): Promise<IdJagClaims> {
  let payload: jose.JWTPayload;
  let protectedHeader: jose.JWTHeaderParameters;

  try {
    // jose rejects `alg: none` and enforces iss/aud/exp. RS256 is pinned so a
    // downgrade to an unsigned or symmetric assertion cannot be negotiated.
    const result = await jose.jwtVerify(assertion, opts.getKey as jose.JWTVerifyGetKey, {
      algorithms: ['RS256'],
      issuer: opts.idpIssuer,
      audience: opts.ownIssuer,
      clockTolerance: 5,
    });
    payload = result.payload;
    protectedHeader = result.protectedHeader as jose.JWTHeaderParameters;
  } catch (err) {
    throw new IdJagError(`ID-JAG verification failed: ${(err as Error).message}`);
  }

  if (protectedHeader.typ !== ID_JAG_TYP) {
    throw new IdJagError(`ID-JAG must carry typ "${ID_JAG_TYP}", got "${protectedHeader.typ}"`);
  }

  const resource = payload.resource as string | undefined;
  if (!resource || !opts.acceptedResources.includes(resource)) {
    throw new IdJagError(`ID-JAG resource "${resource}" is not served by this authorization server`, 'invalid_target');
  }

  const jti = payload.jti as string | undefined;
  if (!jti) throw new IdJagError('ID-JAG is missing jti; single-use cannot be enforced');
  if (seenJti.has(jti)) throw new IdJagError('ID-JAG already redeemed (replay rejected)');
  rememberJti(jti, payload.exp as number);

  return {
    jti,
    iss: payload.iss as string,
    sub: payload.sub as string,
    email: payload.email as string | undefined,
    aud: opts.ownIssuer,
    resource,
    client_id: payload.client_id as string | undefined,
    scope: (payload.scope as string) || '',
    exp: payload.exp as number,
    iat: payload.iat as number,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd oauth-mcp && NODE_ENV=test npx jest src/oauth/__tests__/IdJagGrantHandler.test.ts --forceExit`
Expected: PASS, 9 tests

- [ ] **Step 5: Typecheck**

Run: `cd oauth-mcp && npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add oauth-mcp/src/oauth/IdJagGrantHandler.ts oauth-mcp/src/oauth/__tests__/IdJagGrantHandler.test.ts
git commit -m "feat(oauth-mcp): verify ID-JAG assertions, single-use and fail-closed"
```

---

## Task 5: Wire the `jwt-bearer` grant into the token endpoint

**Files:**
- Modify: `oauth-mcp/src/oauth/OAuthRouter.ts` — metadata (~line 67) and `handleToken` switch (~line 326)
- Test: `oauth-mcp/src/oauth/__tests__/OAuthRouter.idJag.test.ts`

**Interfaces:**
- Consumes: `verifyIdJag`, `IdJagError`, `JWT_BEARER_GRANT`, `ID_JAG_GRANT_PROFILE` (Task 4); `tokenIssuer.issueAuthorizationCode(client, subject, requestedScope)`.
- Produces: `POST /token` accepting `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<ID-JAG>`.

Two constraints from the existing code:

1. `handleToken` enforces `client.grant_types.includes(grantType)` **before** the switch, so the calling client must be registered with the `jwt-bearer` grant type. The test registers it explicitly.
2. **Reuse `issueAuthorizationCode`** — it already sets an arbitrary subject and clamps scope via `resolveScope`. Passing the assertion's scope as `requestedScope` yields exactly the required intersection (assertion ∩ client). No new issuer method.

Native mode here is gated on `ENTERPRISE_IDP_ISSUER` and `ENTERPRISE_IDP_JWKS_URL`; unset means the grant stays unadvertised and unsupported.

- [ ] **Step 1: Write the failing test**

```typescript
import * as jose from 'jose';
import * as crypto from 'crypto';

const IDP_ISSUER = 'https://idp.ping.demo';
const RESOURCE = 'https://mcpserver.ping.demo';

describe('OAuthRouter jwt-bearer / ID-JAG grant', () => {
  const ORIG = { ...process.env };
  let privateKey: crypto.KeyObject;
  let publicKey: crypto.KeyObject;

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey; publicKey = pair.publicKey;
  });

  beforeEach(() => {
    process.env.ENTERPRISE_IDP_ISSUER = IDP_ISSUER;
    process.env.ENTERPRISE_IDP_JWKS_URL = 'https://api.ping.demo:3001/api/enterprise-idp/jwks';
    process.env.MCP_SERVER_RESOURCE_URI = RESOURCE;
  });
  afterEach(() => { process.env = { ...ORIG }; jest.resetModules(); });

  it('advertises the id-jag grant profile only when native mode is configured', async () => {
    const { buildAuthServerMetadata } = await import('../OAuthRouter');
    const on = buildAuthServerMetadata();
    expect(on.grant_types_supported).toContain('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(on.authorization_grant_profiles_supported).toContain('urn:ietf:params:oauth:grant-profile:id-jag');

    delete process.env.ENTERPRISE_IDP_JWKS_URL;
    jest.resetModules();
    const { buildAuthServerMetadata: rebuilt } = await import('../OAuthRouter');
    const off = rebuilt();
    expect(off.grant_types_supported).not.toContain('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(off.authorization_grant_profiles_supported).toBeUndefined();
  });

  it('redeems a valid ID-JAG for an access token subjected to the assertion sub', async () => {
    const { redeemIdJagForTests } = await import('../OAuthRouter');
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new jose.SignJWT({
      jti: crypto.randomUUID(), resource: RESOURCE, scope: 'banking:read',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'oauth-id-jag+jwt' })
      .setIssuer(IDP_ISSUER).setSubject('user-123')
      .setAudience(process.env.OAUTH_ISSUER || 'https://localhost:8080')
      .setIssuedAt(now).setExpirationTime(now + 120)
      .sign(privateKey);

    const result = await redeemIdJagForTests(assertion, { getKey: async () => publicKey });
    expect(result.status).toBe(200);
    const claims = jose.decodeJwt(result.body.access_token);
    expect(claims.sub).toBe('user-123');
    expect(result.body.token_type).toBe('Bearer');
  });

  it('returns an OAuth error, not a token, when the assertion is bad', async () => {
    const { redeemIdJagForTests } = await import('../OAuthRouter');
    const result = await redeemIdJagForTests('not.a.jwt', { getKey: async () => publicKey });
    expect(result.status).toBe(400);
    expect(result.body.access_token).toBeUndefined();
    expect(result.body.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd oauth-mcp && NODE_ENV=test npx jest src/oauth/__tests__/OAuthRouter.idJag.test.ts --forceExit`
Expected: FAIL — `buildAuthServerMetadata` / `redeemIdJagForTests` are not exported

- [ ] **Step 3: Add native-mode helpers and the metadata builder**

Add near the top of `OAuthRouter.ts`:

```typescript
import {
  verifyIdJag, IdJagError, JWT_BEARER_GRANT, ID_JAG_GRANT_PROFILE, VerifyOpts,
} from './IdJagGrantHandler';
import { resolveEmbeddedIssuer } from './embeddedIssuer';
import { resolveAudience } from './TokenIssuer';

/** Native ID-JAG engages only when BOTH the issuer and its JWKS are configured. */
export function nativeIdJagEnabled(): boolean {
  return Boolean(process.env.ENTERPRISE_IDP_ISSUER && process.env.ENTERPRISE_IDP_JWKS_URL);
}

let remoteJwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function enterpriseIdpJwks() {
  if (!remoteJwks) {
    remoteJwks = jose.createRemoteJWKSet(new URL(process.env.ENTERPRISE_IDP_JWKS_URL as string));
  }
  return remoteJwks;
}

function idJagVerifyOpts(): VerifyOpts {
  return {
    idpIssuer: process.env.ENTERPRISE_IDP_ISSUER as string,
    ownIssuer: resolveEmbeddedIssuer(),
    acceptedResources: resolveAudience(),
    getKey: enterpriseIdpJwks() as unknown as VerifyOpts['getKey'],
  };
}
```

Extract the metadata object into an exported builder so it is testable, replacing the inline literal at ~line 57:

```typescript
export function buildAuthServerMetadata(): Record<string, unknown> {
  const grantTypes = ['authorization_code', 'client_credentials'];
  if (nativeIdJagEnabled()) grantTypes.push(JWT_BEARER_GRANT);
  return {
    // ...every existing field, unchanged...
    grant_types_supported: grantTypes,
    ...(nativeIdJagEnabled()
      ? { authorization_grant_profiles_supported: [ID_JAG_GRANT_PROFILE] }
      : {}),
  };
}
```

- [ ] **Step 4: Add the grant case and its test seam**

Insert into the `handleToken` switch, immediately before `default:`:

```typescript
      case JWT_BEARER_GRANT: {
        if (!nativeIdJagEnabled()) {
          this.json(res, 400, { error: 'unsupported_grant_type' });
          return true;
        }
        const assertion = params.get('assertion');
        if (!assertion) {
          this.json(res, 400, { error: 'invalid_request', error_description: 'assertion is required' });
          return true;
        }
        const outcome = await this.redeemIdJag(assertion, client, idJagVerifyOpts());
        this.json(res, outcome.status, outcome.body);
        return true;
      }
```

And the method, alongside the other private handlers:

```typescript
  /**
   * Redeem a verified ID-JAG for an access token.
   *
   * issueAuthorizationCode is reused deliberately: it already sets an arbitrary
   * subject and clamps the requested scope to the client's registered scope via
   * resolveScope. Passing the assertion's scope through gives exactly the
   * intersection the spec requires (assertion scope AND client scope), so no
   * separate issuer method is needed.
   */
  private async redeemIdJag(
    assertion: string,
    client: OAuthClient,
    opts: VerifyOpts,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    try {
      const claims = await verifyIdJag(assertion, opts);
      // Account linking, per the extension: sub is the stable primary
      // identifier; email is only a fallback for accounts that predate
      // enterprise-managed authorization.
      const subject = claims.sub || claims.email;
      if (!subject) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'ID-JAG carries neither sub nor email' } };
      }
      const tokenResponse = await this.tokenIssuer.issueAuthorizationCode(client, subject, claims.scope);
      return { status: 200, body: tokenResponse as unknown as Record<string, unknown> };
    } catch (err) {
      const oauthError = err instanceof IdJagError ? err.oauthError : 'invalid_grant';
      return { status: 400, body: { error: oauthError, error_description: (err as Error).message } };
    }
  }
```

Add the test seam at the end of the class file (module scope):

```typescript
/** Test-only: exercises redemption without standing up an HTTP listener. */
export async function redeemIdJagForTests(
  assertion: string,
  overrides: Partial<VerifyOpts>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { buildTestRouterAndClient } = await import('./__tests__/idJagTestHarness');
  const { router, client } = await buildTestRouterAndClient();
  return (router as unknown as {
    redeemIdJag(a: string, c: OAuthClient, o: VerifyOpts): Promise<{ status: number; body: Record<string, unknown> }>;
  }).redeemIdJag(assertion, client, { ...idJagVerifyOpts(), ...overrides });
}
```

Create `oauth-mcp/src/oauth/__tests__/idJagTestHarness.ts`:

```typescript
import { OAuthRouter } from '../OAuthRouter';
import { ClientRegistry, OAuthClient } from '../ClientRegistry';
import { TokenIssuer } from '../TokenIssuer';
import { TokenStore } from '../TokenStore';
import { getEmbeddedSigningKeyManager } from '../embeddedIssuer';
import { JWT_BEARER_GRANT } from '../IdJagGrantHandler';

/** Builds a router plus a client registered for the jwt-bearer grant. */
export async function buildTestRouterAndClient(): Promise<{ router: OAuthRouter; client: OAuthClient }> {
  const keyManager = await getEmbeddedSigningKeyManager();
  const clientRegistry = new ClientRegistry();
  const tokenStore = new TokenStore();
  const tokenIssuer = new TokenIssuer(keyManager, clientRegistry, tokenStore);
  const router = new OAuthRouter(clientRegistry, tokenIssuer, tokenStore, keyManager);
  const client: OAuthClient = {
    client_id: 'demo-bff-mcp-client',
    client_secret: 'test-secret',
    redirect_uris: [],
    grant_types: ['authorization_code', JWT_BEARER_GRANT],
    scope: 'banking:read banking:write',
  } as OAuthClient;
  return { router, client };
}
```

> If `OAuthRouter`'s constructor signature differs, match the real one — read the class declaration rather than assuming this order.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd oauth-mcp && NODE_ENV=test npx jest src/oauth/__tests__/OAuthRouter.idJag.test.ts --forceExit`
Expected: PASS, 3 tests

- [ ] **Step 6: Verify no existing OAuth behaviour regressed**

Run: `cd oauth-mcp && NODE_ENV=test npx jest src/oauth --forceExit && npm run typecheck`
Expected: all suites PASS — `OAuthRouter.authorize`, `register`, `registerRoundTrip`, `openRegistration`, `TokenIssuer`, `TokenStore`, `embeddedIssuer`, `ClientRegistry.cimd`

- [ ] **Step 7: Commit**

```bash
git add oauth-mcp/src/oauth/OAuthRouter.ts oauth-mcp/src/oauth/__tests__/OAuthRouter.idJag.test.ts oauth-mcp/src/oauth/__tests__/idJagTestHarness.ts
git commit -m "feat(oauth-mcp): accept jwt-bearer ID-JAG grant at the token endpoint"
```

---

## Task 6: BFF client half — mint and redeem

**Files:**
- Create: `demo_api_server/services/idJagService.js`
- Test: `demo_api_server/src/__tests__/idJagService.test.js`

**Interfaces:**
- Consumes: config keys from Task 2; the endpoints from Task 3 and Task 5.
- Produces:
  - `isNativeIdJagEnabled(): boolean`
  - `mintIdJag(req, { audience, resource, scope }): Promise<{ assertion, expiresIn }>`
  - `redeemIdJag(assertion): Promise<{ access_token, token_type, expires_in, scope }>`
  - `mintAndRedeem(req, { resource, scope }): Promise<{ assertion, token }>`

Named `idJagService.js` because Phase 3 of `planning/ENTERPRISE-MANAGED-MCP-AUTH-PLAN.md` already reserved that name.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('axios');

const axios = require('axios');
const configStore = require('../../services/configStore');
const idJagService = require('../../services/idJagService');

const AS_ISSUER = 'https://mcpserver.ping.demo:8080';
const RESOURCE = 'https://mcpserver.ping.demo';

describe('idJagService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((k) => ({
      enterprise_idp_issuer: 'https://idp.ping.demo',
      enterprise_idp_jwks_url: 'https://api.ping.demo:3001/api/enterprise-idp/jwks',
      enterprise_mcp_as_token_url: `${AS_ISSUER}/token`,
    }[k] || ''));
  });

  test('native mode is OFF unless issuer AND jwks url are both set', () => {
    expect(idJagService.isNativeIdJagEnabled()).toBe(true);
    configStore.getEffective.mockImplementation((k) =>
      k === 'enterprise_idp_issuer' ? 'https://idp.ping.demo' : '');
    expect(idJagService.isNativeIdJagEnabled()).toBe(false);
    configStore.getEffective.mockImplementation(() => '');
    expect(idJagService.isNativeIdJagEnabled()).toBe(false);
  });

  test('mintIdJag posts a spec-shaped token-exchange request', async () => {
    axios.post.mockResolvedValue({
      data: { access_token: 'the.id.jag', issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag', expires_in: 120 },
    });
    const req = { session: { user: { oauthId: 'user-123' } } };
    const out = await idJagService.mintIdJag(req, { audience: AS_ISSUER, resource: RESOURCE, scope: 'banking:read' });

    expect(out.assertion).toBe('the.id.jag');
    const [, body] = axios.post.mock.calls[0];
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.requested_token_type).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(body.subject_token_type).toBe('urn:ietf:params:oauth:token-type:id_token');
    expect(body.audience).toBe(AS_ISSUER);
    expect(body.resource).toBe(RESOURCE);
  });

  test('redeemIdJag posts the jwt-bearer grant with the assertion', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'mcp.access.token', token_type: 'Bearer', expires_in: 3600, scope: 'banking:read' } });
    const token = await idJagService.redeemIdJag('the.id.jag');

    expect(token.access_token).toBe('mcp.access.token');
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe(`${AS_ISSUER}/token`);
    const parsed = new URLSearchParams(body);
    expect(parsed.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(parsed.get('assertion')).toBe('the.id.jag');
  });

  test('a policy DENY at the IdP surfaces its code and mints nothing', async () => {
    axios.post.mockRejectedValue({
      response: { status: 403, data: { error: 'access_denied', code: 'enterprise_mcp_policy_denied', error_description: 'Not authorized.' } },
    });
    const req = { session: { user: { oauthId: 'user-123' } } };
    await expect(
      idJagService.mintIdJag(req, { audience: AS_ISSUER, resource: RESOURCE, scope: 'banking:read' }),
    ).rejects.toMatchObject({ code: 'enterprise_mcp_policy_denied', httpStatus: 403 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/idJagService.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../services/idJagService'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';

/**
 * idJagService.js — MCP client half of Enterprise-Managed Authorization.
 * Requests an ID-JAG from the enterprise IdP, then redeems it at the MCP
 * Authorization Server for an access token. Phase 3 of
 * planning/ENTERPRISE-MANAGED-MCP-AUTH-PLAN.md.
 */

const axios = require('axios');
const configStore = require('./configStore');

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

const cfg = (k) => String(configStore.getEffective(k) || '').trim();

/** Native ID-JAG engages ONLY when both the issuer and its JWKS are configured. */
function isNativeIdJagEnabled() {
  return Boolean(cfg('enterprise_idp_issuer') && cfg('enterprise_idp_jwks_url'));
}

function idpTokenUrl() {
  return `${cfg('enterprise_idp_base_url') || 'http://127.0.0.1:3001'}/api/enterprise-idp/token`;
}

/** Rethrow an upstream OAuth error with the fields callers already branch on. */
function toDemoError(err, fallback) {
  const data = err?.response?.data || {};
  const wrapped = new Error(data.error_description || err.message || fallback);
  wrapped.code = data.code || data.error || 'id_jag_error';
  wrapped.httpStatus = err?.response?.status || 502;
  return wrapped;
}

async function mintIdJag(req, { audience, resource, scope }) {
  try {
    const { data } = await axios.post(
      idpTokenUrl(),
      {
        grant_type: TOKEN_EXCHANGE_GRANT,
        requested_token_type: ID_JAG_TOKEN_TYPE,
        subject_token: req.session?.idToken || req.session?.user?.oauthId || '',
        subject_token_type: ID_TOKEN_TYPE,
        audience,
        resource,
        scope,
      },
      { headers: { Cookie: req.headers?.cookie || '' }, timeout: 10000 },
    );
    return { assertion: data.access_token, expiresIn: data.expires_in };
  } catch (err) {
    throw toDemoError(err, 'ID-JAG mint failed.');
  }
}

async function redeemIdJag(assertion) {
  try {
    const body = new URLSearchParams({
      grant_type: JWT_BEARER_GRANT,
      assertion,
      client_id: cfg('enterprise_mcp_as_client_id') || 'demo-bff-mcp-client',
    }).toString();
    const { data } = await axios.post(cfg('enterprise_mcp_as_token_url'), body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    return data;
  } catch (err) {
    throw toDemoError(err, 'ID-JAG redemption failed.');
  }
}

async function mintAndRedeem(req, { resource, scope }) {
  const audience = cfg('enterprise_mcp_as_issuer') || cfg('enterprise_mcp_as_token_url').replace(/\/token$/, '');
  const { assertion } = await mintIdJag(req, { audience, resource, scope });
  const token = await redeemIdJag(assertion);
  return { assertion, token };
}

module.exports = { isNativeIdJagEnabled, mintIdJag, redeemIdJag, mintAndRedeem };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/idJagService.test.js --forceExit`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/idJagService.js demo_api_server/src/__tests__/idJagService.test.js
git commit -m "feat(bff): idJagService mints and redeems ID-JAG assertions"
```

---

## Task 7: Route the agent through the native path

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js` (the `enterprise-managed-mode` token event, ~line 1013-1030, and the exchange call site)
- Test: `demo_api_server/src/__tests__/enterpriseMcpNativeMode.test.js`

**Interfaces:**
- Consumes: `idJagService.isNativeIdJagEnabled/mintAndRedeem` (Task 6).
- Produces: token events `id-jag-issued` and `id-jag-redeemed`; `idJagStandIn: false` on the `enterprise-managed-mode` event when native.

**This is the regression-sensitive task.** The load-bearing test is the *last* one: flag ON with native unconfigured must produce exactly today's events.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

jest.mock('../../services/idJagService', () => ({
  isNativeIdJagEnabled: jest.fn(() => false),
  mintAndRedeem: jest.fn(),
}));
jest.mock('../../services/enterpriseMcpPolicyService', () => ({
  isEnabled: jest.fn(() => true),
  checkPolicy: jest.fn(async () => ({ allowed: true, matchDetail: 'group:banking-agents' })),
  getAllowedResourceUris: jest.fn(() => ['https://mcpserver.ping.demo']),
}));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn() }));

const idJagService = require('../../services/idJagService');
const agentMcpTokenService = require('../../services/agentMcpTokenService');

function sessionReq() {
  return { session: { user: { oauthId: 'user-123', username: 'alice' } }, headers: {} };
}

describe('enterprise-managed mode token path', () => {
  beforeEach(() => jest.clearAllMocks());

  test('native mode emits real ID-JAG events and marks the stand-in false', async () => {
    idJagService.isNativeIdJagEnabled.mockReturnValue(true);
    idJagService.mintAndRedeem.mockResolvedValue({
      assertion: 'the.id.jag',
      token: { access_token: 'mcp.access.token', token_type: 'Bearer', expires_in: 3600, scope: 'banking:read' },
    });

    const events = [];
    await agentMcpTokenService.applyEnterpriseManagedMode(sessionReq(), events, {
      resource: 'https://mcpserver.ping.demo', scope: 'banking:read',
    });

    const kinds = events.map((e) => e.step || e.id);
    expect(kinds).toContain('id-jag-issued');
    expect(kinds).toContain('id-jag-redeemed');
    const mode = events.find((e) => (e.step || e.id) === 'enterprise-managed-mode');
    expect(mode.details.idJagStandIn).toBe(false);
  });

  test('STAND-IN UNCHANGED: native unconfigured emits todays events only', async () => {
    idJagService.isNativeIdJagEnabled.mockReturnValue(false);

    const events = [];
    await agentMcpTokenService.applyEnterpriseManagedMode(sessionReq(), events, {
      resource: 'https://mcpserver.ping.demo', scope: 'banking:read',
    });

    const kinds = events.map((e) => e.step || e.id);
    expect(kinds).toContain('enterprise-managed-mode');
    expect(kinds).not.toContain('id-jag-issued');
    expect(kinds).not.toContain('id-jag-redeemed');
    const mode = events.find((e) => (e.step || e.id) === 'enterprise-managed-mode');
    expect(mode.details.idJagStandIn).toBe(true);
    expect(idJagService.mintAndRedeem).not.toHaveBeenCalled();
  });

  test('a DENY at the IdP propagates its code and issues no token', async () => {
    idJagService.isNativeIdJagEnabled.mockReturnValue(true);
    const denial = Object.assign(new Error('Not authorized.'), {
      code: 'enterprise_mcp_policy_denied', httpStatus: 403,
    });
    idJagService.mintAndRedeem.mockRejectedValue(denial);

    await expect(
      agentMcpTokenService.applyEnterpriseManagedMode(sessionReq(), [], {
        resource: 'https://mcpserver.ping.demo', scope: 'banking:read',
      }),
    ).rejects.toMatchObject({ code: 'enterprise_mcp_policy_denied' });
  });
});
```

> Before implementing, read the real function around `agentMcpTokenService.js:997-1032`. If the enterprise block is not already a named exported function, extract it as `applyEnterpriseManagedMode(req, tokenEvents, opts)` with **no behaviour change** and make that extraction its own commit, so the refactor and the feature stay separable.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseMcpNativeMode.test.js --forceExit`
Expected: FAIL — `applyEnterpriseManagedMode` is not a function

- [ ] **Step 3: Write minimal implementation**

Inside `applyEnterpriseManagedMode`, after the existing policy check and consent auto-set, replace the single `enterprise-managed-mode` push with:

```javascript
  const idJagService = require('./idJagService');
  const native = idJagService.isNativeIdJagEnabled();

  tokenEvents.push(buildTokenEvent(
    'enterprise-managed-mode',
    'Enterprise-Managed MCP — IT policy passed (no Connect MCP step)',
    'active',
    null,
    native
      ? 'Enterprise-managed mode is ON. The user passed IT group/population policy. ' +
        'A signed ID-JAG is issued below and redeemed at the MCP Authorization Server.'
      : 'Enterprise-managed mode is ON. The user passed IT group/population policy. ' +
        'RFC 8693 token exchange below is an ID-JAG equivalent stand-in until PingOne ships native ID-JAG.',
    {
      rfc: 'MCP Enterprise-Managed Authorization',
      idJagStandIn: !native,
      matchDetail: policy.matchDetail || null,
      resourceUris: enterpriseMcpPolicy.getAllowedResourceUris(),
    }
  ));

  if (!native) return policy;

  const { assertion, token } = await idJagService.mintAndRedeem(req, {
    resource: opts.resource,
    scope: opts.scope,
  });

  tokenEvents.push(buildTokenEvent(
    'id-jag-issued',
    'Enterprise IdP issued an ID-JAG',
    'active',
    assertion,
    'The IdP evaluated policy and signed an Identity Assertion JWT Authorization Grant. ' +
    'It is audience-restricted to the MCP Authorization Server, names the MCP server in `resource`, ' +
    'is single-use, and expires in 120 seconds.',
    { rfc: 'RFC 8693 · draft-ietf-oauth-identity-assertion-authz-grant', idJagStandIn: false }
  ));

  tokenEvents.push(buildTokenEvent(
    'id-jag-redeemed',
    'MCP Authorization Server redeemed the ID-JAG',
    'active',
    token.access_token,
    'The MCP Authorization Server verified the assertion against the IdP JWKS and issued its own ' +
    'access token. No browser redirect to an MCP authorize endpoint was involved.',
    { rfc: 'RFC 7523 · MCP Enterprise-Managed Authorization', scope: token.scope || opts.scope }
  ));

  policy.mcpAccessToken = token.access_token;
  return policy;
```

Then, at the exchange call site, use `policy.mcpAccessToken` when present instead of performing the PingOne RFC 8693 exchange.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseMcpNativeMode.test.js --forceExit`
Expected: PASS, 3 tests

- [ ] **Step 5: Prove the existing suites still pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseMcpAuth.test.js src/__tests__/enterpriseMcpPolicyService.test.js --forceExit --maxWorkers=4`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js demo_api_server/src/__tests__/enterpriseMcpNativeMode.test.js
git commit -m "feat(bff): agent path redeems a real ID-JAG when native mode is configured"
```

---

## Task 8: Render the new steps

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.jsx`, `demo_api_ui/src/services/traceGraph.js`
- Test: `demo_api_ui/src/components/__tests__/TokenChainDisplay.idJag.test.jsx`

**Interfaces:**
- Consumes: token events `id-jag-issued`, `id-jag-redeemed` (Task 7).

Without this the events emit into a chain that never draws them. **`demo_api_ui` uses vitest, not jest** — `expect` signatures differ, and `npx vitest` in a worktree resolves the wrong binary.

- [ ] **Step 1: Read how the existing steps are registered**

Run: `grep -n "id-jag\|token-exchange\|enterprise-managed" demo_api_ui/src/components/TokenChainDisplay.jsx demo_api_ui/src/services/traceGraph.js`

Add the two new step ids to the same label/icon/order structures the existing steps use. Do not invent a parallel mechanism.

- [ ] **Step 2: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TokenChainDisplay from '../TokenChainDisplay';

const events = [
  { step: 'user-token', label: 'User token', status: 'active' },
  { step: 'id-jag-issued', label: 'Enterprise IdP issued an ID-JAG', status: 'active' },
  { step: 'id-jag-redeemed', label: 'MCP Authorization Server redeemed the ID-JAG', status: 'active' },
  { step: 'tool-dispatched', label: 'Tool dispatched', status: 'active' },
];

describe('TokenChainDisplay ID-JAG steps', () => {
  it('renders both ID-JAG steps rather than dropping them', () => {
    render(<TokenChainDisplay events={events} />);
    expect(screen.getByText(/issued an ID-JAG/i)).toBeTruthy();
    expect(screen.getByText(/redeemed the ID-JAG/i)).toBeTruthy();
  });
});
```

> Match the real props of `TokenChainDisplay` — read its signature first; `events` here is illustrative.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/<your-worktree>/demo_api_ui run test:unit -- TokenChainDisplay.idJag`
Expected: FAIL — steps not rendered

- [ ] **Step 4: Register the steps, then re-run**

Expected: PASS

- [ ] **Step 5: Build gate**

Run: `npm --prefix <abs>/demo_api_ui run test:unit && npm --prefix <abs>/demo_api_ui run build`
Expected: both green

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.jsx demo_api_ui/src/services/traceGraph.js demo_api_ui/src/components/__tests__/TokenChainDisplay.idJag.test.jsx
git commit -m "feat(ui): render ID-JAG issue and redeem steps on the token chain"
```

---

## Task 9: MCP client declares the extension

**Files:**
- Modify: `langchain_agent/src/mcp/connection.py`
- Test: `langchain_agent/tests/test_mcp_extension_capability.py`

**Interfaces:**
- Produces: `_meta["io.modelcontextprotocol/clientCapabilities"]["extensions"]` on outbound requests.

The extension's first client requirement. Without it the client is not conformant even when the token flow is correct.

- [ ] **Step 1: Write the failing test**

```python
from src.mcp.connection import build_request_meta

EXT = "io.modelcontextprotocol/enterprise-managed-authorization"


def test_meta_declares_the_enterprise_managed_extension():
    meta = build_request_meta()
    caps = meta["io.modelcontextprotocol/clientCapabilities"]
    assert EXT in caps["extensions"]
    assert caps["extensions"][EXT] == {}


def test_meta_preserves_caller_supplied_fields():
    meta = build_request_meta({"progressToken": "abc"})
    assert meta["progressToken"] == "abc"
    assert "io.modelcontextprotocol/clientCapabilities" in meta
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd langchain_agent && python -m pytest tests/test_mcp_extension_capability.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_request_meta'`

- [ ] **Step 3: Write minimal implementation**

```python
ENTERPRISE_MANAGED_AUTH_EXT = "io.modelcontextprotocol/enterprise-managed-authorization"


def build_request_meta(base: dict | None = None) -> dict:
    """Per-request _meta declaring the extensions this client supports.

    The Enterprise-Managed Authorization extension requires the client to
    advertise support; extensions are opt-in and never active by default.
    """
    meta = dict(base or {})
    meta["io.modelcontextprotocol/clientCapabilities"] = {
        "extensions": {ENTERPRISE_MANAGED_AUTH_EXT: {}},
    }
    return meta
```

Then use `build_request_meta()` where the connection builds outbound request params.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd langchain_agent && python -m pytest tests/test_mcp_extension_capability.py -v`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/mcp/connection.py langchain_agent/tests/test_mcp_extension_capability.py
git commit -m "feat(agent): declare the enterprise-managed-authorization extension in _meta"
```

---

## Task 10: Revocation takes effect (Phase B mechanics)

**Files:**
- Modify: `demo_api_server/services/enterpriseMcpPolicyService.js` (`CACHE_TTL_MS` → configurable; revoke on DENY)
- Test: `demo_api_server/src/__tests__/enterpriseMcpRevocation.test.js`

**Interfaces:**
- Consumes: `enterprise_mcp_policy_cache_ttl_ms` (Task 2).
- Produces: `getCacheTtlMs(): number`; DENY revokes a held MCP token.

Two things currently make revocation unprovable: the 5-minute cache, and the already-issued access token.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../../services/pingOneUserService', () => ({
  environmentId: 'env-1', initialize: jest.fn(), makeRequest: jest.fn(),
}));
jest.mock('axios');

const axios = require('axios');
const configStore = require('../../services/configStore');
const pingOneUserService = require('../../services/pingOneUserService');
const policy = require('../../services/enterpriseMcpPolicyService');

describe('enterprise MCP revocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((k) => ({
      ff_enterprise_managed_mcp_auth: 'true',
      enterprise_mcp_allowed_groups: 'banking-agents',
      enterprise_mcp_policy_cache_ttl_ms: '0',
      enterprise_mcp_as_token_url: 'https://mcpserver.ping.demo:8080/token',
    }[k] || ''));
  });

  test('cache TTL is configurable and defaults to 5 minutes', () => {
    expect(policy.getCacheTtlMs()).toBe(0);
    configStore.getEffective.mockImplementation((k) =>
      k === 'enterprise_mcp_policy_cache_ttl_ms' ? '' : 'true');
    expect(policy.getCacheTtlMs()).toBe(300000);
  });

  test('group removal denies the very next check when TTL is 0', async () => {
    pingOneUserService.makeRequest.mockResolvedValueOnce({ _embedded: { groups: [{ name: 'banking-agents' }] } });
    const req = { session: { user: { oauthId: 'user-123', username: 'alice' } } };
    expect((await policy.checkPolicy(req)).allowed).toBe(true);

    pingOneUserService.makeRequest.mockResolvedValueOnce({ _embedded: { groups: [] } });
    const after = await policy.checkPolicy(req);
    expect(after.allowed).toBe(false);
    expect(after.code).toBe('enterprise_mcp_policy_denied');
  });

  test('a DENY revokes an MCP access token the session still holds', async () => {
    axios.post.mockResolvedValue({ data: {} });
    pingOneUserService.makeRequest.mockResolvedValue({ _embedded: { groups: [] } });
    const req = { session: { user: { oauthId: 'user-123', username: 'alice' }, mcpAccessToken: 'mcp.access.token' } };

    await policy.checkPolicy(req);

    expect(axios.post).toHaveBeenCalled();
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/revoke');
    expect(new URLSearchParams(body).get('token')).toBe('mcp.access.token');
    expect(req.session.mcpAccessToken).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseMcpRevocation.test.js --forceExit`
Expected: FAIL — `policy.getCacheTtlMs is not a function`

- [ ] **Step 3: Write minimal implementation**

Replace the fixed constant use with:

```javascript
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Cache TTL in ms. Default unchanged; demos lower it so revocation is visible. */
function getCacheTtlMs() {
  const raw = configStore.getEffective('enterprise_mcp_policy_cache_ttl_ms');
  if (raw === '' || raw === null || raw === undefined) return DEFAULT_CACHE_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CACHE_TTL_MS;
}

/**
 * Revoke an MCP access token the session still holds. Denying the next mint
 * does not invalidate a token already in hand, so revocation would otherwise
 * appear not to work until the token expired.
 */
async function revokeHeldMcpToken(req) {
  const token = req.session?.mcpAccessToken;
  const tokenUrl = String(configStore.getEffective('enterprise_mcp_as_token_url') || '').trim();
  if (!token || !tokenUrl) return;
  try {
    const axios = require('axios');
    await axios.post(
      tokenUrl.replace(/\/token$/, '/revoke'),
      new URLSearchParams({ token }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 },
    );
  } catch {
    // Best effort: the token is short-lived and the next mint is already denied.
  }
  req.session.mcpAccessToken = null;
}
```

Use `getCacheTtlMs()` where `CACHE_TTL_MS` was used, `await revokeHeldMcpToken(req)` in the DENY branch, and export both. Keep exporting `CACHE_TTL_MS` so existing importers do not break.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/enterpriseMcpRevocation.test.js src/__tests__/enterpriseMcpPolicyService.test.js --forceExit`
Expected: PASS — both suites

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/enterpriseMcpPolicyService.js demo_api_server/src/__tests__/enterpriseMcpRevocation.test.js
git commit -m "feat(bff): configurable policy cache TTL and token revoke on DENY"
```

---

## Task 11: UC39 and documentation

**Files:**
- Modify: `demo_api_server/config/useCases.js`, `demo_api_server/config/auth-requirements.json`, `demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js`
- Regenerate: `docs/use-cases/*.md`
- Test: `demo_api_server/src/__tests__/uc39Registration.test.js`

`UC39` is free — `UC38` is the current maximum. The use-case docs are **auto-generated**; there is no CI drift gate on them, so skipping regeneration fails nothing and silently staler the docs.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

const useCases = require('../../config/useCases');
const authRequirements = require('../../config/auth-requirements.json');

describe('UC39 registration', () => {
  const uc = (Array.isArray(useCases) ? useCases : useCases.useCases).find((u) => u.id === 'UC39');

  test('UC39 exists and is a controls-track use case', () => {
    expect(uc).toBeTruthy();
    expect(uc.track).toBe('controls');
    expect(uc.useCaseId).toBe('enterprise-mcp-revocation');
  });

  test('UC39 declares its auth level in the source of truth', () => {
    expect(authRequirements.useCases.UC39).toBe('user');
  });

  test('UC39 expects a denial, not a permit', () => {
    expect(uc.expectedOutcome).toBe('DENY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/uc39Registration.test.js --forceExit`
Expected: FAIL — `uc` is undefined

- [ ] **Step 3: Add UC39**

Insert after the `UC25` entry in `useCases.js`:

```javascript
  {
    id: 'UC39',
    useCaseId: 'enterprise-mcp-revocation',
    track: 'controls',
    title: 'Centralized MCP revocation',
    buyerStory: 'When someone leaves a team, IT revokes their MCP access in one console — not service by service.',
    pingOneSolution: 'Removing the user from the allowed PingOne group makes the enterprise IdP refuse to issue an ID-JAG on the next tool call, and any MCP token still held is revoked.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['user-token', 'enterprise-managed-mode'], activity: ['token', 'mcp'] },
    codeRefs: [
      'demo_api_server/services/enterpriseMcpPolicyService.js',
      'demo_api_server/routes/enterpriseIdp.js',
    ],
    maturity: 'flag:ff_enterprise_managed_mcp_auth',
    owasp: { threats: ['T8', 'T9'], sections: ['§4.1.1', '§8'] },
    whatToSay: 'Remove the user from the group in PingOne, run the same scenario again — the IdP refuses to mint, and access is gone everywhere at once.',
    advanced: false,
    match: { tool: 'get_balance' },
    whatLong: 'Demonstrates the centralized-revocation claim of the MCP Enterprise-Managed Authorization extension. With enterprise-managed mode on, policy is evaluated at the IdP before an ID-JAG is issued. Removing the user from the allowed PingOne group means the next tool call is denied at the IdP with enterprise_mcp_policy_denied, and any MCP access token the session still holds is revoked so it cannot outlive the decision. Lower enterprise_mcp_policy_cache_ttl_ms for a live demo; the default 5-minute cache would otherwise delay the effect.',
    businessValue: 'One console controls MCP access for every employee and every server — the offboarding story enterprises ask for first.',
    productRoles: {
      idp: 'Evaluates group membership and refuses to issue the ID-JAG when policy denies.',
    },
    primaryTool: 'get_account_balance',
    perVertical: READ_PER_VERTICAL,
  },
```

Add `"UC39": "user",` to `auth-requirements.json` beside `UC38`.

- [ ] **Step 4: Run test and the authz gate**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/uc39Registration.test.js --forceExit`
Expected: PASS, 3 tests

Run: `npm run authz:verify`
Expected: PASS — fails if UC39 is unlisted

- [ ] **Step 5: Regenerate the use-case docs**

Run: `cd demo_api_server && npm run use-cases:gen`
Expected: writes `docs/use-cases/enterprise-mcp-revocation.md` and updates the index and audit table

- [ ] **Step 6: Correct the education panel**

In `EnterpriseManagedAuthPanel.js`, retitle the roadmap section and move the two now-shipped items out of it. Only native PingOne ID-JAG issuance remains blocked:

```jsx
      <Section title="Roadmap (blocked on PingOne product)">
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li>Native ID-JAG issuance at PingOne. The demo IdP signs the assertion today; PingOne remains the authority for identity and group policy.</li>
        </ul>
      </Section>
```

Add the shipped items to the "When Enterprise-Managed MCP Auth is ON" list:

```jsx
          <li>With <code>ENTERPRISE_IDP_ISSUER</code> and <code>ENTERPRISE_IDP_JWKS_URL</code> set, a real signed <strong>ID-JAG</strong> is issued and redeemed at the MCP Authorization Server via the <code>jwt-bearer</code> grant — the token that carries the tool call.</li>
          <li>The MCP client declares the extension in its per-request <code>_meta</code> capabilities.</li>
```

Emoji allowlist applies — the existing `✅` is allowed; add no others.

- [ ] **Step 7: UI gate**

Run: `npm --prefix <abs>/demo_api_ui run test:unit && npm --prefix <abs>/demo_api_ui run build`
Expected: both green

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/config/useCases.js demo_api_server/config/auth-requirements.json \
        demo_api_server/src/__tests__/uc39Registration.test.js \
        demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js \
        docs/use-cases/
git commit -m "feat(demo): UC39 centralized MCP revocation, and correct the EMA roadmap"
```

---

## Task 12: Cross-service verification

**Files:** none — this task only runs gates.

- [ ] **Step 1: Topology gate**

Run: `npm run topology:verify`
Expected: PASS

- [ ] **Step 2: oauth-mcp full validate**

Run: `cd oauth-mcp && npm run typecheck && NODE_ENV=test npx jest src/oauth --forceExit`
Expected: PASS

- [ ] **Step 3: BFF enterprise suites**

Run:
```bash
cd demo_api_server && CI=true npx jest \
  src/__tests__/enterpriseIdpKey.test.js \
  src/__tests__/enterpriseIdpConfig.test.js \
  src/__tests__/enterpriseIdpRoutes.test.js \
  src/__tests__/idJagService.test.js \
  src/__tests__/enterpriseMcpNativeMode.test.js \
  src/__tests__/enterpriseMcpRevocation.test.js \
  src/__tests__/enterpriseMcpAuth.test.js \
  src/__tests__/enterpriseMcpPolicyService.test.js \
  src/__tests__/uc39Registration.test.js \
  --forceExit --maxWorkers=4
```
Expected: all PASS. Paste the result line — do not conclude from a piped exit status.

- [ ] **Step 4: Confirm the default path did not move**

With `enterprise_idp_issuer` and `enterprise_idp_jwks_url` unset, run UC25 and confirm the Token Chain still shows `idJagStandIn: true` and no `id-jag-*` steps. This is the guarantee in spec §6.

- [ ] **Step 5: Check for stray artifacts before staging**

Run: `git status --short`
A BFF jest run regenerates ~443 files. Stage explicitly; never `git add -A`.

- [ ] **Step 6: Deploy parity (spec §7)**

Verify enterprise mode on Docker **and** SE K8. In-cluster the BFF and `oauth-mcp` are separate pods, so `ENTERPRISE_IDP_JWKS_URL` must resolve from inside the `oauth-mcp` pod — a localhost URL will work under Docker and fail on the cluster.

---

## Self-Review Notes

**Spec coverage:** §4.1→T1, §4.2→T3, §4.3→T4+T5, §4.4→T7, §4.4b→T9, §4.5→T2, §4.6→docs in T11, §5.1→T11, §5.2/§5.3→T10, §6→T7 Step 1 + T12 Step 4, §7→every task + T12, §8→T11 Step 6, §9→file table.

**Known soft spots for the implementer:**
- Task 5's `OAuthRouter` constructor argument order and Task 7's function boundary are written from reading the code, but **read the real signatures before implementing** — both notes say so inline.
- Task 8's `TokenChainDisplay` props are illustrative; match the real component.
- Task 7 may need a no-behaviour-change extraction commit first. That is called out in-place.
