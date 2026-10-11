# Support Console — Real RFC 8693 Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the support console's session-flag verification with the real ceremony — headless PingOne pi.flow sign-on for the customer, real RFC 8693 exchange with the admin client as actor, write executed under the delegated `act` token, and a guided demo track whose slots fill only from real ceremony evidence.

**Architecture:** A new `supportDelegationService` owns the ceremony (drives pi.flow directly — the existing `piFlowDriver` handlers are Express-coupled to the operator's own sign-in session state and are used as the reference implementation, not imported). `adminVerticals.js` re-points `verify/initiate` at it, adds `verify/otp`, and makes `writeAction` perform the exchange before the mutator. `requireCustomerVerified` demands the live session customer token. `operatorTokenChain.js` grows three evidence builders. `demoTrackService` grows a `trackId` (default `'main'`) and an `observeSupportEvent` hook; the console mounts the existing band/tab with `trackId="support"` and a hero button linking to it.

**Tech Stack:** Node/Express (demo_api_server), React/Vite (demo_api_ui), Jest (server) + Vitest (UI), supertest. PingOne: pi.flow sign-on API, OAuth token endpoint (PKCE + RFC 8693).

**Spec:** `docs/superpowers/specs/2026-10-11-support-console-real-delegation-design.md`

## Global Constraints

- No mayAct, no CIBA, no new PingOne apps, no schema attributes, no policy edits (spec §Out of scope).
- `act` is minted by PingOne from the actor token's `client_id` (`actAttributeValue()` default) — never constructed client-side.
- Customer token and PKCE verifier live ONLY in `req.session.support` (server-side); the browser receives claims and masked contacts, never token values.
- Delegated token: `token_lifetime` 300 s, audience `ENDUSER_AUDIENCE` (env; `enduser.ping.demo` live), scope = the single write scope for the action.
- Actor CC token: minted per exchange via `oauthService.getAgentClientCredentialsToken()`'s sibling for the admin client — implemented as `getAdminClientCredentialsToken()` (Task 1) using `oauthConfig.clientId/Secret` with the same auth-method-order loop. Never persisted.
- `demoTrackService` hooks are best-effort: wrapped in try/catch, never throw into a host path (existing contract, kept).
- Every route guard stays PER-ROUTE on the `/api/admin` router (other routers share the mount).
- All changes on a worktree branch (repo pre-commit hook blocks main-checkout commits).
- Demo password for the customer's pi.flow password step: configStore `demo_password` (env `DEMO_PASSWORD`, default `Baseball123!`).
- 15-min customer-verification TTL (`SUPPORT_VERIFY_TTL_MS`) unchanged.

## Review Focus

1. **Unverified-customer write after session restore** — a session cookie that survives a BFF restart may carry `support` state whose flow is gone but whose TTL hasn't expired; expect the write to still work ONLY if the customer token itself is present and unexpired (the token, not the flow, is the authority). Test in Task 6.
2. **Customer switches mid-ceremony** — operator starts verify for customer A, looks up customer B, enters the OTP: expect the OTP step to be rejected (pendingFlow bound to customer A) and B's write to 403. Test in Task 5.
3. **Exchange failure must not mutate** — PingOne token endpoint down or 4xx: the write aborts BEFORE the mutator with 502 `exchange_failed`, the store row unchanged, chain records the failure. Test in Task 7.
4. **Wrong-OTP retry keeps the flow usable** — a 401 `invalid_otp` must leave `pendingFlow` intact so a corrected code succeeds without re-initiating (re-initiating cancels the first SMS). Test in Task 5.
5. **Track pollution across tracks** — a main-track tool call must never fill a support-track slot and vice versa (trackId-scoped buckets). Test in Task 9.

---

### Task 1: Admin-client CC token minter

**Files:**
- Modify: `demo_api_server/services/oauthService.js` (inside the OAuthService class, near `getAgentClientCredentialsToken` at line ~809)
- Test: `demo_api_server/tests/oauthService.adminCcToken.test.js`

**Interfaces:**
- Consumes: `oauthConfig` (`this.config`), `applyTokenEndpointAuth`, `authMethodOrder`, `isInvalidClientError` — all already module-local in oauthService.js.
- Produces: `oauthService.getAdminClientCredentialsToken(scope)` → `Promise<string>` (an access token). `scope` is a single-resource scope string (e.g. `'write'`). Throws with a clear message when admin credentials are unset.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// tests/oauthService.adminCcToken.test.js
jest.mock('axios');

const axios = require('axios');

describe('getAdminClientCredentialsToken', () => {
  const oauthService = require('../services/oauthService');

  beforeEach(() => {
    process.env.PINGONE_ADMIN_CLIENT_ID = 'admin-cid';
    process.env.PINGONE_ADMIN_CLIENT_SECRET = 'admin-secret';
    axios.post.mockReset();
  });

  it('mints a client_credentials token for the admin client with the requested scope', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'cc-token-1' } });
    const token = await oauthService.getAdminClientCredentialsToken('write');
    expect(token).toBe('cc-token-1');
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/as/token');
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('scope=write');
    expect(body).toContain('client_id=admin-cid');
  });

  it('throws a named error when admin credentials are missing', async () => {
    delete process.env.PINGONE_ADMIN_CLIENT_ID;
    delete process.env.PINGONE_ADMIN_CLIENT_SECRET;
    await expect(oauthService.getAdminClientCredentialsToken('write'))
      .rejects.toThrow(/admin client credentials/i);
  });
});
```

Note: `oauthService` reads `configStore.getEffective('admin_client_id')` first via `oauthConfig`; the env fallback in the test works because configStore's `getEffective` for this key falls back to the env var — verify during implementation and set `jest.mock('../services/configStore')` if the config path fights the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/oauthService.adminCcToken.test.js`
Expected: FAIL — `getAdminClientCredentialsToken is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to the OAuthService class in `demo_api_server/services/oauthService.js` (right after `getAgentClientCredentialsToken`, ~line 868):

```js
  /**
   * Client-credentials token for the ADMIN app (the operator BFF's own client).
   * Actor token for support-console RFC 8693 exchanges: PingOne mints
   * act.sub from this token's client_id (actAttributeValue default), so the
   * delegated token records "the admin BFF, operated by the signed-in admin,
   * acted for the customer". Minted per exchange, never persisted.
   * @param {string} scope - single-resource scope (PingOne rejects multi-resource CC requests)
   */
  async getAdminClientCredentialsToken(scope) {
    const clientId = this.config.clientId;
    const clientSecret = this.config.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('Admin client credentials not set. Set PINGONE_ADMIN_CLIENT_ID + PINGONE_ADMIN_CLIENT_SECRET.');
    }
    const tokenEndpoint = this.config.tokenEndpoint;
    const order = authMethodOrder(
      (process.env.PINGONE_ADMIN_TOKEN_AUTH_METHOD
        || configStore.getEffective('admin_token_endpoint_auth_method')
        || 'basic').toLowerCase()
    );
    for (let i = 0; i < order.length; i++) {
      const method = order[i];
      const body = new URLSearchParams({ grant_type: 'client_credentials' });
      if (scope) body.set('scope', scope);
      if (method === 'post') body.set('client_id', clientId);
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      applyTokenEndpointAuth(clientId, clientSecret, method, body, headers, tokenEndpoint);
      try {
        const response = await axios.post(tokenEndpoint, body.toString(), { headers });
        const at = response.data.access_token;
        if (!at) throw new Error('Admin client credentials response missing access_token');
        return at;
      } catch (error) {
        if (!(isInvalidClientError(error) && i < order.length - 1)) {
          const d = error.response?.data || {};
          throw new Error(`Admin client credentials failed: ${d.error_description || d.error || error.message}`);
        }
      }
    }
    throw new Error('Admin client credentials failed for all auth methods');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/oauthService.adminCcToken.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/oauthService.js demo_api_server/tests/oauthService.adminCcToken.test.js
