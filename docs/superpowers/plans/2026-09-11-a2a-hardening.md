# A2A Hop Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the A2A hop between the generalist agent and a vertical specialist carry a real delegated user identity, enforce it on every path, and sign the Agent Cards — meeting the A2A v1.0 security requirements without faking protections PingOne cannot provide.

**Architecture:** The generalist performs RFC 8693 Exchange #1 only and sends that delegated token (subject = user, `act` = generalist, audience = this one specialist) as the A2A `Authorization: Bearer`. The specialist validates it with a single validator used by both the in-process and HTTP paths, then performs Exchange #2 itself and makes the tool call, replying with data only. No token ever appears in an A2A payload.

**Tech Stack:** Node >= 22, CommonJS, Express 4.18, `@a2a-js/sdk` 1.0.1, jest 29.7 + supertest, Node built-in `crypto` (Ed25519).

**Spec:** `docs/superpowers/specs/2026-09-11-a2a-hardening-design.md`

## Global Constraints

- `demo_api_server` is **CommonJS** (`'use strict'` + `require`) — never ESM.
- **No new npm dependencies.** `jose` arrives transitively with `@a2a-js/sdk`; do not import it directly and do not add it to `package.json`. The SDK accepts Node `KeyObject`s, which is what we pass.
- Error response bodies use `{ error }`, never `{ message }`.
- Tests: `CI=true` is mandatory. Run jest as `./node_modules/.bin/jest` from `demo_api_server` — `npx jest` resolves the wrong runtime in this service.
- New specs go in `demo_api_server/tests/`; existing specs in `src/__tests__/` are extended in place.
- Work on branch `worktree-a2a-hardening` in this worktree. Stage explicit paths with `git add <files>` — never `git add -A`.
- UI copy must respect the REGRESSION_PLAN §0 emoji allowlist.
- Token-chain event `id` values must not change (`a2a-exchange1`, `a2a-exchange2`, `a2a-agent-card`, `a2a-protocol-bearer`, `a2a-protocol-message`) — the Token Chain UI keys off them.
- All three oauthService helpers return a **bare token string**: `getAiAgentClientCredentialsToken()`, `getClientCredentialsTokenAs(...)`, `performTokenExchangeAs(...)`.

---

### Task 1: The inbound validator

**Files:**
- Modify: `demo_api_server/middleware/a2aPingOneBearer.js` (whole file — currently 92 lines)
- Modify: `demo_api_server/services/a2aProtocolServer.js:112-119` (the middleware mount)
- Modify: `demo_api_server/src/__tests__/a2aProtocolCards.test.js` (it imports `requireA2aPingOneBearer` directly, which becomes a factory)
- Test: `demo_api_server/tests/a2aBearerValidation.test.js` (create)

**Interfaces:**
- Consumes: `resolveA2aConfig(cfg, specialist)` and `countActDepth(act)` from `services/a2aDelegationService` (both already exported, lines 649 and 659); `validateToken(token, { jwksUri, issuer })` from `services/tokenValidationService`; `specialistForVertical(vertical)` from `config/a2aSpecialists`.
- Produces:
  - `verifyA2aBearer(token, { vertical, cfg, deps })` → `Promise<claims>`; throws `A2aAuthError`.
  - `class A2aAuthError extends Error` with `.code` (`'invalid_token'` | `'insufficient_scope'`), `.status` (401 | 403), `.challenge` (the `WWW-Authenticate` value), `.logDetail` (never sent to the client).
  - `requireA2aPingOneBearer(vertical)` → express middleware (a **factory** now, not a middleware itself). Sets `req.a2aPingOne = { token, claims, clientId, userSub }`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/a2aBearerValidation.test.js`:

```js
'use strict';

jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));

const { validateToken } = require('../services/tokenValidationService');
const { verifyA2aBearer, A2aAuthError } = require('../middleware/a2aPingOneBearer');

// 'investment' is a real specialist (config/a2aSpecialists.js) with appKey 'investment'.
const VERTICAL = 'investment';
const GENERALIST = 'generalist-client-id';
const AUD = 'https://a2a-intermediate.investment.example';

// Minimal configStore fake: only getEffective is read by resolveA2aConfig and the validator.
function fakeCfg(overrides = {}) {
  const values = {
    pingone_ai_agent_client_id: GENERALIST,
    a2a_intermediate_audience_investment: AUD,
    a2a_gateway_audience: 'https://a2a-gateway.example',
    pingone_investment_agent_client_id: 'specialist-client-id',
    pingone_investment_agent_client_secret: 'shh',
    ...overrides,
  };
  return { getEffective: (k) => values[k] || '' };
}

const GOOD_CLAIMS = {
  sub: 'user-123',
  aud: [AUD],
  scope: 'agent:invoke:investment invest:read',
  act: { client_id: GENERALIST },
};

function run(claims, cfg = fakeCfg()) {
  validateToken.mockResolvedValueOnce(claims);
  return verifyA2aBearer('header.payload.sig', { vertical: VERTICAL, cfg });
}

async function expectRejection(claims, { code, status }, cfg) {
  await expect(run(claims, cfg)).rejects.toMatchObject({ code, status });
  await expect(run(claims, cfg)).rejects.toBeInstanceOf(A2aAuthError);
}