git commit -m "feat(bff): admin-client CC token minter for support exchange actor"
```

---

### Task 2: Support ceremony service — pi.flow sign-on (initiate + OTP)

**Files:**
- Create: `demo_api_server/services/supportDelegationService.js`
- Test: `demo_api_server/tests/supportDelegationService.piFlow.test.js`

**Interfaces:**
- Consumes: `oauthUserConfig` (authorizationEndpoint/tokenEndpoint getters), `oauthUserService.generateAuthorizationUrl({ state, codeVerifier, redirectUri, nonce, prompt:'login', forcePiFlow:true, login_hint })`, `oauthUserService.generateCodeVerifier()`, `oauthUserService.exchangeCodeForToken(code, codeVerifier, redirectUri)`, `oauthService.generateState()`, `getUserRedirectUri(req)` from `services/oauthRedirectUris`, configStore `demo_password`, `decodeJwt` from `utils/tokenUtils`.
- Produces (all take `req` and return plain objects; the route layer owns HTTP):
  - `openCustomerSignon(req, { username, pingOneUserId })` → `{ step:'otp', maskedContact }` | throws `{ status, code, message }`.
    Stores into `req.session.support = { customerUsername, pingOneUserId, pendingFlow: { flowId, cookies, status, startedAt }, codeVerifier, state, nonce, redirectUri, verifiedUntil: 0 }`.
  - `submitCustomerOtp(req, { otp })` → `{ verified: true, expiresAt, tokenEvent }` | throws `{ status:'invalid_otp'|'flow_expired'|... , code, message }`.
    On COMPLETED: `as/resume` → code → `exchangeCodeForToken` → decode → `req.session.support.subjectToken/subjectClaims/idToken/expiresAt/verifiedUntil` set, `pendingFlow` deleted.
  - `buildCustomerTokenEvent(support)` → the `customer-token-issued` chain event (claims only, sanitized by decodeJwt's whitelist; no token value).
  - `buildSignonEvents(support)` → `[customer-signon event]` (credentials step + OTP step evidence, masked contact).
  - Session read helpers used by later tasks: `liveSupportSession(req, customerId)` → the support object when it matches customerId AND `verifiedUntil > Date.now()`, else null.

pi.flow step mechanics (mirrored from `piFlowDriver.js` — reference shapes, not imports):
- Open: `fetch(authorizeUrl, { redirect:'manual', headers:{Accept:'*/*'}, signal:AbortSignal.timeout(10000) })` → JSON body with `id` (flowId) + `status`; capture `set-cookie` into a cookie jar (`name=value` map, `mergePiFlowCookies` shape).
- Identify: POST `${base}/flows/{flowId}` with `Content-Type: application/vnd.pingidentity.user.lookup+json`, body `{ username }`, `Cookie:` from jar.
- Password: POST same URL, `application/vnd.pingidentity.usernamePassword.check+json`, body `{ password }` (from `configStore.getEffective('demo_password')`).
- OTP: POST same URL, `application/vnd.pingidentity.otp.check+json`, body `{ otp }`. Status 400 with `details[].code === 'OTP_VALIDATION_FAILED'` → throw `{ status:401, code:'invalid_otp' }` (keep pendingFlow intact).
- Complete: `GET {base}/as/resume?flowId={flowId}` with cookies, `redirect:'manual'` → code from JSON `authorizeResponse.code` or Location query.
- Base URL: `oauthUserConfig.authorizationEndpoint.replace(/\/as\/authorize.*$/, '')`.
- Only PingOne (provider 'pingone') — PF is out of scope; throw `{ status:502, code:'pi_flow_provider_unsupported' }` if the configured provider isn't PingOne (check `configStore.getOAuthProvider?.() === 'pingone'`).

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// tests/supportDelegationService.piFlow.test.js
// Stubs fetch; the service's own flow-state machine is under test.

const flush = () => new Promise((r) => setImmediate(r));

function jsonRes(status, body, headers = {}) {
  return { ok: status < 400, status, headers: { get: (n) => headers[n.toLowerCase()] || null }, json: async () => body };
}

function fakeSession() {
  return { support: null, save: (cb) => cb && cb() };
}

function fakeReq() {
  const req = { session: fakeSession(), headers: {} };
  return req;
}

beforeEach(() => {
  global.fetch = jest.fn();
  process.env.PINGONE_USER_CLIENT_ID = 'user-cid';
  process.env.DEMO_PASSWORD = 'Baseball123!';
});

describe('supportDelegationService.openCustomerSignon', () => {
  let svc;
  beforeEach(() => { jest.isolateModules(() => { svc = require('../services/supportDelegationService'); }); });

  it('drives lookup + password steps headlessly and stops at OTP_REQUIRED', async () => {
    // authorize → flow JSON
    global.fetch.mockImplementationOnce(async () => jsonRes(200, { id: 'flow-abc123', status: 'SIGN_ON_REQUIRED' }, { 'set-cookie': 'PF=1' }));
    // user.lookup
    global.fetch.mockImplementationOnce(async () => jsonRes(200, { status: 'PASSWORD_REQUIRED' }));
    // usernamePassword.check → OTP_REQUIRED
    global.fetch.mockImplementationOnce(async () => jsonRes(200, { status: 'OTP_REQUIRED', _embedded: { devices: [{ type: 'SMS', phone: { number: '+19725550186' } }] } }));

    const req = fakeReq();
    const out = await svc.openCustomerSignon(req, { username: 'demoUser', pingOneUserId: '1583af47' });
    await flush();
    expect(out.step).toBe('otp');
    expect(out.maskedContact).toContain('86');
    const s = req.session.support;
    expect(s.pendingFlow.flowId).toBe('flow-abc123');
    expect(s.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(s.subjectToken).toBeUndefined();
  });

  it('rejects a customer lookup when PingOne opens no flow', async () => {
    global.fetch.mockImplementationOnce(async () => jsonRes(400, { error: 'nope' }));
    await expect(svc.openCustomerSignon(fakeReq(), { username: 'demoUser', pingOneUserId: 'x' }))
      .rejects.toMatchObject({ code: 'pi_flow_unavailable' });
  });
});

describe('supportDelegationService.submitCustomerOtp', () => {
  let svc;
  beforeEach(() => { jest.isolateModules(() => { svc = require('../services/supportDelegationService'); }); });

  function sessionWithFlow() {
    const req = fakeReq();
    req.session.support = {
      customerUsername: 'demoUser', pingOneUserId: '1583af47',
      pendingFlow: { flowId: 'flow-abc123', cookies: { PF: '1' }, status: 'OTP_REQUIRED', startedAt: Date.now() },
      codeVerifier: 'v'.repeat(64), state: 'st', nonce: 'n', redirectUri: 'https://x/cb',
      verifiedUntil: 0,
    };
    return req;
  }

  it('wrong OTP → 401 invalid_otp, flow kept for retry', async () => {
    const req = sessionWithFlow();
    global.fetch.mockImplementationOnce(async () => jsonRes(400, { details: [{ code: 'OTP_VALIDATION_FAILED' }] }));
    await expect(svc.submitCustomerOtp(req, { otp: '000000' }))
      .rejects.toMatchObject({ status: 401, code: 'invalid_otp' });
    expect(req.session.support.pendingFlow).toBeTruthy(); // flow survives
  });

  it('correct OTP → code redeemed → session holds the subject token', async () => {
    const req = sessionWithFlow();
    // otp.check → COMPLETED
    global.fetch.mockImplementationOnce(async () => jsonRes(200, { status: 'COMPLETED' }));
    // as/resume → code (via Location header)
    global.fetch.mockImplementationOnce(async () => jsonRes(302, {}, { location: 'https://x/cb?code=AUTHCODE&state=st' }));

    // stub exchangeCodeForToken via jest.mock of oauthUserService
    jest.doMock('../services/oauthUserService', () => ({
      ...jest.requireActual('../services/oauthUserService'),
      exchangeCodeForToken: jest.fn(async () => ({ access_token: 'subject.jwt.value', id_token: 'idt', expires_in: 3600, scope: 'openid read write' })),
    }));
    svc = require('../services/supportDelegationService');

    const out = await svc.submitCustomerOtp(req, { otp: '123456' });
    await flush();
    expect(out.verified).toBe(true);
    expect(req.session.support.subjectToken).toBe('subject.jwt.value');
    expect(req.session.support.verifiedUntil).toBeGreaterThan(Date.now());
    expect(req.session.support.pendingFlow).toBeUndefined();
    // tokenEvent carries claims, never the token value
    expect(JSON.stringify(out.tokenEvent)).not.toContain('subject.jwt.value');
  });
});
```

Implementation note for the test's `_session` channel: `openCustomerSignon` stores on `req.session.support`; the test's fake `req.session` is the same object, so assert via `out._session` only if the service chooses to return it — simpler: return `{ step, maskedContact }` and have the test hold `req` and read `req.session.support`. Prefer that; drop `_session`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/supportDelegationService.piFlow.test.js`
Expected: FAIL — Cannot find module '../services/supportDelegationService'

- [ ] **Step 3: Write minimal implementation**

Create `demo_api_server/services/supportDelegationService.js`:

```js
'use strict';
/**
 * Support-console customer delegation ceremony.
 *
 * Headless PingOne pi.flow sign-on for the CUSTOMER (BFF drives; the operator
 * witnesses), producing a real customer access token in the operator's
 * server-side session, then (Task 3) a real RFC 8693 exchange with the admin
 * client as actor.
 *
 * pi.flow step shapes mirror services/piFlowDriver.js — the reference
 * implementation. piFlowDriver's handlers are Express-coupled to the
 * operator's OWN sign-in session state (req.session.oauthPiFlow /
 * oauthState / oauthRedirectUri), so this service drives the flow directly
 * under req.session.support and never touches those keys.
 *
 * Session shape (spec §Session shape):
 *   support = { customerUsername, pingOneUserId, pendingFlow?, codeVerifier,
 *               state, nonce, redirectUri, subjectToken?, subjectClaims?,
 *               idToken?, expiresAt?, verifiedUntil }
 * The customer token never leaves the server.
 */
const crypto = require('crypto');
const configStore = require('./configStore');
const oauthUserConfig = require('../config/oauthUser');
```

Implementation sketch (fill to pass the tests; every piece is in the interfaces block above):

```js
const crypto = require('crypto');
const configStore = require('./configStore');
const oauthUserConfig = require('../config/oauthUser');
const oauthUserService = require('./oauthUserService');
const oauthService = require('./oauthService');
const { getUserRedirectUri } = require('./oauthRedirectUris');
const { decodeJwt } = require('../utils/tokenUtils');

const FLOW_TIMEOUT_MS = 10000;
const VERIFY_TTL_MS = 15 * 60 * 1000;
const SUPPORT_VERIFY_TTL_MS = VERIFY_TTL_MS;
const PI_FLOW_ID = /^[A-Za-z0-9_-]{6,64}$/;

const base = () => String(oauthUserConfig.authorizationEndpoint).replace(/\/as\/authorize.*$/, '');
const stepUrl = (flowId) => `${base()}/flows/${flowId}`;
const cookieHeader = (jar) => Object.entries(jar || {}).map(([k, v]) => `${k}=${v}`).join('; ');
function mergeCookies(jar, res) {
  const out = { ...(jar || {}) };
  for (const raw of res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)) {
    const [pair] = String(raw).split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}