describe('verifyA2aBearer', () => {
  beforeEach(() => jest.clearAllMocks());

  test('accepts a delegated token for this specialist and returns its claims', async () => {
    const claims = await run(GOOD_CLAIMS);
    expect(claims.sub).toBe('user-123');
  });

  test('rejects a token that fails PingOne signature verification', async () => {
    validateToken.mockRejectedValueOnce(new Error('signature verification failed'));
    await expect(
      verifyA2aBearer('bad.token.sig', { vertical: VERTICAL, cfg: fakeCfg() }),
    ).rejects.toMatchObject({ code: 'invalid_token', status: 401 });
  });

  test('rejects a token audienced to a DIFFERENT specialist', async () => {
    await expectRejection(
      { ...GOOD_CLAIMS, aud: ['https://a2a-intermediate.tax.example'] },
      { code: 'invalid_token', status: 401 },
    );
  });

  test('rejects a token missing the agent:invoke scope for this specialist', async () => {
    await expectRejection(
      { ...GOOD_CLAIMS, scope: 'invest:read' },
      { code: 'insufficient_scope', status: 403 },
    );
  });

  test('rejects a bare client_credentials token (no act, so no user behind it)', async () => {
    const { act, ...noAct } = GOOD_CLAIMS;
    await expectRejection(noAct, { code: 'invalid_token', status: 401 });
  });

  test('rejects an Exchange #2 token replayed into the hop (act nested two deep)', async () => {
    await expectRejection(
      { ...GOOD_CLAIMS, act: { client_id: 'specialist-client-id', act: { client_id: GENERALIST } } },
      { code: 'invalid_token', status: 401 },
    );
  });

  test('rejects an actor that is not the generalist', async () => {
    await expectRejection(
      { ...GOOD_CLAIMS, act: { client_id: 'some-other-agent' } },
      { code: 'invalid_token', status: 401 },
    );
  });

  test('falls back to act.sub when PingOne omits act.client_id', async () => {
    const claims = await run({ ...GOOD_CLAIMS, act: { sub: GENERALIST } });
    expect(claims.sub).toBe('user-123');
  });

  test('carries a WWW-Authenticate challenge and leaks no reason to the client', async () => {
    validateToken.mockResolvedValueOnce({ ...GOOD_CLAIMS, scope: 'invest:read' });
    const err = await verifyA2aBearer('t.t.t', { vertical: VERTICAL, cfg: fakeCfg() }).catch((e) => e);
    expect(err.challenge).toBe(
      'Bearer error="insufficient_scope", scope="agent:invoke:investment"',
    );
    expect(err.logDetail).toMatch(/scope/i);
    expect(err.message).not.toMatch(/agent:invoke/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/a2aBearerValidation --forceExit`
Expected: FAIL — `verifyA2aBearer is not a function`.

- [ ] **Step 3: Write the implementation**

Replace the body of `demo_api_server/middleware/a2aPingOneBearer.js` with:

```js
'use strict';

/**
 * PingOne bearer gate for the A2A hop (A2A v1.0 §7.3-7.5).
 *
 * The hop carries the Exchange #1 DELEGATED token: subject = the user,
 * act = the generalist, audience = this one specialist's intermediate resource.
 * A bare client_credentials token is rejected — it proves no user.
 *
 * Both the HTTP route and the in-process client call verifyA2aBearer, so there
 * is no path into a specialist that skips authentication.
 */

const { validateToken } = require('../services/tokenValidationService');
const oauthConfig = require('../config/oauth');
const { specialistForVertical } = require('../config/a2aSpecialists');

function defaultConfigStore() {
  return require('../services/configStore');
}
function defaultDelegation() {
  return require('../services/a2aDelegationService');
}

class A2aAuthError extends Error {
  /**
   * @param {'invalid_token'|'insufficient_scope'} code
   * @param {{ status: number, challenge: string, logDetail: string }} info
   */
  constructor(code, { status, challenge, logDetail }) {
    // Deliberately generic: the specific reason goes to the log, not the client
    // (spec §3.3.2 — MUST NOT reveal what the caller is not authorized to see).
    super(code === 'insufficient_scope' ? 'insufficient_scope' : 'unauthorized');
    this.name = 'A2aAuthError';
    this.code = code;
    this.status = status;
    this.challenge = challenge;
    this.logDetail = logDetail;
  }
}

function invalidToken(logDetail) {
  return new A2aAuthError('invalid_token', {
    status: 401,
    challenge: 'Bearer error="invalid_token"',
    logDetail,
  });
}

function insufficientScope(scope, logDetail) {
  return new A2aAuthError('insufficient_scope', {
    status: 403,
    challenge: `Bearer error="insufficient_scope", scope="${scope}"`,
    logDetail,
  });
}

/** aud may be a string or an array (PingOne emits either). */
function audienceMatches(aud, expected) {
  if (!expected) return false;
  const list = Array.isArray(aud) ? aud : [aud];
  return list.filter(Boolean).map(String).includes(String(expected));
}

/** RFC 8693 §4.1 canonical actor is act.sub; PingOne also emits act.client_id. */
function actorIdOf(act) {
  if (!act || typeof act !== 'object') return null;
  return String(act.client_id || act.sub || '') || null;
}

/**
 * Validate an inbound A2A bearer for one specialist.
 * @param {string} token
 * @param {{ vertical: string, cfg?: object, deps?: object }} opts
 * @returns {Promise<object>} validated claims
 * @throws {A2aAuthError}
 */
async function verifyA2aBearer(token, { vertical, cfg: cfgArg, deps = {} } = {}) {
  if (!token) throw invalidToken('no bearer presented');

  const specialist = specialistForVertical(vertical);
  if (!specialist) throw invalidToken(`no specialist for vertical "${vertical}"`);

  const cfg = cfgArg || deps.configStore || defaultConfigStore();
  const delegation = deps.delegation || defaultDelegation();
  const { resolveA2aConfig, countActDepth } = delegation;
  const c = resolveA2aConfig(cfg, specialist);
  const requiredScope = `agent:invoke:${specialist.appKey}`;

  // 1. Signature (RS256 via PingOne JWKS), issuer, exp, nbf.
  let claims;
  try {
    claims = await validateToken(token, {
      jwksUri: oauthConfig.jwksEndpoint,
      issuer: oauthConfig.issuer,
    });
  } catch (err) {
    throw invalidToken(`signature/issuer/expiry check failed: ${err.message}`);
  }
  if (!claims || typeof claims !== 'object') throw invalidToken('token is not a decodable JWT');

  // 2. Audience — RFC 8707. A token for specialist A must not work on B.
  if (!audienceMatches(claims.aud, c.intermediateAud)) {
    throw invalidToken(
      `aud ${JSON.stringify(claims.aud)} does not include this specialist's ${c.intermediateAud}`,
    );
  }

  // 3. Scope.
  const scopes = String(claims.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(requiredScope)) {
    throw insufficientScope(requiredScope, `scope "${claims.scope || ''}" lacks ${requiredScope}`);
  }

  // 4. Delegation shape: act present, exactly one level deep.
  //    No act  → a machine token with no user behind it.
  //    Depth 2 → an Exchange #2 token replayed back into the hop.
  const depth = countActDepth(claims.act);
  if (depth !== 1) throw invalidToken(`act chain depth ${depth}, expected exactly 1`);

  // 5. Actor must be the generalist — only it may call a specialist.
  const generalist = String(cfg.getEffective('pingone_ai_agent_client_id') || '');
  const actor = actorIdOf(claims.act);
  if (!generalist || actor !== generalist) {
    throw invalidToken(`actor ${actor || '(none)'} is not the generalist ${generalist || '(unset)'}`);
  }

  if (!claims.sub) throw invalidToken('no subject (sub) on the delegated token');
  return claims;
}

/**
 * Express middleware factory for one vertical's JSON-RPC mount.
 * @param {string} vertical
 */
function requireA2aPingOneBearer(vertical) {
  return async function a2aBearerGate(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const token = match[1].trim();
      const claims = await verifyA2aBearer(token, { vertical });
      req.a2aPingOne = {
        token,
        claims,
        clientId: actorIdOf(claims.act),
        userSub: String(claims.sub),
      };
      return next();
    } catch (err) {
      const e = err instanceof A2aAuthError ? err : invalidToken(err.message);
      console.warn('[a2a] bearer rejected for %s: %s', vertical, e.logDetail);
      res.set('WWW-Authenticate', e.challenge);
      return res.status(e.status).json({ error: e.message });
    }
  };
}

/**
 * @a2a-js UserBuilder: the A2A user is the USER the token is for, with the
 * generalist recorded as the actor. Call only after requireA2aPingOneBearer.
 */
function pingOneA2aUserBuilder(req) {
  const info = req.a2aPingOne;
  const name = info?.userSub || 'anonymous';
  const authed = !!info?.userSub;
  return Promise.resolve({
    get isAuthenticated() {
      return authed;
    },
    get userName() {
      return name;
    },
    get actor() {
      return info?.clientId || null;
    },
  });
}

module.exports = {
  verifyA2aBearer,
  requireA2aPingOneBearer,
  pingOneA2aUserBuilder,
  A2aAuthError,
};
```

- [ ] **Step 4: Update the two call sites of the now-factory middleware**

In `demo_api_server/services/a2aProtocolServer.js`, the mount becomes (note `requireA2aPingOneBearer(vertical)`):

```js
    router.use(
      base,
      requireA2aPingOneBearer(vertical),
      jsonRpcHandler({
        requestHandler: handler,
        userBuilder: pingOneA2aUserBuilder,
      }),
    );
```

In `demo_api_server/src/__tests__/a2aProtocolCards.test.js`, every place that mounts the middleware directly changes from `requireA2aPingOneBearer` to `requireA2aPingOneBearer('investment')` (use whichever vertical that test already exercises), and `validateToken` must now resolve claims shaped like `GOOD_CLAIMS` above — a bare `{ client_id }` payload will now be rejected by design. Run the file and fix each assertion it reports.

- [ ] **Step 5: Run both suites to verify they pass**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/a2aBearerValidation src/__tests__/a2aProtocolCards --forceExit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/middleware/a2aPingOneBearer.js demo_api_server/services/a2aProtocolServer.js demo_api_server/src/__tests__/a2aProtocolCards.test.js demo_api_server/tests/a2aBearerValidation.test.js
git commit -m "feat(a2a): validate the inbound hop bearer (audience, scope, actor, act depth)"
```

---

### Task 2: Signed Agent Cards

**Files:**
- Create: `demo_api_server/services/a2aCardSigningService.js`
- Modify: `demo_api_server/services/a2aProtocolServer.js` (card route + JWKS route)
- Test: `demo_api_server/tests/a2aCardSigning.test.js` (create)

**Interfaces:**
- Consumes: `buildSpecialistAgentCard(vertical, cfg)` and `publicApiBase(cfg)` from `services/a2aAgentCardService`; `jwkThumbprint(jwk)` from `services/dpopKeyService` (already exported, handles OKP keys); `generateAgentCardSignature`, `verifyAgentCardSignature` from `@a2a-js/sdk`.
- Produces:
  - `getCardSigningKey()` → `{ privateKey, publicJwk, kid }` (process-wide Ed25519, memoized)
  - `publicJwks()` → `{ keys: [ { kty, crv, x, kid, use: 'sig', alg: 'EdDSA' } ] }`
  - `getSignedCard(vertical, cfg)` → `Promise<AgentCard>` (memoized per vertical)
  - `cardVerifier(cfg)` → `(card) => Promise<void>`; rejects a foreign-origin `jku` and an unknown `kid`

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/a2aCardSigning.test.js`:

```js
'use strict';

const {
  getCardSigningKey,
  publicJwks,
  getSignedCard,
  cardVerifier,
} = require('../services/a2aCardSigningService');

const CFG = { getEffective: (k) => (k === 'PUBLIC_APP_URL' ? 'https://api.ping.demo:3001' : '') };

describe('A2A Agent Card signing', () => {
  test('publishes one Ed25519 verification key whose kid matches the signature', async () => {
    const jwks = publicJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });
    expect(jwks.keys[0].kid).toBe(getCardSigningKey().kid);
  });

  test('signs a card and verifies it', async () => {
    const card = await getSignedCard('investment', CFG);
    expect(card.signatures.length).toBeGreaterThan(0);
    await expect(cardVerifier(CFG)(card)).resolves.toBeUndefined();
  });

  test('pins the jku to our own origin in the PROTECTED header', async () => {
    const card = await getSignedCard('investment', CFG);
    const header = JSON.parse(
      Buffer.from(card.signatures[0].protected, 'base64url').toString('utf-8'),
    );
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(getCardSigningKey().kid);
    expect(header.jku).toBe('https://api.ping.demo:3001/a2a/specialists/.well-known/jwks.json');
  });

  test('rejects a tampered card', async () => {
    const card = await getSignedCard('investment', CFG);
    const tampered = { ...card, name: 'Attacker Agent' };
    await expect(cardVerifier(CFG)(tampered)).rejects.toThrow();
  });

  test('refuses a jku pointing at a foreign origin (key substitution / SSRF)', async () => {
    const card = await getSignedCard('investment', CFG);
    const header = JSON.parse(
      Buffer.from(card.signatures[0].protected, 'base64url').toString('utf-8'),
    );
    const forged = {
      ...card,
      signatures: [
        {
          ...card.signatures[0],
          protected: Buffer.from(
            JSON.stringify({ ...header, jku: 'https://evil.example/jwks.json' }),
          ).toString('base64url'),
        },
      ],
    };
    await expect(cardVerifier(CFG)(forged)).rejects.toThrow(/jku/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/a2aCardSigning --forceExit`
Expected: FAIL — cannot find module `../services/a2aCardSigningService`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_server/services/a2aCardSigningService.js`:

```js
'use strict';

/**
 * Agent Card signing (A2A v1.0 §8.4) — JWS over the SDK's RFC 8785
 * canonicalization, with an Ed25519 key of our own.
 *
 * The key is process-wide and regenerated on restart. That is sound here
 * because the same process serves both the cards and the JWKS; a persistent key
 * matters only once third parties cache our cards (see TECH_DEBT).
 *
 * `jose` is NOT imported: the SDK accepts a Node KeyObject, so this adds no
 * dependency.
 */

const crypto = require('node:crypto');
const {
  generateAgentCardSignature,
  verifyAgentCardSignature,
} = require('@a2a-js/sdk');
const { jwkThumbprint } = require('./dpopKeyService');
const { buildSpecialistAgentCard, publicApiBase } = require('./a2aAgentCardService');

let _key = null;
const _signed = new Map();

/** Process-wide Ed25519 card-signing key. Separate from the Web Bot Auth key: one key, one purpose. */
function getCardSigningKey() {
  if (!_key) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicJwk = publicKey.export({ format: 'jwk' }); // { kty:'OKP', crv:'Ed25519', x }
    _key = { privateKey, publicKey, publicJwk, kid: jwkThumbprint(publicJwk) };
  }
  return _key;
}

/** JWKS document served next to the cards. */
function publicJwks() {
  const key = getCardSigningKey();
  return {
    keys: [{ ...key.publicJwk, kid: key.kid, use: 'sig', alg: 'EdDSA' }],
  };
}

/** Absolute URL of the JWKS document (also the `jku` we sign into the header). */
function jwksUrl(cfg) {
  return `${publicApiBase(cfg)}/a2a/specialists/.well-known/jwks.json`;
}

/**
 * Build and sign one specialist's Agent Card. Memoized per vertical — the card
 * is deterministic for a given key and config.
 * @returns {Promise<object|null>} signed card, or null when the vertical has no specialist
 */
async function getSignedCard(vertical, cfg) {
  if (_signed.has(vertical)) return _signed.get(vertical);
  const card = buildSpecialistAgentCard(vertical, cfg);
  if (!card) return null;
  const key = getCardSigningKey();
  const signer = generateAgentCardSignature(key.privateKey, {
    alg: 'EdDSA',
    kid: key.kid,
    typ: 'JOSE',
    jku: jwksUrl(cfg),
  });
  const signed = await signer(card);
  _signed.set(vertical, signed);
  return signed;
}

/**
 * Verifier that trusts only OUR key: a `jku` from any other origin is refused
 * outright and never fetched, which blocks key substitution and SSRF.
 */
function cardVerifier(cfg) {
  const expectedJku = jwksUrl(cfg);
  return verifyAgentCardSignature(async (kid, jku) => {
    if (jku && String(jku) !== expectedJku) {
      throw new Error(`refusing foreign jku ${jku} (expected ${expectedJku})`);
    }
    const key = getCardSigningKey();
    if (kid !== key.kid) throw new Error(`unknown card-signing kid ${kid}`);
    return key.publicKey;
  });
}

/** Test seam: drop the memoized cards (e.g. after a config change). */
function _resetSignedCards() {
  _signed.clear();
}

module.exports = {
  getCardSigningKey,
  publicJwks,
  getSignedCard,
  cardVerifier,
  jwksUrl,
  _resetSignedCards,
};
```

- [ ] **Step 4: Serve the signed card and the JWKS**

In `demo_api_server/services/a2aProtocolServer.js`, add the requires:

```js
const { getSignedCard, publicJwks } = require('./a2aCardSigningService');
```

Inside `createA2aProtocolRouter`, before the per-vertical loop, add the JWKS route:

```js
  // Verification key for the Agent Card signatures (A2A v1.0 §8.4). Public, like the cards.
  router.get('/.well-known/jwks.json', (_req, res) => res.json(publicJwks()));
```

Then replace the card mount inside the loop. Delete the `agentCardHandler(...)` registration and use:

```js
    router.get(`${base}/.well-known/agent-card.json`, async (_req, res) => {
      const cfg = typeof getCfg === 'function' ? getCfg() : getCfg;
      const card = await getSignedCard(vertical, cfg);
      if (!card) return res.status(404).json({ error: 'no_specialist' });
      return res.json(card);
    });
```

The now-unused `agentCardHandler` import must be removed from the destructured
`require('@a2a-js/sdk/server/express')` — leaving it breaks `npm run lint`.
`DefaultRequestHandler` keeps the unsigned card; only the published document and
the client's verification use the signed one.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/a2aCardSigning src/__tests__/a2aProtocolCards --forceExit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/a2aCardSigningService.js demo_api_server/services/a2aProtocolServer.js demo_api_server/tests/a2aCardSigning.test.js
git commit -m "feat(a2a): sign Agent Cards and publish the verification JWKS"
```

---

### Task 3: Split the exchange into generalist and specialist halves

**Files:**
- Modify: `demo_api_server/services/a2aDelegationService.js:284-560` (`delegateToSpecialist`) and the exports block at `:648`
- Test: `demo_api_server/src/__tests__/a2aDelegationService.test.js` (extend)

**Interfaces:**
- Consumes: `resolveA2aConfig`, `deriveSpecialistScopes`, `buildA2aEvent`, `runExchange`, `countActDepth` (all already in this file).
- Produces:
  - `exchangeAsGeneralist(req, { vertical, subtask, tool, tokenEvents, deps })` → `Promise<{ token, tokenEvents, userSub, vertical, specialist, specialistAppKey, tool, scopes, error? }>` — `token` is **tAgent1**, the hop bearer.
  - `exchangeAsSpecialist(subjectToken, { vertical, tool, tokenEvents, deps })` → `Promise<{ token, claims, actChainDepth, scopes, trustAssertion, error? }>` — `token` is the nested-act token.
  - `delegateToSpecialist(req, opts)` keeps its current signature and return shape, now implemented as the two calls in sequence. Its only remaining caller is the policy probe in `routes/groupMembership.js:164`.

**Notes for the implementer:**
- `exchangeAsGeneralist` keeps, unchanged and in this order: the specialist lookup, the tool allowlist rejection (`:311-320`), `deriveSpecialistScopes`, the credential and audience guards (`:326-334`), the session-bearer guard (`:336-339`), the `user-token` event (`:346-353`), the `a2a-agent1-actor` event and Exchange #1 plus its `a2a-exchange1` event (`:357-401`).
- `exchangeAsSpecialist` takes over from `:410`: the `a2a-agent2-actor` event, Exchange #2, the `a2a-exchange2` event, and the Verified Trust block (`:499-527`), which stays soft-fail.
- `exchangeAsSpecialist` re-resolves its own config via `resolveA2aConfig` rather than receiving `c` from the generalist — client secrets must not travel in a return value.
- Do **not** call `sendA2aProtocolHandoff` from here any more; Task 5 moves that to the caller.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_server/src/__tests__/a2aDelegationService.test.js`:

```js
describe('split exchanges', () => {
  // Mirrors the fakes this file already uses for delegateToSpecialist.
  const deps = () => ({
    oauthService: {
      getAiAgentClientCredentialsToken: jest.fn().mockResolvedValue('AGENT1.ACTOR'),
      getClientCredentialsTokenAs: jest.fn().mockResolvedValue('AGENT2.ACTOR'),
      performTokenExchangeAs: jest
        .fn()
        .mockResolvedValueOnce('T.AGENT1')
        .mockResolvedValueOnce('T.NESTED'),
    },
    configStore: {
      getEffective: (k) =>
        ({
          pingone_ai_agent_client_id: 'gen-id',
          pingone_ai_agent_client_secret: 'gen-secret',
          pingone_investment_agent_client_id: 'spec-id',
          pingone_investment_agent_client_secret: 'spec-secret',
          a2a_intermediate_audience_investment: 'https://intermediate.example',
          a2a_gateway_audience: 'https://gateway.example',
        })[k] || '',
    },
    getSessionBearerForMcp: () => 'USER.TOKEN',
    scopeTopology: { a2aDelegatedScope: () => 'invest:read', toolScopes: () => ['invest:read'] },
    verifiedTrustService: { isEnabled: () => false },
  });

  test('the generalist half returns the hop bearer and stops before Exchange #2', async () => {
    const svc = require('../../services/a2aDelegationService');
    const d = deps();
    const tokenEvents = [];
    const out = await svc.exchangeAsGeneralist({}, {
      vertical: 'investment', tool: 'get_portfolio_summary', tokenEvents, deps: d,
    });

    expect(out.error).toBeUndefined();
    expect(out.token).toBe('T.AGENT1');
    expect(d.oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(1);
    expect(tokenEvents.map((e) => e.id)).toEqual(
      expect.arrayContaining(['user-token', 'a2a-agent1-actor', 'a2a-exchange1']),
    );
    expect(tokenEvents.some((e) => e.id === 'a2a-exchange2')).toBe(false);
  });

  test('the specialist half exchanges the hop bearer for the nested-act token', async () => {
    const svc = require('../../services/a2aDelegationService');
    const d = deps();
    d.oauthService.performTokenExchangeAs = jest.fn().mockResolvedValue('T.NESTED');
    const tokenEvents = [];
    const out = await svc.exchangeAsSpecialist('T.AGENT1', {
      vertical: 'investment', tool: 'get_portfolio_summary', tokenEvents, deps: d,
    });

    expect(out.token).toBe('T.NESTED');
    // The hop bearer is the SUBJECT of Exchange #2, with the specialist as actor.
    expect(d.oauthService.performTokenExchangeAs).toHaveBeenCalledWith(
      'T.AGENT1', 'AGENT2.ACTOR', 'spec-id', 'spec-secret',
      'https://gateway.example', ['invest:read'], 'post',
    );
    expect(tokenEvents.map((e) => e.id)).toEqual(
      expect.arrayContaining(['a2a-agent2-actor', 'a2a-exchange2']),
    );
  });

  test('delegateToSpecialist still composes both halves for the policy probe', async () => {
    const svc = require('../../services/a2aDelegationService');
    const out = await svc.delegateToSpecialist({}, {
      vertical: 'investment', tool: 'get_portfolio_summary', tokenEvents: [], deps: deps(),
      skipProtocolHandoff: true,
    });
    expect(out.token).toBe('T.NESTED');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest src/__tests__/a2aDelegationService --forceExit`
Expected: FAIL — `svc.exchangeAsGeneralist is not a function`.

- [ ] **Step 3: Implement the split**

Refactor `delegateToSpecialist` into the two functions per the notes above, then compose:

```js
async function delegateToSpecialist(req, opts = {}) {
  const first = await exchangeAsGeneralist(req, opts);
  if (first.error || !first.token) return first;
  const second = await exchangeAsSpecialist(first.token, { ...opts, tokenEvents: first.tokenEvents });
  if (second.error) return { ...first, ...second, token: null };
  return { ...first, ...second };
}
```

Add both names to the exports block at `:648`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest src/__tests__/a2aDelegationService --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/a2aDelegationService.js demo_api_server/src/__tests__/a2aDelegationService.test.js
git commit -m "refactor(a2a): split delegation into generalist and specialist exchanges"
```

---

### Task 4: The specialist runs Exchange #2 and the tool call

**Files:**
- Modify: `demo_api_server/services/a2aProtocolServer.js` (`makeSpecialistExecutor`, `createSpecialistProtocolHandler`)
- Test: `demo_api_server/tests/a2aSpecialistExecutor.test.js` (create)

**Interfaces:**
- Consumes: `exchangeAsSpecialist` (Task 3); `executeBffToolWithToken({ name, args, req, tokenEvents, sessionId, suppliedToken, suppliedUserSub })` → JSON **string** from `services/bffMcpToolExecutor`; `verticalDispatch.toolSchemasFor` / `executeToolFor`.
- Produces:
  - `createSpecialistProtocolHandler(vertical, cfg, ctx)` — `ctx` is `{ req, tokenEvents, sessionId, claims, toolArgs }`, supplied per call.
  - `assertSkillAllowed(specialist, tool)` → throws when the tool is not on the specialist's allowlist.
  - The A2A reply: **one text part** carrying `JSON.stringify({ result, toolError })`, plus message metadata `{ vertical, specialist, specialistAppKey, actChainDepth, scopes, toolError, demoLayer: 'a2a-protocol-wire' }`. A text part is used deliberately — the repo has a proven part shape for text, and inventing a data-part union tag is how a wrong API call gets shipped.

**Notes for the implementer:**
- The local-serve fallback moves here **unchanged in its conditions**: only when the tool result is `error === 'mcp_error'` **and** `String(gatewayDecision).toUpperCase() === 'PERMIT'` **and** the vertical plugin owns the tool. Call `verticalDispatch.executeToolFor` directly — never `resolveExecuteTool`, which re-enters A2A and recurses forever. This is REGRESSION_PLAN §1 locked behaviour.
- `userId` for local serve: `ctx.req?.session?.user?.id || ctx.claims?.sub || 'anon'`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/a2aSpecialistExecutor.test.js`:

```js
'use strict';

jest.mock('../services/a2aDelegationService', () => ({
  ...jest.requireActual('../services/a2aDelegationService'),
  exchangeAsSpecialist: jest.fn(),
}));
jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffToolWithToken: jest.fn(),
}));

const { exchangeAsSpecialist } = require('../services/a2aDelegationService');
const { executeBffToolWithToken } = require('../services/bffMcpToolExecutor');
const { makeSpecialistExecutor, assertSkillAllowed } = require('../services/a2aProtocolServer');
const { specialistForVertical } = require('../config/a2aSpecialists');

const SPECIALIST = specialistForVertical('investment');
const TOOL = SPECIALIST.tools[0];

function fakeRequestContext(text) {
  return {
    contextId: 'c1',
    taskId: 't1',
    userMessage: {
      parts: [{ content: { $case: 'text', value: text } }],
      metadata: { vertical: 'investment', tool: TOOL },
    },
  };
}

function capture() {
  const published = [];
  return { published, eventBus: { publish: (e) => published.push(e) } };
}

function replyOf(published) {
  const text = published[0].parts
    .map((p) => (p?.content?.$case === 'text' ? p.content.value : ''))
    .join('');
  return { payload: JSON.parse(text), metadata: published[0].metadata };
}

describe('specialist A2A executor', () => {
  beforeEach(() => jest.clearAllMocks());

  test('runs Exchange #2 then the tool, and returns DATA with no token', async () => {
    exchangeAsSpecialist.mockResolvedValue({
      token: 'T.NESTED', claims: {}, actChainDepth: 2, scopes: ['invest:read'],
    });
    executeBffToolWithToken.mockResolvedValue(JSON.stringify({ positions: [{ symbol: 'VTI' }] }));

    const ctx = { req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1', claims: { sub: 'u1' }, toolArgs: {} };
    const exec = makeSpecialistExecutor(SPECIALIST, 'investment', { subjectToken: 'T.AGENT1', ctx });
    const { published, eventBus } = capture();
    await exec.execute(fakeRequestContext('positions'), eventBus);

    expect(exchangeAsSpecialist).toHaveBeenCalledWith('T.AGENT1', expect.objectContaining({ vertical: 'investment', tool: TOOL }));
    expect(executeBffToolWithToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: TOOL, suppliedToken: 'T.NESTED' }),
    );

    const { payload, metadata } = replyOf(published);
    expect(payload.result).toEqual({ positions: [{ symbol: 'VTI' }] });
    expect(payload.toolError).toBeNull();
    expect(metadata.actChainDepth).toBe(2);
    // No credential may appear anywhere in the reply.
    expect(JSON.stringify(published[0])).not.toMatch(/T\.NESTED|T\.AGENT1/);
  });

  test('serves locally only when the gateway recorded a PERMIT', async () => {
    const verticalDispatch = require('../services/verticalDispatch');
    exchangeAsSpecialist.mockResolvedValue({ token: 'T.NESTED', claims: {}, actChainDepth: 2, scopes: [] });
    executeBffToolWithToken.mockResolvedValue(
      JSON.stringify({ error: 'mcp_error', message: 'HTTP 502', gatewayDecision: 'PERMIT' }),
    );
    const schemas = jest.spyOn(verticalDispatch, 'toolSchemasFor').mockReturnValue([{ name: TOOL }]);
    const local = jest.spyOn(verticalDispatch, 'executeToolFor').mockResolvedValue({ result: { ok: 1 } });

    const ctx = { req: { sessionID: 's1', session: { user: { id: 'u1' } } }, tokenEvents: [], sessionId: 's1', claims: { sub: 'u1' }, toolArgs: {} };
    const exec = makeSpecialistExecutor(SPECIALIST, 'investment', { subjectToken: 'T.AGENT1', ctx });
    const { published, eventBus } = capture();
    await exec.execute(fakeRequestContext('positions'), eventBus);

    expect(local).toHaveBeenCalledTimes(1);
    expect(replyOf(published).payload.result).toEqual({ ok: 1 });
    schemas.mockRestore();
    local.mockRestore();
  });

  test('does NOT serve locally without a PERMIT', async () => {
    const verticalDispatch = require('../services/verticalDispatch');
    exchangeAsSpecialist.mockResolvedValue({ token: 'T.NESTED', claims: {}, actChainDepth: 2, scopes: [] });
    executeBffToolWithToken.mockResolvedValue(JSON.stringify({ error: 'mcp_error', message: 'socket hang up' }));
    const schemas = jest.spyOn(verticalDispatch, 'toolSchemasFor').mockReturnValue([{ name: TOOL }]);
    const local = jest.spyOn(verticalDispatch, 'executeToolFor').mockResolvedValue({ result: { ok: 1 } });

    const ctx = { req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1', claims: { sub: 'u1' }, toolArgs: {} };
    const exec = makeSpecialistExecutor(SPECIALIST, 'investment', { subjectToken: 'T.AGENT1', ctx });
    const { published, eventBus } = capture();
    await exec.execute(fakeRequestContext('positions'), eventBus);

    expect(local).not.toHaveBeenCalled();
    expect(replyOf(published).payload.toolError).toBe('mcp_error');
    schemas.mockRestore();
    local.mockRestore();
  });

  test('refuses a skill the specialist does not own', () => {
    expect(() => assertSkillAllowed(SPECIALIST, 'transfer_money')).toThrow(/not authorized/i);
    expect(() => assertSkillAllowed(SPECIALIST, TOOL)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/a2aSpecialistExecutor --forceExit`
Expected: FAIL — `assertSkillAllowed is not a function`, and `makeSpecialistExecutor` ignores its third argument.

- [ ] **Step 3: Implement the executor**

In `demo_api_server/services/a2aProtocolServer.js`, add `assertSkillAllowed`, give `makeSpecialistExecutor` its third argument, and rewrite `execute` to exchange, run the tool, fall back under PERMIT only, and publish data. `createSpecialistProtocolHandler(vertical, cfg, ctx)` forwards `ctx` and `subjectToken` into the executor. Export `assertSkillAllowed`.

```js
function assertSkillAllowed(specialist, tool) {
  const allowed = specialist.tools || [];
  if (!tool || !allowed.includes(tool)) {
    const err = new Error(`not authorized for skill "${tool || '(none)'}"`);
    err.a2aAuthorization = true;
    throw err;
  }
  return tool;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/a2aSpecialistExecutor --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/a2aProtocolServer.js demo_api_server/tests/a2aSpecialistExecutor.test.js
git commit -m "feat(a2a): specialist performs its own exchange and tool call"
```

---

### Task 5: Rewire the generalist to send the delegated token

**Files:**
- Modify: `demo_api_server/services/a2aProtocolClient.js` (whole file)
- Modify: `demo_api_server/services/demoAgentLangGraphService.js:992-1141` (`executeA2aDelegation`)
- Test: `demo_api_server/src/__tests__/a2aProtocolClient.test.js` (rewrite — its current test asserts the deleted client_credentials mint)
- Test: `demo_api_server/src/__tests__/a2aExecution.test.js` (update mock seam)

**Interfaces:**
- Consumes: `exchangeAsGeneralist` (Task 3); `getSignedCard`, `cardVerifier` (Task 2); `verifyA2aBearer` (Task 1).
- Produces: `sendA2aProtocolHandoff({ vertical, subtask, tool, toolArgs, subjectToken, tokenEvents, cfg, req, sessionId, deps })` → `Promise<{ ok, tokenEvents, result, toolError, actChainDepth, scopes, specialist, error? }>`.

**Notes for the implementer:**
- Delete the `getAiAgentClientCredentialsToken()` mint. The bearer is `subjectToken` (tAgent1). Keep emitting the `a2a-protocol-bearer` event, now describing the delegated token.
- Before `handler.sendMessage`, call `await verifyA2aBearer(subjectToken, { vertical, cfg })`. The in-process path must not be a way around the gate.
- Verify the card with `cardVerifier(cfg)(await getSignedCard(vertical, cfg))` and emit the existing `a2a-agent-card` event.
- `loopbackSpecialistBase` changes `http://` to `https://`.
- No soft-fail: return `{ ok: false, error }` and let the caller report `delegated: false`.
- In `executeA2aDelegation`, keep the returned JSON **identical**, including both `note` variants, `render` from `A2A_TOOL_RENDER`, and the `account_id` default for `get_portfolio_summary`. Source `result`/`toolError`/`actChainDepth`/`scopes` from the handoff instead of a local tool call, and delete the local `executeBffToolWithToken` + local-serve block that moved to Task 4.

- [ ] **Step 1: Write the failing test**

Replace the contents of `demo_api_server/src/__tests__/a2aProtocolClient.test.js`:

```js
'use strict';

jest.mock('../../middleware/a2aPingOneBearer', () => ({ verifyA2aBearer: jest.fn() }));

const { verifyA2aBearer } = require('../../middleware/a2aPingOneBearer');
const { sendA2aProtocolHandoff } = require('../../services/a2aProtocolClient');

const CFG = { getEffective: () => '' };

describe('a2aProtocolClient', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sends the delegated token and mints no client_credentials bearer', async () => {
    verifyA2aBearer.mockResolvedValue({ sub: 'u1', act: { client_id: 'gen-id' } });
    const oauthService = { getAiAgentClientCredentialsToken: jest.fn() };
    const tokenEvents = [];

    await sendA2aProtocolHandoff({
      vertical: 'investment',
      subtask: 'positions',
      subjectToken: 'T.AGENT1',
      tokenEvents,
      cfg: CFG,
      deps: { oauthService },
    });

    expect(oauthService.getAiAgentClientCredentialsToken).not.toHaveBeenCalled();
    expect(verifyA2aBearer).toHaveBeenCalledWith('T.AGENT1', expect.objectContaining({ vertical: 'investment' }));
    const bearerEvent = tokenEvents.find((e) => e.id === 'a2a-protocol-bearer');
    expect(bearerEvent.status).toBe('acquired');
  });

  test('fails the hop when the bearer does not validate (no soft-fail)', async () => {
    verifyA2aBearer.mockRejectedValue(new Error('unauthorized'));
    const tokenEvents = [];
    const out = await sendA2aProtocolHandoff({
      vertical: 'investment', subtask: 'positions', subjectToken: 'BAD', tokenEvents, cfg: CFG,
    });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unauthorized/i);
    expect(tokenEvents.some((e) => e.status === 'failed')).toBe(true);
  });

  test('requires a delegated token to be supplied', async () => {
    const out = await sendA2aProtocolHandoff({ vertical: 'investment', tokenEvents: [], cfg: CFG });
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest src/__tests__/a2aProtocolClient --forceExit`
Expected: FAIL — the client still mints a client_credentials bearer.

- [ ] **Step 3: Rewrite the client and the caller**

Implement per the notes above.

- [ ] **Step 4: Update `a2aExecution.test.js` to the new seam**

Its `HAPPY_DELEGATION` mock of `delegateToSpecialist` becomes a mock of `exchangeAsGeneralist` returning `{ token: 'T.AGENT1', userSub: 'user', specialist: 'Investment Advisor', tool: 'get_portfolio_summary', ... }`, plus a mock of `sendA2aProtocolHandoff` returning `{ ok: true, result: { positions: [{ symbol: 'VTI' }] }, toolError: null, actChainDepth: 2, scopes: ['invest:read'] }`. The two locked local-serve cases move to Task 4's suite; replace them here with one case asserting that a failed hop yields `delegated: false` and runs no tool. Keep the `specialistVertical` render-descriptor test as is — it must still pass.

- [ ] **Step 5: Run both suites to verify they pass**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest src/__tests__/a2aProtocolClient src/__tests__/a2aExecution --forceExit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/a2aProtocolClient.js demo_api_server/services/demoAgentLangGraphService.js demo_api_server/src/__tests__/a2aProtocolClient.test.js demo_api_server/src/__tests__/a2aExecution.test.js
git commit -m "feat(a2a): generalist sends the delegated token and fails closed"
```

---

### Task 6: Documentation, copy, and the full verification pass

**Files:**
- Modify: `REGRESSION_PLAN.md` (§1 locked table)
- Modify: `TECH_DEBT.md`
- Modify: `demo_api_ui/src/components/education/A2ADelegationPanel.js`
- Modify: `.claude/skills/a2a-protocol/SKILL.md` (hard rule 3)

- [ ] **Step 1: Add the REGRESSION_PLAN §1 locked row**

One row in the locked table, naming: the five bearer checks plus the skill check, the actor pinned to the generalist, card signature verification with an own-origin `jku`, no token in any A2A payload or reply, the PERMIT-gated local serve, and fail-closed on hop failure. Cite the guard tests: `demo_api_server/tests/a2aBearerValidation.test.js`, `tests/a2aCardSigning.test.js`, `tests/a2aSpecialistExecutor.test.js`.

- [ ] **Step 2: Add the three TECH_DEBT entries**

(1) No proof-of-possession: PingOne issues neither DPoP (RFC 9449) nor certificate-bound (RFC 8705) tokens — see `docs/SPIFFE_PLAN.md:53`; fix path is native `cnf` if PingOne adds it, else PingFederate/AIC. (2) The card-signing key is process-ephemeral; a persistent key is needed once third parties cache cards. (3) `POST /a2a/specialists/:vertical` now requires a delegated token, so an external client using a plain client_credentials bearer breaks; no in-repo caller does this today.

- [ ] **Step 3: Update the Learning Hub copy**

In `A2ADelegationPanel.js`, keep the wire protocol distinct from RFC 8693 identity, state that the hop now carries the user's delegated token, and say plainly that the token is not sender-constrained. Emoji allowlist applies.

- [ ] **Step 4: Correct the skill**

In `.claude/skills/a2a-protocol/SKILL.md`, hard rule 3 currently says the wire hop uses a generalist client_credentials token. Rewrite it: the wire hop carries the Exchange #1 delegated token, and the specialist performs Exchange #2 itself.

- [ ] **Step 5: Run the full verification pass**

```bash
cd demo_api_server && CI=true npm test -- --forceExit
cd demo_api_ui && npm run test:unit && npm run build
```

Expected: both green. Paste the result lines. Per `demo_api_server/CLAUDE.md`, a single red suite that passes in isolation is the known LMDB/loopback flake — re-run it alone before treating it as a regression.

- [ ] **Step 6: Commit**

```bash
git add REGRESSION_PLAN.md TECH_DEBT.md demo_api_ui/src/components/education/A2ADelegationPanel.js .claude/skills/a2a-protocol/SKILL.md
git commit -m "docs(a2a): record the hardened hop contract and the PoP ceiling"
```

---

## Self-review

**Spec coverage:** every spec section maps to a task — validator (1), failure responses (1), card signing (2), delegation split (3), executor with Exchange #2, tool call and local-serve guard (4), client rewire, HTTPS default and hard-fail (5), standards-mapping tests (1, 2, 4, 5), docs and ceilings (6). The spec's "out of scope" list stays out.

**Placeholder scan:** no TBD/TODO, no "add error handling", no "similar to Task N" — each task repeats the code it needs.

**Type consistency:** `verifyA2aBearer(token, { vertical, cfg, deps })` → claims, used with that shape in Tasks 1 and 5. `exchangeAsGeneralist` returns `token` = tAgent1, consumed as `subjectToken` in Tasks 4 and 5. `exchangeAsSpecialist(subjectToken, opts)` → `token` = nested-act, passed as `suppliedToken`. `executeBffToolWithToken` returns a JSON **string**, parsed before use in Task 4. All three oauthService helpers return bare strings, per Global Constraints.