async function postStep(pending, contentType, payload) {
  const res = await fetch(stepUrl(pending.flowId), {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: 'application/json', Cookie: cookieHeader(pending.cookies) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FLOW_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, cookies: mergeCookies(pending.cookies, res) };
}

function err(status, code, message) { const e = new Error(message || code); e.status = status; e.code = code; throw e; }

/** Customer-identity proof ceremony, phase 1: open flow + password, stop at OTP. */
async function openCustomerSignon(req, { username, pingOneUserId }) {
  if ((configStore.getOAuthProvider?.() || 'pingone') !== 'pingone') err(502, 'pi_flow_provider_unsupported', 'pi.flow sign-on is PingOne-only');
  const state = oauthService.generateState();
  const codeVerifier = oauthUserService.generateCodeVerifier();
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectUri = getUserRedirectUri(req);

  const url = oauthUserService.generateAuthorizationUrl({
    state, codeVerifier, redirectUri, nonce, prompt: 'login', forcePiFlow: true, login_hint: username,
  });
  const res = await fetch(url, { redirect: 'manual', headers: { Accept: '*/*' }, signal: AbortSignal.timeout(FLOW_TIMEOUT_MS) });
  const flow = await res.json().catch(() => null);
  if (!res.ok || !PI_FLOW_ID.test(String(flow?.id || ''))) err(502, 'pi_flow_unavailable', 'PingOne did not open a sign-on flow');
  let pending = { flowId: flow.id, cookies: mergeCookies({}, res), status: flow.status, startedAt: Date.now() };

  if (pending.status === 'SIGN_ON_REQUIRED') {
    const lookup = await postStep(pending, 'application/vnd.pingidentity.user.lookup+json', { username });
    if (!lookup.ok) err(502, 'pi_flow_failed', `user.lookup failed (${lookup.status})`);
    pending.cookies = lookup.cookies; pending.status = lookup.body.status;
  }
  if (pending.status === 'PASSWORD_REQUIRED') {
    const password = configStore.getEffective('demo_password') || process.env.DEMO_PASSWORD || 'Baseball123!';
    const pw = await postStep(pending, 'application/vnd.pingidentity.usernamePassword.check+json', { password });
    if (!pw.ok) err(502, 'pi_flow_failed', `password step failed (${pw.status})`);
    pending.cookies = pw.cookies; pending.status = pw.body.status;
  }
  if (pending.status !== 'OTP_REQUIRED' && pending.status !== 'DEVICE_SELECTION_REQUIRED') {
    err(502, 'pi_flow_unexpected_status', `flow stopped at ${pending.status}`);
  }

  req.session.support = {
    customerUsername: username, pingOneUserId,
    pendingFlow: pending, codeVerifier, state, nonce, redirectUri, verifiedUntil: 0,
  };
  const devices = flow._embedded?.devices || [];
  const phone = devices.find((d) => (d.phone?.number || d.phone || ''));
  const masked = phone ? `••••${String(phone.phone?.number || phone.phone).replace(/\D/g, '').slice(-2)}` : 'registered device';
  await new Promise((r) => req.session.save(r));
  return { step: pending.status === 'OTP_REQUIRED' ? 'otp' : 'device', maskedContact: masked, _session: req.session.support };
}

/** Phase 2: OTP check → COMPLETED → as/resume → code → token. */
async function submitCustomerOtp(req, { otp }) {
  const s = req.session.support;
  if (!s || !s.pendingFlow) err(410, 'flow_expired', 'No customer sign-on in progress');
  if (Date.now() - s.pendingFlow.startedAt > 5 * 60 * 1000) { delete s.pendingFlow; err(410, 'flow_expired', 'Sign-on flow expired — initiate again'); }
  const pending = s.pendingFlow;
  const check = await postStep(pending, 'application/vnd.pingidentity.otp.check+json', { otp: String(otp).trim() });
  if (check.status === 400 && check.body?.details?.some((d) => d.code === 'OTP_VALIDATION_FAILED')) {
    err(401, 'invalid_otp', 'That code is not valid. Check it and try again.'); // pendingFlow kept
  }
  if (!check.ok) err(502, 'pi_flow_failed', `otp.check failed (${check.status})`);

  const resume = await fetch(`${base()}/as/resume?flowId=${pending.flowId}`, {
    headers: { Accept: '*/*', Cookie: cookieHeader(check.cookies) }, redirect: 'manual', signal: AbortSignal.timeout(FLOW_TIMEOUT_MS),
  });
  let code = '';
  if (resume.headers.get('location')) {
    try { code = new URL(resume.headers.get('location')).searchParams.get('code') || ''; } catch (_) {}
  }
  if (!code && (resume.headers.get('content-type') || '').includes('json')) {
    code = (await resume.json().catch(() => ({})))?.authorizeResponse?.code || '';
  }
  if (!code) err(502, 'pi_flow_no_code', 'Flow completed but no authorization code came back');
  delete s.pendingFlow;

  const tokenData = await oauthUserService.exchangeCodeForToken(code, s.codeVerifier, s.redirectUri);
  const access = tokenData?.access_token;
  if (!access) err(502, 'token_mint_failed', 'Code redeemed without an access token');
  const claims = decodeJwt(access)?.claims || {};
  s.subjectToken = access;
  s.subjectClaims = claims;
  s.idToken = tokenData.id_token || null;
  s.expiresAt = Date.now() + (Number(tokenData.expires_in) || 3600) * 1000;
  s.verifiedUntil = Date.now() + VERIFY_TTL_MS;
  await new Promise((r) => req.session.save(r));
  return { verified: true, expiresAt: s.verifiedUntil, tokenEvent: buildCustomerTokenEvent(s) };
}

function buildCustomerTokenEvent(s) {
  const claims = s.subjectClaims || {};
  return {
    id: 'customer-token-issued',
    label: 'Customer token issued',
    status: 'done',
    timestamp: new Date().toISOString(),
    claims: {
      sub: claims.sub || null,
      iss: claims.iss || 'PingOne',
      scope: claims.scope || null,
    },
    explanation: 'A real PingOne access token for the customer, minted by their own sign-on (pi.flow + OTP). Held server-side in the operator session; never sent to the browser.',
  };
}

function liveSupportSession(req, customerId) {
  const s = req.session?.support;
  if (!s || s.verifiedUntil <= Date.now()) return null;
  if (customerId != null && String(s.customerId || s.pingOneUserId) !== String(customerId)) return null;
  return s;
}

module.exports = {
  openCustomerSignon, submitCustomerOtp, buildCustomerTokenEvent, buildSignonEvents,
  liveSupportSession, SUPPORT_VERIFY_TTL_MS,
};
```

Implementation notes (resolve while coding, keep tests as the contract):
- `buildSignonEvents(s)` returns `[{ id:'customer-signon', label:'Customer sign-on — pi.flow + OTP', status:'done', claims:{ username: s.customerUsername, method:'password+otp' }, explanation } ]` — the ceremony's own evidence, no secrets.
- Session keying: store `s.customerId` alongside `pingOneUserId` (the LOCAL demo user id the console keys on) — `openCustomerSignon` receives it in its options and records it; `liveSupportSession` matches on it.
- `maskedContact`: derive from the flow's device list when present; never include the full number.
- Wrong-OTP retry: `submitCustomerOtp` must NOT delete `pendingFlow` on `invalid_otp` (test asserts this).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/supportDelegationService.piFlow.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/supportDelegationService.js demo_api_server/tests/supportDelegationService.piFlow.test.js
git commit -m "feat(bff): headless customer pi.flow sign-on ceremony (supportDelegationService)"
```

---

### Task 3: RFC 8693 exchange + chain-event builders

**Files:**
- Modify: `demo_api_server/services/supportDelegationService.js` (add exchange + builders)
- Test: `demo_api_server/tests/supportDelegationService.exchange.test.js`

**Interfaces:**
- Consumes: `oauthService.getAdminClientCredentialsToken(scope)` (Task 1), `oauthService.performTokenExchangeWithActor(subjectToken, actorToken, audience, scopes)` (exists), `ENDUSER_AUDIENCE` env, `decodeJwt`.
- Produces:
  - `exchangeForWrite(req, { scope })` → `{ delegatedToken, delegatedClaims }` | throws `{ status:502, code:'exchange_failed' }`. Subject = `req.session.support.subjectToken`; actor = fresh admin CC token; audience = `process.env.ENDUSER_AUDIENCE`.
  - `buildExchangeEvents({ delegatedClaims, request })` → `[{ id:'exchange', ... }]` — real RFC 8693 request shape + real response claims (`sub`, `act.sub`, `scope`, `aud`, `jti`).
  - `buildDenialChainEvent(kind)` reused from `operatorTokenChain.js` (no change there in this task).

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// tests/supportDelegationService.exchange.test.js
jest.mock('../services/oauthService');
// Real decodeJwt parses JWTs; the exchange tests only need claims out.
jest.mock('../utils/tokenUtils', () => ({
  decodeJwt: jest.fn(() => ({
    claims: { sub: '1583af47', act: { sub: 'admin-cid' }, scope: 'write', aud: 'enduser.ping.demo', jti: 'j-1' },
  })),
}));

describe('exchangeForWrite', () => {
  let svc, oauthService;
  beforeEach(() => {
    jest.isolateModules(() => { svc = require('../services/supportDelegationService'); });
    oauthService = require('../services/oauthService');
    process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
  });

  function reqWithSubject() {
    return { session: { support: {
      customerUsername: 'demoUser', customerId: '5', pingOneUserId: '1583af47',
      subjectToken: 'subject.jwt.value', subjectClaims: { sub: '1583af47', scope: 'read write' },
      verifiedUntil: Date.now() + 1000,
    }, save: (cb) => cb && cb() } };
  }

  it('exchanges with subject=customer, actor=admin CC, single scope', async () => {
    oauthService.getAdminClientCredentialsToken.mockResolvedValue('actor.cc.token');
    oauthService.performTokenExchangeWithActor.mockResolvedValue('delegated.jwt.value');

    const out = await svc.exchangeForWrite(reqWithSubject(), { scope: 'write', actorClientId: 'admin-cid' });
    expect(out.delegatedToken).toBe('delegated.jwt.value');
    expect(out.delegatedClaims.act.sub).toBe('admin-cid');
    const [subject, actor, audience, scopes] = oauthService.performTokenExchangeWithActor.mock.calls[0];
    expect(subject).toBe('subject.jwt.value');
    expect(actor).toBe('actor.cc.token');
    expect(audience).toBe('enduser.ping.demo');
    expect(scopes).toEqual(['write']);
    expect(oauthService.getAdminClientCredentialsToken).toHaveBeenCalledWith('write');
  });

  it('maps an exchange failure to 502 exchange_failed and aborts', async () => {
    oauthService.getAdminClientCredentialsToken.mockResolvedValue('actor.cc.token');
    oauthService.performTokenExchangeWithActor.mockRejectedValue(new Error('down'));
    svc = require('../services/supportDelegationService');
    await expect(svc.exchangeForWrite(reqWithSubject(), { scope: 'write', actorClientId: 'c' }))
      .rejects.toMatchObject({ status: 502, code: 'exchange_failed' });
  });
});

describe('buildExchangeEvents', () => {
  it('carries the real act claim and no token values', () => {
    jest.isolateModules(() => { svc = require('../services/supportDelegationService'); });
    const events = svc.buildExchangeEvents({
      delegatedClaims: { sub: '1583af47', act: { sub: 'admin-cid' }, scope: 'write', aud: 'enduser.ping.demo', jti: 'j-1' },
      request: { audience: 'enduser.ping.demo', scope: 'write', hasActor: true },
    });
    const s = JSON.stringify(events);
    expect(s).toContain('admin-cid');
    expect(s).toContain('RFC 8693');
    expect(s).not.toContain('jwt.value');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/supportDelegationService.exchange.test.js`
Expected: FAIL — `exchangeForWrite is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `supportDelegationService.js`:

```js
/**
 * RFC 8693 exchange for a support write. Subject = the customer's token from
 * the ceremony; actor = a fresh admin-client CC token. PingOne constructs
 * act.sub from the actor token's client_id (actAttributeValue default) —
 * this code never fabricates claims. Minted per call, never persisted.
 */
async function exchangeForWrite(req, { scope, actorClientId }) {
  const s = req.session?.support;
  if (!s?.subjectToken) err(403, 'customer_not_verified', 'Complete the customer sign-on first');
  try {
    const actorToken = await oauthService.getAdminClientCredentialsToken(scope);
    const audience = process.env.ENDUSER_AUDIENCE;
    const delegatedToken = await oauthService.performTokenExchangeWithActor(
      s.subjectToken, actorToken, audience, [scope],
    );
    const delegatedClaims = decodeJwt(delegatedToken)?.claims || {};
    return { delegatedToken, delegatedClaims, request: { audience, scope, hasActor: true } };
  } catch (e) {
    if (e.code === 'customer_not_verified') throw e;
    err(502, 'exchange_failed', `RFC 8693 exchange failed: ${e.message}`);
  }
}

function buildExchangeEvents({ delegatedClaims, request }) {
  return [{
    id: 'exchange',
    label: 'RFC 8693 exchange — act on behalf of',
    status: 'done',
    timestamp: new Date().toISOString(),
    claims: {
      sub: delegatedClaims.sub || null,
      'act.sub': delegatedClaims.act?.sub || null,
      scope: delegatedClaims.scope || null,
      aud: delegatedClaims.aud || null,
      jti: delegatedClaims.jti || null,
    },
    request,
    explanation:
      'Real RFC 8693 exchange at the PingOne token endpoint: subject_token = the customer\'s '
      + 'sign-on token, actor_token = the admin client\'s own credential. PingOne minted the '
      + 'act claim from the actor — this token says "the admin BFF, operated by the signed-in '
      + 'admin, acts for this customer", and carries only the write scope for 5 minutes.',
  }];
}

module.exports = { /* existing */, exchangeForWrite, buildExchangeEvents };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/supportDelegationService.exchange.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/supportDelegationService.js demo_api_server/tests/supportDelegationService.exchange.test.js
git commit -m "feat(bff): RFC 8693 exchange for support writes (subject=customer, actor=admin client)"
```

---

### Task 4: Scope map + writeAction exchange + new verify routes

**Files:**
- Modify: `demo_api_server/routes/adminVerticals.js`
- Modify: `demo_api_server/services/operatorTokenChain.js` (three builders integrated)
- Test: `demo_api_server/tests/operatorTokenChain.delegation.test.js`

**Interfaces:**
- Consumes: `supportDelegationService.openCustomerSignon/submitCustomerOtp/exchangeForWrite/buildSignonEvents/buildCustomerTokenEvent/buildExchangeEvents/liveSupportSession` (Tasks 2–3).
- Produces:
  - `POST /api/admin/<vertical>/verify/initiate { customerId }` → ceremony step 1 (`{ step:'otp', maskedContact }`); resolves the customer's PingOne id via `dataStore.getUserById` (username → `fetchPingOneUserByUsername` from `services/pingOneUserLookupService`, same helper `routes/mfa.js` uses; a customer without a PingOne account → 409 `customer_not_linked`).
  - `POST /api/admin/<vertical>/verify/otp { otp }` → `{ verified, expiresAt, tokenChain }` where tokenChain = `[customer-signon, customer-token-issued]`.
  - `writeAction` (all vertical writes): before the mutator, `exchangeForWrite(req, { scope: ACTION_SCOPE })`; the mutator runs only on success; response gains `delegated: { sub, actSub, jti, scope }` and `tokenChain` now = `[operator-session, operator-verification, customer-token-issued, exchange, operator-write, operator-audit]` with real claims on the exchange + token hops.
  - `requireCustomerVerified` (Task 5) passes only when `liveSupportSession(req, customerId)` is non-null.
  - Action→scope map (module-level in adminVerticals.js): every vertical write uses scope `'write'` (the enduser resource's single high-risk scope; the console's `transactions:write`/`general:write` labels are client-side advisory vocabulary mapped to the real granted scope here — one map, one place).

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// tests/operatorTokenChain.delegation.test.js
const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, _res, next) => {
    req.user = { sub: 'admin-operator-1', username: 'demoAdmin', role: 'admin' };
    next();
  },
}));
jest.mock('../services/supportDelegationService', () => ({
  openCustomerSignon: jest.fn(),
  submitCustomerOtp: jest.fn(),
  exchangeForWrite: jest.fn(),
  liveSupportSession: jest.fn(),
  buildSignonEvents: jest.fn(() => [{ id: 'customer-signon', label: 'Customer sign-on', status: 'done', claims: {} }]),
  buildCustomerTokenEvent: jest.fn(() => ({ id: 'customer-token-issued', label: 'Customer token issued', status: 'done', claims: { sub: '1583af47' } })),
  buildExchangeEvents: jest.fn(() => [{ id: 'exchange', label: 'RFC 8693 exchange', status: 'done', claims: { 'act.sub': 'admin-cid' } }]),
  SUPPORT_VERIFY_TTL_MS: 15 * 60 * 1000,
}));

const svc = require('../services/supportDelegationService');

function buildApp() {
  const adminVerticals = require('../routes/adminVerticals');
  const app = express();
  app.use(express.json());
  const session = {};
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/admin', adminVerticals);
  return app;
}

function workforceFixture() {
  const { verticalManifest } = require('../services/verticalManifest');
  verticalManifest.init();
  const dataStore = require('../data/store');
  const user = dataStore.getAllUsers().find((u) => u.role !== 'admin' && u.username);
  const store = verticalManifest.plugins.get('workforce').getDataStore();
  const pending = (store.get(String(user.id)).expenses || []).find(
    (e) => !['Approved', 'Denied', 'Reimbursed'].includes(e.status),
  );
  return { user, store, pending };
}

describe('delegated operator write', () => {
  test('write performs the exchange, runs the mutator, returns the delegated chain', async () => {
    const { user, pending } = workforceFixture();
    const app = buildApp();
    // live verified session with a subject token
    svc.liveSupportSession.mockImplementation((req, customerId) => {
      req.session.support = {
        customerId: String(user.id), customerUsername: user.username, pingOneUserId: '1583af47',
        subjectToken: 'subject.jwt.value', subjectClaims: { sub: '1583af47' },
        verifiedUntil: Date.now() + 900000,
      };
      return req.session.support;
    });
    svc.exchangeForWrite.mockResolvedValue({
      delegatedToken: 'delegated.jwt.value',
      delegatedClaims: { sub: '1583af47', act: { sub: 'admin-cid' }, scope: 'write', jti: 'j-1' },
      request: { audience: 'enduser.ping.demo', scope: 'write', hasActor: true },
    });

    const res = await request(app)
      .post(`/api/admin/workforce/expenses/${pending.id}/approve`)
      .send({ userId: String(user.id) });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.delegated).toMatchObject({ actSub: 'admin-cid', jti: 'j-1', scope: 'write' });
    const ids = res.body.tokenChain.map((e) => e.id);
    expect(ids).toEqual([
      'operator-session', 'operator-verification', 'customer-token-issued', 'exchange', 'operator-write', 'operator-audit',
    ]);
    expect(svc.exchangeForWrite).toHaveBeenCalledWith(expect.anything(), { scope: 'write' });
    // the audit hop records the act chain
    const audit = res.body.tokenChain.find((e) => e.id === 'operator-audit');
    expect(audit.claims.actSub).toBe('admin-cid');
    expect(audit.claims.jti).toBe('j-1');
  });

  test('exchange failure → 502, mutator NOT run, row unchanged', async () => {
    const { user, store, pending } = workforceFixture();
    const app = buildApp();
    svc.liveSupportSession.mockImplementation((req, customerId) => {
      req.session.support = {
        customerId: String(user.id), customerUsername: user.username, pingOneUserId: '1583af47',
        subjectToken: 'subject.jwt.value', subjectClaims: { sub: '1583af47' },
        verifiedUntil: Date.now() + 900000,
      };
      return req.session.support;
    });
    svc.exchangeForWrite.mockRejectedValue(Object.assign(new Error('down'), { status: 502, code: 'exchange_failed' }));
    const before = store.get(String(user.id)).expenses.find((e) => e.id === pending.id).status;

    const res = await request(app)
      .post(`/api/admin/workforce/expenses/${pending.id}/approve`)
      .send({ userId: String(user.id) });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('exchange_failed');
    expect(res.body.tokenChain.map((e) => e.id)).toEqual(['operator-session', 'operator-verification', 'exchange']);
    expect(res.body.tokenChain[2].status).toBe('error');
    const after = store.get(String(user.id)).expenses.find((e) => e.id === pending.id).status;
    expect(after).toBe(before);
  });

  test('verify/otp returns the sign-on + token chain', async () => {
    const { user } = workforceFixture();
    const app = buildApp();
    svc.submitCustomerOtp.mockImplementation((req) => {
      req.session.support = { customerId: String(user.id), verifiedUntil: Date.now() + 900000 };
      return Promise.resolve({ verified: true, expiresAt: Date.now() + 900000, tokenEvent: { id: 'customer-token-issued', label: 'Customer token issued', status: 'done', claims: {} } });
    });
    const res = await request(app).post('/api/admin/workforce/verify/otp').send({ otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.tokenChain.map((e) => e.id)).toEqual(['customer-signon', 'customer-token-issued']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/operatorTokenChain.delegation.test.js`
Expected: FAIL — `verify/otp` 404s; approve returns today's chain (no `exchange` hop, no `delegated` field)

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/routes/adminVerticals.js`:

```js
const supportDelegation = require('../services/supportDelegationService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');

// The single real write scope on the enduser resource (scope-topology.json:
// "Super Banking API"). The console's per-vertical permission labels
// (transactions:write / general:write) are the client's advisory vocabulary;
// the delegated token asks for THIS scope. One map, one place.
const SUPPORT_WRITE_SCOPE = 'write';
```

Replace `verifyInitiate` with the ceremony starter (keep the same route + guard):

```js
// POST /<vertical>/verify/initiate — open the customer's REAL sign-on
// (headless pi.flow). The BFF submits the password from config; the flow
// stops at the customer's OTP device. The operator's browser never sees a
// token — only which masked contact the code went to.
async function verifyInitiate(req, res) {
  const customerId = req.body?.customerId;
  if (!customerId) return res.status(400).json({ ok: false, error: 'customerId is required' });
  const local = dataStore.getUserById(String(customerId));
  if (!local || local.role === 'admin') return res.status(404).json({ ok: false, error: 'unknown user' });
  let pingOneUserId = local.oauthId || null;
  if (!pingOneUserId) {
    try {
      const { user: linked } = await fetchPingOneUserByUsername(local.username);
      pingOneUserId = linked?.id || null;
    } catch (_) { pingOneUserId = null; }
  }
  if (!pingOneUserId) return res.status(409).json({ ok: false, error: 'customer_not_linked', message: `${local.username} has no PingOne account to sign on with.` });
  try {
    const out = await supportDelegation.openCustomerSignon(req, {
      username: local.username, pingOneUserId, customerId: String(customerId),
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.code || 'pi_flow_failed', message: e.message });
  }
}

// POST /<vertical>/verify/otp — complete the customer's sign-on with the
// code from their device. Mints the customer token into session.support.
async function verifyOtp(req, res) {
  const verticalId = String(req.path || '').split('/').filter(Boolean)[0];
  try {
    const out = await supportDelegation.submitCustomerOtp(req, { otp: req.body?.otp });
    // Stamp vertical like the write chain — the console hides foreign chains.
    const chain = [
      ...supportDelegation.buildSignonEvents(req.session.support),
      out.tokenEvent,
    ].map((e) => ({ ...e, vertical: verticalId }));
    res.json({ ok: true, verified: out.verified, expiresAt: out.expiresAt, tokenChain: chain });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.code || 'pi_flow_failed', message: e.message });
  }
}
```

Register: `router.post(\`/${id}/verify/otp\`, ...ADMIN_WRITE, verifyOtp);` next to the existing `verify/initiate` line.

Extend `writeAction` — exchange BEFORE the mutator (after the row-existence check and the ADMIN_WRITE verification middleware):

```js
    // Real delegation: exchange subject=customer + actor=admin client for a
    // short-lived delegated token whose act claim names the operator's client.
    // Exchange failure aborts the write BEFORE the mutator — nothing mutates
    // under an unproven actor.
    let delegated = null;
    let exchangeEvent = null;
    try {
      const x = await supportDelegation.exchangeForWrite(req, { scope: SUPPORT_WRITE_SCOPE });
      delegated = {
        sub: x.delegatedClaims.sub || null,
        actSub: x.delegatedClaims.act?.sub || null,
        scope: x.delegatedClaims.scope || SUPPORT_WRITE_SCOPE,
        jti: x.delegatedClaims.jti || null,
        aud: x.delegatedClaims.aud || null,
      };
      exchangeEvent = supportDelegation.buildExchangeEvents({ delegatedClaims: x.delegatedClaims, request: x.request })[0];
    } catch (e) {
      const tokenChain = buildOperatorDenialChain(req, {
        vertical: verticalId, customerId: String(userId), action: `${req.method} ${req.originalUrl}`,
      });
      tokenChain.push({ id: 'exchange', label: 'RFC 8693 exchange — act on behalf of', status: 'error',
        vertical: verticalId, claims: {}, explanation: e.message || 'Exchange failed — the write did not proceed.' });
      return res.status(e.status || 502).json({ ok: false, error: e.code || 'exchange_failed', message: e.message, tokenChain });
    }
```

…and in the success response, extend the chain + audit:

```js
    const tokenChain = buildOperatorWriteChain(req, {
      vertical: verticalId,
      customerId: String(userId),
      verifiedUntil: verificationExpiry(req, userId),
      action,
      row: item.id !== undefined ? item.id : id,
      beforeStatus: existing.status ?? null,
      afterStatus: item.status ?? null,
      request: { method: req.method, url: req.originalUrl },
      result: item,
    });
    // Insert the real-evidence hops: customer token + exchange, in wire order.
    // Stamp vertical on them like the operator hops — the console hides a
    // chain whose operator/ceremony events belong to a different vertical.
    const signonTokenEvent = supportDelegation.buildCustomerTokenEvent(req.session.support);
    const exchangeHop = { ...exchangeEvent, vertical: verticalId };
    signonTokenEvent.vertical = verticalId;
    tokenChain.splice(2, 0, signonTokenEvent, exchangeHop);
    // The audit hop records the delegated token's provenance.
    const audit = tokenChain[tokenChain.length - 1];
    audit.claims.actSub = delegated.actSub;
    audit.claims.jti = delegated.jti;
    audit.claims.delegatedScope = delegated.scope;
    res.json({ ok: true, item, delegated, tokenChain });
```

In `services/operatorTokenChain.js` update `buildOperatorWriteChain`'s doc comment: the chain now hosts ceremony events inserted by the route (keep the function's signature — the route splices). Also extend `operatorVerificationEvent`'s explanation to say the verification is a real customer sign-on.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/operatorTokenChain.delegation.test.js tests/operatorTokenChain.write.test.js`
Expected: delegation suite PASS (3); existing write suite — 2 tests now FAIL (chain shape changed: `customer-token-issued` + `exchange` inserted). Update those two expectations to the new six-hop shape (same assertion style, new id list + `delegated` assertions) and re-run to PASS. This is a deliberate contract change; the spec documents it.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/adminVerticals.js demo_api_server/services/operatorTokenChain.js demo_api_server/tests/operatorTokenChain.delegation.test.js demo_api_server/tests/operatorTokenChain.write.test.js
git commit -m "feat(bff): support writes run under a real delegated act token"
```

---

### Task 5: requireCustomerVerified demands the live ceremony token

**Files:**
- Modify: `demo_api_server/middleware/requireCustomerVerified.js`
- Test: `demo_api_server/tests/requireCustomerVerified.delegation.test.js`

**Interfaces:**
- Consumes: `supportDelegationService.liveSupportSession(req, customerId)` (Task 2), injected as a dependency (`makeRequireCustomerVerified({ isCustomerVerified, recordAudit, liveSupportSession })`) to preserve the no-circular-require pattern; `adminVerticals.js` passes it at construction.
- Produces: middleware passes when `liveSupportSession(req, customerId)` returns non-null (live customer token + TTL); otherwise the same 403 + denial chain as today. `isCustomerVerified` remains as a fallback diagnostic ONLY IF the ceremony session is absent (so a stale session pre-upgrade still 403s with the old shape, never a crash).

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// tests/requireCustomerVerified.delegation.test.js
const { makeRequireCustomerVerified } = require('../middleware/requireCustomerVerified');

function run(mw, { userId, support, isVerified = false }) {
  const req = { method: 'POST', originalUrl: '/api/admin/workforce/expenses/204/approve', body: { userId }, session: { support } };
  const res = { status(s) { this.statusCode = s; return { json(b) { this.body = b; } }; } };
  let next = false;
  mw(req, res, () => { next = true; });
  return { next, statusCode: res.statusCode, body: res.body };
}

describe('requireCustomerVerified with the ceremony token', () => {
  const recordAudit = jest.fn();
  const make = (live) => makeRequireCustomerVerified({
    isCustomerVerified: () => false,
    recordAudit,
    liveSupportSession: live,
  });

  it('passes when the ceremony session is live for THIS customer', () => {
    const live = jest.fn(() => ({ subjectToken: 't', verifiedUntil: Date.now() + 1000 }));
    const r = run(make(live), { userId: '5', support: {} });
    expect(r.next).toBe(true);
    expect(live).toHaveBeenCalledWith(expect.anything(), '5');
  });

  it('403s customer_not_verified when no live ceremony session exists', () => {
    const r = run(make(() => null), { userId: '5', support: null });
    expect(r.next).toBe(false);
    expect(r.statusCode).toBe(403);
    expect(r.body.error).toBe('customer_not_verified');
    expect(r.body.tokenChain.map((e) => e.id)).toEqual(['operator-session', 'operator-verification', 'operator-audit']);
  });

  it('403s when the ceremony session belongs to a DIFFERENT customer', () => {
    const live = jest.fn(() => null); // liveSupportSession already mismatches by id
    const r = run(make(live), { userId: '7', support: { customerId: '5' } });
    expect(r.next).toBe(false);
    expect(r.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/requireCustomerVerified.delegation.test.js`
Expected: FAIL — `makeRequireCustomerVerified` ignores `liveSupportSession` (all tests behave per the old TTL check; test 1 fails on `next === false`)

- [ ] **Step 3: Write minimal implementation**

```js
function makeRequireCustomerVerified({ isCustomerVerified, recordAudit, liveSupportSession }) {
  return function requireCustomerVerified(req, res, next) {
    const customerId = req.body?.userId || req.params?.customerId;
    if (!customerId) return next(); // the route's own 400 handles this

    // The authority is the LIVE ceremony session: a customer token minted by
    // the customer's own sign-on, TTL-bounded, keyed to THIS customer. The
    // legacy TTL flag stays as the denial-chain fallback for a session that
    // predates the ceremony (old BFF behind new UI) but no longer grants.
    if (liveSupportSession && liveSupportSession(req, customerId)) return next();
    if (isCustomerVerified(req, customerId) && req.session?.support?.subjectToken) return next();

    const action = `${req.method} ${req.originalUrl}`;
    recordAudit(req, { action, customerId: String(customerId), outcome: 'denied' });
    const tokenChain = buildOperatorDenialChain(req, {
      vertical: String(req.path || '').split('/').filter(Boolean)[0],
      customerId, action,
    });
    return res.status(403).json({ error: 'customer_not_verified', customerId: String(customerId), need_verification: true, tokenChain });
  };
}
```

In `routes/adminVerticals.js`, update the construction: `makeRequireCustomerVerified({ isCustomerVerified, recordAudit, liveSupportSession: supportDelegation.liveSupportSession })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/requireCustomerVerified.delegation.test.js tests/operatorTokenChain.write.test.js tests/operatorTokenChain.delegation.test.js`
Expected: all PASS (the write suites' mocks set `liveSupportSession` accordingly — Task 4's mock already does)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/middleware/requireCustomerVerified.js demo_api_server/routes/adminVerticals.js demo_api_server/tests/requireCustomerVerified.delegation.test.js
git commit -m "feat(bff): write gate demands the live customer sign-on session"
```

---

### Task 6: UI — IdentityGate two-phase + chain rendering

**Files:**
- Modify: `demo_api_ui/src/components/supportConsole/IdentityGate.jsx`
- Modify: `demo_api_ui/src/services/tokenChainTrace/operatorChainSteps.js`
- Modify: `demo_api_ui/src/components/supportConsole/__tests__/SupportConsole.tokenChain.test.jsx` (fixture)
- Test: `demo_api_ui/src/components/supportConsole/__tests__/IdentityGate.delegation.test.jsx`

**Interfaces:**
- Consumes: `bffAxios.post('/api/admin/<v>/verify/initiate', { customerId })` → `{ ok, step:'otp', maskedContact }`; `bffAxios.post('/api/admin/<v>/verify/otp', { otp })` → `{ ok, verified, expiresAt, tokenChain }` (same bffAxios both suites already mock).
- Produces: same `onVerified(expiresAt)` contract to SupportConsole (unchanged caller); `operatorChainSteps` handles the two new event ids: `customer-signon` (lane PINGONE), `customer-token-issued` (lane PINGONE) — the `exchange` id already renders (Task 4's chain uses it).

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/supportConsole/__tests__/IdentityGate.delegation.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IdentityGate from '../IdentityGate';

vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { post: vi.fn(), get: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
import bffAxios from '../../../services/bffAxios';

const CUSTOMER = { id: '5', name: 'Demo User' };

beforeEach(() => { bffAxios.post.mockReset(); });

it('initiate shows the OTP input with the masked contact; otp completes', async () => {
  const onVerified = vi.fn();
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, step: 'otp', maskedContact: '••••86' } })
    .mockResolvedValueOnce({ data: { ok: true, verified: true, expiresAt: Date.now() + 900000, tokenChain: [] } });

  render(<IdentityGate vertical="workforce" customer={CUSTOMER} verified={false} onVerified={onVerified} />);
  fireEvent.click(screen.getByRole('button', { name: /verify customer/i }));
  await waitFor(() => expect(screen.getByText(/••••86/)).toBeInTheDocument());
  expect(bffAxios.post).toHaveBeenCalledWith('/api/admin/workforce/verify/initiate', { customerId: '5' });

  fireEvent.change(screen.getByLabelText(/one-time code/i), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
  await waitFor(() => expect(onVerified).toHaveBeenCalled());
  expect(bffAxios.post).toHaveBeenCalledWith('/api/admin/workforce/verify/otp', { otp: '123456' });
});

it('a wrong OTP keeps the input open and shows the server message', async () => {
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, step: 'otp', maskedContact: '••••86' } })
    .mockRejectedValueOnce({ response: { status: 401, data: { error: 'invalid_otp', message: 'That code is not valid.' } } });

  render(<IdentityGate vertical="workforce" customer={CUSTOMER} verified={false} onVerified={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /verify customer/i }));
  await waitFor(() => expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/one-time code/i), { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
  await waitFor(() => expect(screen.getByText(/not valid/i)).toBeInTheDocument());
  expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument(); // still open
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/supportConsole/__tests__/IdentityGate.delegation.test.jsx`
Expected: FAIL — no "verify customer" button (current copy is "Send one-time code" with no OTP phase)

- [ ] **Step 3: Write minimal implementation**

Rewrite `IdentityGate.jsx`:

```jsx
import React, { useCallback, useState } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifyError, notifySuccess } from '../../utils/appToast';
import './IdentityGate.css';

// Verifies the CUSTOMER by having them complete a real sign-on: the BFF
// drives PingOne (pi.flow) with the customer's credentials and the flow
// stops at the customer's own OTP device. The operator enters the code the
// customer reads out. On success the BFF holds the customer's token
// server-side; this component only ever sees masked contacts and expiry.
export default function IdentityGate({ vertical, customer, verified, onVerified }) {
  const [phase, setPhase] = useState('idle'); // idle | otp
  const [maskedContact, setMaskedContact] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const initiate = useCallback(async () => {
    if (!customer) return;
    setBusy(true); setError('');
    try {
      const { data } = await bffAxios.post(`/api/admin/${vertical}/verify/initiate`, { customerId: customer.id });
      setMaskedContact(data.maskedContact || 'the customer\'s registered device');
      setPhase('otp');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Could not start the customer sign-on.');
    } finally { setBusy(false); }
  }, [vertical, customer]);

  const submitOtp = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const { data } = await bffAxios.post(`/api/admin/${vertical}/verify/otp`, { otp });
      notifySuccess('Customer verified.');
      onVerified(data.expiresAt);
      setPhase('idle');
    } catch (err) {
      setError(err?.response?.data?.message || 'Verification failed.');
    } finally { setBusy(false); }
  }, [vertical, otp, onVerified]);

  if (!customer) return null;

  return (
    <div className="idgate" data-testid="identity-gate" data-verified={String(!!verified)}>
      <span className={`idgate__badge idgate__badge--${verified ? 'ok' : 'warn'}`}>
        {verified ? '✅ Identity verified' : '⚠️ Not verified'}
      </span>
      <span className="idgate__text">
        {verified
          ? `${customer.name} completed a real sign-on (pi.flow + OTP). Writes run under a delegated token.`
          : `${customer.name} must complete a real sign-on before writes are enabled.`}
      </span>
      {!verified && phase === 'idle' && (
        <button type="button" className="idgate__btn" onClick={initiate} disabled={busy}>
          {busy ? 'Starting…' : 'Verify customer'}
        </button>
      )}
      {!verified && phase === 'otp' && (
        <span className="idgate__otp">
          <label htmlFor="idgate-otp">One-time code sent to {maskedContact}</label>
          <input id="idgate-otp" value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          <button type="button" className="idgate__btn" onClick={submitOtp} disabled={busy || !otp.trim()}>
            {busy ? 'Checking…' : 'Submit code'}
          </button>
        </span>
      )}
      {error && <span className="idgate__error" role="alert">{error}</span>}
    </div>
  );
}
```

(`.idgate__otp` / `.idgate__error` styles: two small rules in `IdentityGate.css` — flex gap 8, red text — matching the file's existing style density.)

Extend `operatorChainSteps.js`'s lane map:

```js
    lane: event.id === 'operator-session' ? "BROWSER"
      : event.id === 'customer-signon' || event.id === 'customer-token-issued' ? "PINGONE"
      : event.id === 'operator-verification' ? "PINGONE"
      : event.id === 'exchange' ? "BFF"
      : event.id === 'operator-write' ? "API"
      : "DATA",
```

And let the `exchange` event's existing `claims`/`request` rendering carry the act hop (it already renders `claims` + `request` + `result`; no further change needed).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/supportConsole/__tests__/`
Expected: new suite PASS (2); update the two existing console tests' verify mock from `verify/initiate` returning `expiresAt` to the two-phase mocks (initiate → otp step; otp → verified+expiresAt) — `SupportConsole.tokenChain.test.jsx` and `SupportConsole.test.jsx` both click "send one-time code"; change the button-name regex to `/verify customer/i` and add the second POST mock.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/supportConsole/IdentityGate.jsx demo_api_ui/src/components/supportConsole/IdentityGate.css demo_api_ui/src/services/tokenChainTrace/operatorChainSteps.js demo_api_ui/src/components/supportConsole/__tests__/
git commit -m "feat(ui): two-phase customer verification (initiate + OTP) in the support console"
```

---

### Task 7: Demo track — support trackId + observeSupportEvent

**Files:**
- Create: `demo_api_server/config/supportDemoTrack.js`
- Modify: `demo_api_server/services/demoTrackService.js`
- Modify: `demo_api_server/routes/demoTrack.js`
- Test: `demo_api_server/tests/demoTrackService.supportTrack.test.js`

**Interfaces:**
- Consumes: existing `demoTrackService` internals (`_bucketKey`, `_ensureRun`, `_fill`, `_candidates`).
- Produces:
  - `getState(sessionId, trackId='main')`, `startRun(sessionId, trackId='main')`, `setActiveStep(stepId, sessionId, trackId='main')`, `armSlot({stepId,color}, sessionId, trackId='main')`, `observeSupportEvent(event, sessionId)`.
  - `observeSupportEvent` events (from supportDelegationService/route layer): `{ kind:'otp-invalid' }` fills red of `support-verify`; `{ kind:'token-issued' }` fills green of `support-verify`; `{ kind:'exchange', ok, actSub }` fills green/red of `support-exchange`; `{ kind:'write', ok }` fills green of `support-write`; `{ kind:'write-denied' }` fills red of `support-write`.
  - `SUPPORT_TRACK_STEPS`: 3 steps (`support-verify`, `support-exchange`, `support-write`), `act: 1`, `trackId: 'support'`, same slots/proved shape as TRACK_STEPS.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// tests/demoTrackService.supportTrack.test.js
const svc = require('../services/demoTrackService');

describe('support track isolation + observation', () => {
  beforeEach(() => svc._resetForTests());

  it('support events fill support slots only; main calls never cross', () => {
    const session = 'sess-support-1';
    svc.startRun(session, 'support');
    svc.observeSupportEvent({ kind: 'token-issued' }, session);
    let { run } = svc.getState(session, 'support');
    expect(run.slots['support-verify:green'].verdict).toBe('PERMIT');
    // a main-track tool call must not touch the support track
    svc.observeToolCall({ toolName: 'transfer_funds', success: true }, session);
    ({ run } = svc.getState(session, 'support'));
    expect(run.slots['support-exchange:green']).toBeUndefined();
    // main track unaffected by support events
    svc.observeSupportEvent({ kind: 'exchange', ok: true, actSub: 'admin-cid' }, session);
    const main = svc.getState(session, 'main');
    expect(main.run.slots['delegated-access:green']).toBeUndefined();
  });

  it('wrong OTP fills the red slot; a later correct OTP fills green', () => {
    const session = 'sess-support-2';
    svc.startRun(session, 'support');
    svc.observeSupportEvent({ kind: 'otp-invalid' }, session);
    let { run } = svc.getState(session, 'support');
    expect(run.slots['support-verify:red'].verdict).toBe('BLOCKED');
    svc.observeSupportEvent({ kind: 'token-issued' }, session);
    ({ run } = svc.getState(session, 'support'));
    expect(run.slots['support-verify:green'].verdict).toBe('PERMIT');
  });

  it('write-denied fills the write red slot with the 403 story', () => {
    const session = 'sess-support-3';
    svc.startRun(session, 'support');
    svc.observeSupportEvent({ kind: 'write-denied' }, session);
    const { run } = svc.getState(session, 'support');
    expect(run.slots['support-write:red'].verdict).toBe('BLOCKED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/demoTrackService.supportTrack.test.js`
Expected: FAIL — `startRun` ignores the second arg; `observeSupportEvent is not a function`

- [ ] **Step 3: Write minimal implementation**

Create `demo_api_server/config/supportDemoTrack.js`:

```js
'use strict';
/**
 * Support-console demo track — the operator delegation ceremony as three
 * presenter steps. Same shape as config/demoTrack.js TRACK_STEPS; slots fill
 * ONLY from the real ceremony's outcomes (observeSupportEvent), never from
 * UI state. Spec: docs/superpowers/specs/2026-10-11-support-console-real-delegation-design.md
 */
const SUPPORT_TRACK_STEPS = [
  {
    stepId: 'support-verify', act: 1, trackId: 'support', title: 'Verify the customer — real sign-on',
    capability: 'pi.flow · MFA',
    buyerStory: 'Before an operator touches customer data, the customer proves their identity with a real sign-on.',
    slots: {
      green: { source: 'support', event: 'token-issued' },
      red: { source: 'support', event: 'otp-invalid' },
    },
    proved: {
      green: 'The customer completed a real PingOne sign-on — password + one-time code on their own device. The token lives server-side in the operator session.',
      red: 'A wrong code was refused by PingOne — the ceremony cannot be talked past.',
      sayThis: 'Identity proofing happens before authority does — the operator acts only for a customer who proved themselves.',
    },
  },
  {
    stepId: 'support-exchange', act: 1, trackId: 'support', title: 'Act on their behalf — RFC 8693',
    capability: 'RFC 8693 · act claim',
    buyerStory: 'The write must carry proof of who acted for whom — minted live, not asserted.',
    slots: {
      green: { source: 'support', event: 'exchange-ok' },
      red: { source: 'support', event: 'exchange-failed' },
    },
    proved: {
      green: 'PingOne minted a delegated token with act.sub = the admin client — the operator acted FOR the customer, cryptographically.',
      red: 'No ceremony token, no exchange — the write was refused before anything ran.',
      sayThis: 'Delegation is a token property, not a UI state.',
    },
  },
  {
    stepId: 'support-write', act: 1, trackId: 'support', title: 'The write — under the delegated token',
    capability: 'Audit · act provenance',
    buyerStory: 'Every operator action is attributable to a real human through the delegated token.',
    slots: {
      green: { source: 'support', event: 'write-ok' },
      red: { source: 'support', event: 'write-denied' },
    },
    proved: {
      green: 'The write succeeded and the audit records act.sub and the token\'s jti.',
      red: 'Without the ceremony the write was refused — the control is the gate, not the form.',
      sayThis: 'Accountability: who acted, for whom, on what evidence.',
    },
  },
];

function getSupportTrackDefinition() {
  return { steps: SUPPORT_TRACK_STEPS.map((s, i) => ({ ...s, n: i + 1 })) };
}

module.exports = { SUPPORT_TRACK_STEPS, getSupportTrackDefinition };
```

In `demo_api_server/services/demoTrackService.js`:
- Import `SUPPORT_TRACK_STEPS`; add `const TRACKS = { main: TRACK_STEPS, support: SUPPORT_TRACK_STEPS }; const _stepsFor = (trackId) => TRACKS[trackId] || TRACK_STEPS;`
- Track-scoped buckets: change `_bucketKey(sessionId)` call sites to `_bucketKey(sessionId, trackId)` producing `` `${sessionId}:${trackId}` `` (default `'main'` keeps existing keys only if the legacy key had no suffix — instead keep the existing key UNCHANGED for main and use `${sessionId}:support` for support, preserving the live demo's persisted state).
- Thread `trackId` through `getState/startRun/setActiveStep/armSlot/_candidates/_stepById/_advanceIfComplete`.
- Add:

```js
const SUPPORT_EVENT_SLOTS = {
  'otp-invalid': { stepId: 'support-verify', color: 'red', verdict: 'BLOCKED', reason: 'PingOne refused the one-time code — the customer sign-on cannot be completed without their device.' },
  'token-issued': { stepId: 'support-verify', color: 'green', verdict: 'PERMIT', reason: 'Customer sign-on completed — a real PingOne token was minted and held server-side.' },
  'exchange-ok': { stepId: 'support-exchange', color: 'green', verdict: 'PERMIT', reason: 'RFC 8693 exchange returned a delegated token carrying the act claim.' },
  'exchange-failed': { stepId: 'support-exchange', color: 'red', verdict: 'BLOCKED', reason: 'The exchange failed — no delegated token, no write.' },
  'write-ok': { stepId: 'support-write', color: 'green', verdict: 'PERMIT', reason: 'The write executed under the delegated token; the audit records act.sub and jti.' },
  'write-denied': { stepId: 'support-write', color: 'red', verdict: 'BLOCKED', reason: 'The verification gate refused the write — no ceremony, no authority.' },
};

/** Fill support-track slots from the real ceremony's outcomes. Never throws. */
function observeSupportEvent(event, sessionId) {
  try {
    const map = SUPPORT_EVENT_SLOTS[event?.kind];
    if (!map) return;
    const bucket = _bucketKey(sessionId, 'support');
    const run = _ensureRun(bucket, 'support');
    _fill(bucket, run, map.stepId, map.color, { verdict: map.verdict, at: new Date().toISOString(), reason: map.reason, ...(event.detail || {}) });
  } catch { /* track observation is optional */ }
}
```

(Match the actual `_fill`/`_ensureRun` signatures while implementing — they may carry `trackId` after the threading step.)

In `routes/demoTrack.js`: `const trackId = req.query.track === 'support' ? 'support' : 'main';` on GET `/`; the POST routes read `req.body?.track` the same way; pass through to the service.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/demoTrackService.supportTrack.test.js` and then the service's existing suite (`npx jest tests/demoTrack -i` — locate the existing demo-track tests with `ls tests | grep -i track`) to confirm no main-track regression.
Expected: new suite PASS; existing suites PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/supportDemoTrack.js demo_api_server/services/demoTrackService.js demo_api_server/routes/demoTrack.js demo_api_server/tests/demoTrackService.supportTrack.test.js
git commit -m "feat(track): support demo track — slots fill from real ceremony evidence"
```

---

### Task 8: Wire the ceremony outcomes to the track + emit events

**Files:**
- Modify: `demo_api_server/routes/adminVerticals.js`
- Modify: `demo_api_server/services/supportDelegationService.js`
- Test: covered by Task 4's suite (assert `observeSupportEvent` was called) — extend `tests/operatorTokenChain.delegation.test.js`

**Interfaces:**
- Consumes: `demoTrackService.observeSupportEvent(event, req.sessionID)` (Task 7).
- Produces: ceremony outcomes stamp the support track — `submitCustomerOtp` success → `{kind:'token-issued'}`; invalid OTP → `{kind:'otp-invalid'}`; `exchangeForWrite` success → `{kind:'exchange-ok', detail:{actSub}}`; exchange failure → `{kind:'exchange-failed'}`; write success → `{kind:'write-ok'}`; 403 denial → `{kind:'write-denied'}`.

- [ ] **Step 1: Write the failing test**

Add to `tests/operatorTokenChain.delegation.test.js` (mock the track service):

```js
jest.mock('../services/demoTrackService', () => ({
  observeSupportEvent: jest.fn(),
  observeToolCall: jest.fn(),
  observeDecision: jest.fn(),
}));
const demoTrackService = require('../services/demoTrackService');

describe('support track observations from the ceremony', () => {
  test('a successful write stamps write-ok and exchange-ok', async () => {
    const { user, pending } = workforceFixture();
    const app = buildApp();
    svc.liveSupportSession.mockImplementation((req) => {
      req.session.support = { customerId: String(user.id), subjectToken: 's.j.v', verifiedUntil: Date.now() + 900000 };
      return req.session.support;
    });
    svc.exchangeForWrite.mockResolvedValue({
      delegatedToken: 'd.j.v',
      delegatedClaims: { sub: '1583af47', act: { sub: 'admin-cid' }, scope: 'write', jti: 'j-1' },
      request: { audience: 'a', scope: 'write', hasActor: true },
    });
    await request(app).post(`/api/admin/workforce/expenses/${pending.id}/approve`).send({ userId: String(user.id) });
    const kinds = demoTrackService.observeSupportEvent.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain('exchange-ok');
    expect(kinds).toContain('write-ok');
  });

  test('a 403 denial stamps write-denied', async () => {
    const { user, pending } = workforceFixture();
    const app = buildApp();
    svc.liveSupportSession.mockReturnValue(null);
    await request(app).post(`/api/admin/workforce/expenses/${pending.id}/approve`).send({ userId: String(user.id) });
    expect(demoTrackService.observeSupportEvent).toHaveBeenCalledWith({ kind: 'write-denied' }, expect.anything());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/operatorTokenChain.delegation.test.js`
Expected: the two new tests FAIL (no `observeSupportEvent` calls yet)

- [ ] **Step 3: Write minimal implementation**

- In `adminVerticals.js` `writeAction`: after a successful exchange, `demoTrackService.observeSupportEvent({ kind: 'exchange-ok', detail: { actSub: delegated.actSub } }, req.sessionID);` and after the mutator + audit, `observeSupportEvent({ kind: 'write-ok' }, req.sessionID);`
- In the exchange-failure branch: `observeSupportEvent({ kind: 'exchange-failed' }, req.sessionID);`
- In `requireCustomerVerified`'s 403 path (adminVerticals' construction site or the middleware — put it in the middleware next to `recordAudit`): `require('../services/demoTrackService').observeSupportEvent?.({ kind: 'write-denied' }, req.sessionID);` inside the existing try/catch-free best-effort style (`?.` + try/catch).
- In `supportDelegationService.submitCustomerOtp`: on success `require('./demoTrackService').observeSupportEvent?.({ kind: 'token-issued' }, req.sessionID);` (late-require pattern, same as mcpToolAuditStore.js:67); in the `invalid_otp` branch before throwing: `observeSupportEvent({ kind: 'otp-invalid' })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/operatorTokenChain.delegation.test.js tests/supportDelegationService.piFlow.test.js`
Expected: PASS (add the sessionID-mocking as needed — the fake session in piFlow tests has no sessionID; the late-require + `?.` keeps them passing)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/adminVerticals.js demo_api_server/middleware/requireCustomerVerified.js demo_api_server/services/supportDelegationService.js demo_api_server/tests/operatorTokenChain.delegation.test.js
git commit -m "feat(track): stamp the support track from real ceremony outcomes"
```

---

### Task 9: UI — support track band + tab + hero button

**Files:**
- Modify: `demo_api_ui/src/components/DemoTrackBand.jsx` (accept `trackId`, default `'main'`)
- Modify: `demo_api_ui/src/components/TokenChainDemoTrackTab.jsx` (same)
- Modify: `demo_api_ui/src/components/TokenChainTraceRail.jsx` (thread `trackId` prop through to both; default `'main'`)
- Modify: `demo_api_ui/src/components/supportConsole/SupportConsole.jsx` (mount rail with `trackId="support"`; hero "Demo steps ↗" button)
- Modify: `demo_api_ui/src/components/supportConsole/SupportConsole.css` (button style)
- Test: `demo_api_ui/src/components/supportConsole/__tests__/SupportConsole.demoTrack.test.jsx`

**Interfaces:**
- Consumes: `/api/demo-track?track=support` (Task 7) via the existing apiClient fetch in both components; the rail's `jumpToTrace` ref pattern for the hero button.
- Produces: `TokenChainTraceRail({ trackId })` — every existing caller unchanged (default `'main'`).

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/supportConsole/__tests__/SupportConsole.demoTrack.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SupportConsole from '../SupportConsole';
import { tokenChainTraceStore } from '../../../services/tokenChainTrace/tokenChainTraceStore';

vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
vi.mock('../../../services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import apiClient from '../../../services/apiClient';

beforeEach(() => {
  tokenChainTraceStore.reset();
  apiClient.get.mockReset(); apiClient.post.mockReset();
});

it("the console's track band fetches the support track and the hero button opens it", async () => {
  apiClient.get.mockResolvedValue({ data: { track: { steps: [
    { stepId: 'support-verify', act: 1, title: 'Verify the customer — real sign-on' },
    { stepId: 'support-exchange', act: 1, title: 'Act on their behalf — RFC 8693' },
    { stepId: 'support-write', act: 1, title: 'The write — under the delegated token' },
  ] }, run: { activeStepId: 'support-verify', slots: {} } } });

  render(<SupportConsole vertical="workforce" user={{ role: 'admin' }} />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/demo-track?track=support'));
  // the band renders the support titles
  await waitFor(() => expect(screen.getAllByText(/Verify the customer/i).length).toBeGreaterThan(0));
  // hero button scrolls the track into view
  fireEvent.click(screen.getByRole('button', { name: /demo steps/i }));
  expect(screen.getByRole('button', { name: /demo steps/i })).toBeInTheDocument();
});
```

Note: the rail fetches the track only when `!mcpRouteOnly` (existing effect at TokenChainTraceRail.jsx:371) — the console already mounts the full rail, so the band mounts; the test asserts the `?track=support` query.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/supportConsole/__tests__/SupportConsole.demoTrack.test.jsx`
Expected: FAIL — apiClient called with plain `/api/demo-track` (no track param), no "Demo steps" button

- [ ] **Step 3: Write minimal implementation**

- `TokenChainTraceRail`: add `trackId = 'main'` prop; in the track-fetch effect (line ~371), fetch `trackId === 'main' ? '/api/demo-track' : '/api/demo-track?track=' + trackId`; thread to `<DemoTrackBand track={track} … />` (no prop needed — the fetched data is already the right track) and `<TokenChainDemoTrackTab trackId={trackId} />`.
- `DemoTrackBand`: no change (it renders whatever track array it's given).
- `TokenChainDemoTrackTab`: accept `trackId='main'`; all its `apiClient.get('/api/demo-track')` / `post('/api/demo-track/…')` calls append `?track=` / `{ track }` respectively; the "Open full track page" link becomes `/demo-track?track=support` when trackId is support.
- `SupportConsole`: pass `trackId="support"` to `<TokenChainTraceRail trackId="support" />`; add the hero button:

```jsx
        <button type="button" className="vops__demosteps-btn" onClick={jumpToTrace}>
          Demo steps ↗
        </button>
```

`jumpToTrace` already scrolls to the trace details — retarget it to the band: give the rail's wrapping `<details>` a second ref is unnecessary; keep `jumpToTrace` as-is (it scrolls to the chain, whose band sits at its top).
CSS: one rule mirroring `.vops__jumpbtn` (same `.vops .vops__demosteps-btn` specificity, `margin-left: 8px`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/supportConsole/__tests__/ src/components/__tests__/TokenChainTraceRail.test.jsx`
Expected: new suite PASS; TraceRail suite PASS (default trackId unchanged); update any console test asserting the plain `/api/demo-track` fetch if present.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/DemoTrackBand.jsx demo_api_ui/src/components/TokenChainDemoTrackTab.jsx demo_api_ui/src/components/TokenChainTraceRail.jsx demo_api_ui/src/components/supportConsole/SupportConsole.jsx demo_api_ui/src/components/supportConsole/SupportConsole.css demo_api_ui/src/components/supportConsole/__tests__/SupportConsole.demoTrack.test.jsx
git commit -m "feat(ui): support console mounts the demo steps track with a hero link"
```

---

### Task 10: Full-suite verification + live acceptance

**Files:**
- No production changes. Verification only.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full server suite**

Run: `cd demo_api_server && npx jest`
Expected: all suites pass (the known parallel-run New Relic flakes excluded — if they appear, re-run the named suites in isolation and record the comparison as done in prior sessions).

- [ ] **Step 2: Full UI suite + build**

Run: `cd demo_api_ui && npx vitest run && npx vite build`
Expected: all pass; build clean.

- [ ] **Step 3: Focused deploy**

Run: `cd /Users/cmuir/Development/AI-DEMO2 && ./run-docker.sh build demo-api-server ui`
Expected: both containers recreated healthy; `/api/healthz` 200; `/admin/workforce` 200.

- [ ] **Step 4: Live acceptance (manual, needs the customer's phone)**

1. Sign in as admin at `https://local.ping-devops.com:4000/admin/workforce` (demoAdmin / Baseball123! / real SMS OTP to ••••86).
2. Look up `demoUser`, click **Verify customer**.
3. PingOne texts demoUser's device; enter the code; expect "Identity verified".
4. Click **Complete** on a training.
5. **Jump to token chain ↓**: expect six hops — operator-session, operator-verification, customer-token-issued (real sub/scope claims), exchange (real `act.sub` = admin client id, `aud` = enduser.ping.demo, 5-min scope), operator-write (before/after), operator-audit (actSub + jti).
6. **Demo steps ↗**: expect the 3-step band; the exchange step's green slot filled by the real run.
7. Negative: a second customer's write before verifying them → 403, denial chain, `support-write` red slot filled.

- [ ] **Step 5: Commit any remaining fixture/verification fixes and push**

```bash
git add -A && git commit -m "test: full-suite verification for support delegation" || true
```

(Worktree branch; open the PR, dispatch CI manually per repo memory, merge, focused-deploy — the flow used for PR #1129.)
