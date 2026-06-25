'use strict';
/**
 * PingOne API Integration Tests (Phase 239)
 *
 * Validates that BFF PingOne API calls match documented request/response shapes.
 * Requires live PingOne credentials — tests skip gracefully without them.
 *
 * Run: npm test (in banking_api_server/)
 *
 * PingOne API docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');

const ENV_ID        = process.env.PINGONE_ENVIRONMENT_ID;
const REGION        = process.env.PINGONE_REGION || 'com';
const AUTH_URL      = process.env.PINGONE_AUTH_URL
  || (ENV_ID ? `https://auth.pingone.${REGION}/${ENV_ID}` : null);
const CLIENT_ID     = process.env.PINGONE_WORKER_TOKEN_CLIENT_ID || process.env.PINGONE_CLIENT_ID;
const CLIENT_SECRET = process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET || process.env.PINGONE_CLIENT_SECRET;

const HAVE_CREDENTIALS = !!(ENV_ID && AUTH_URL && CLIENT_ID && CLIENT_SECRET);
const it_ = HAVE_CREDENTIALS ? it : it.skip;

async function getWorkerToken() {
  const res = await axios.post(
    `${AUTH_URL}/as/token`,
    new URLSearchParams({ grant_type: 'client_credentials', scope: 'p1:read:user p1:read:env' }),
    { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return res.data.access_token;
}

// ---------------------------------------------------------------------------
// POST /as/token — client_credentials
// ---------------------------------------------------------------------------
describe('POST /as/token — client_credentials', () => {
  it_('returns access_token with documented fields', async () => {
    const res = await axios.post(
      `${AUTH_URL}/as/token`,
      new URLSearchParams({ grant_type: 'client_credentials', scope: 'p1:read:user' }),
      { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      access_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: expect.any(Number),
    });
  });

  it_('returns documented error shape on bad credentials', async () => {
    try {
      await axios.post(
        `${AUTH_URL}/as/token`,
        new URLSearchParams({ grant_type: 'client_credentials', scope: 'p1:read:user' }),
        { auth: { username: CLIENT_ID, password: 'bad-secret' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBe(401);
      expect(err.response.data).toMatchObject({
        error: expect.any(String),
        error_description: expect.any(String),
      });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /as/introspect — RFC 7662
// ---------------------------------------------------------------------------
describe('POST /as/introspect — RFC 7662', () => {
  it_('returns active:false for invalid token', async () => {
    const res = await axios.post(
      `${AUTH_URL}/as/introspect`,
      new URLSearchParams({ token: 'not-a-real-token' }),
      { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ active: false });
  });

  it_('returns RFC 7662 active:true for valid token with claims', async () => {
    const token = await getWorkerToken();
    const res = await axios.post(
      `${AUTH_URL}/as/introspect`,
      new URLSearchParams({ token }),
      { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      active: true,
      iss: expect.any(String),
      exp: expect.any(Number),
      iat: expect.any(Number),
    });
    // client_credentials tokens use client_id as identity; sub is optional
    expect(res.data.sub || res.data.client_id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/mfaPolicies
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-mfa-policies
// Requires scope: p1:read:mfaPolicy (worker app must have MFA permissions)
// ---------------------------------------------------------------------------
describe('GET /v1/environments/{id}/mfaPolicies', () => {
  const API_URL = ENV_ID ? `https://api.pingone.${REGION}/v1/environments/${ENV_ID}` : null;

  async function getMfaWorkerToken() {
    const res = await axios.post(
      `${AUTH_URL}/as/token`,
      new URLSearchParams({ grant_type: 'client_credentials', scope: 'p1:read:mfaPolicy p1:read:user' }),
      { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return res.data.access_token;
  }

  it_('returns _embedded.mfaPolicies array with documented fields', async () => {
    const token = await getMfaWorkerToken();
    let res;
    try {
      res = await axios.get(`${API_URL}/mfaPolicies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      if (err.response?.status === 403) {
        // Worker app lacks MFA admin role in PingOne console — grant Identity Data Admin or MFA Admin role
        console.warn('[SKIP] mfaPolicies 403: worker app needs MFA Admin role in PingOne console');
        return;
      }
      throw err;
    }
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('_embedded.mfaPolicies');
    const policies = res.data._embedded.mfaPolicies;
    expect(Array.isArray(policies)).toBe(true);
    expect(policies.length).toBeGreaterThan(0);
    expect(policies[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
    });
  });

  it_('at least one policy has default:true', async () => {
    const token = await getMfaWorkerToken();
    let res;
    try {
      res = await axios.get(`${API_URL}/mfaPolicies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      if (err.response?.status === 403) {
        console.warn('[SKIP] mfaPolicies 403: worker app needs MFA Admin role in PingOne console');
        return;
      }
      throw err;
    }
    const policies = res.data._embedded.mfaPolicies;
    const hasDefault = policies.some(p => p.default === true);
    expect(hasDefault).toBe(true);
  });

  it_('returns 4xx without Authorization header', async () => {
    try {
      await axios.get(`${API_URL}/mfaPolicies`);
      throw new Error('Should have thrown');
    } catch (err) {
      // PingOne returns 403 (not 401) for unauthenticated Management API requests
      expect(err.response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/users — user management list
// ---------------------------------------------------------------------------
describe('GET /v1/environments/{id}/users', () => {
  const API_URL = ENV_ID ? `https://api.pingone.${REGION}/v1/environments/${ENV_ID}` : null;

  it_('returns _embedded.users array with documented fields', async () => {
    const token = await getWorkerToken();
    const res = await axios.get(`${API_URL}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('_embedded.users');
    const users = res.data._embedded.users;
    expect(Array.isArray(users)).toBe(true);
    // Each user has documented fields
    if (users.length > 0) {
      expect(users[0]).toMatchObject({
        id: expect.any(String),
        username: expect.any(String),
      });
    }
  });

  it_('filter query ?filter=(username sw "test") returns filtered results', async () => {
    const token = await getWorkerToken();
    const res = await axios.get(`${API_URL}/users?filter=(username sw "test")`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('_embedded');
  });

  it_('returns 401 without Authorization header', async () => {
    try {
      await axios.get(`${API_URL}/users`);
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// POST/GET/PATCH/DELETE /v1/environments/{id}/users — CRUD lifecycle
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-create-user
// ---------------------------------------------------------------------------
describe('User CRUD lifecycle — POST/GET/PATCH/DELETE /v1/environments/{id}/users/{id}', () => {
  const API_URL = ENV_ID ? `https://api.pingone.${REGION}/v1/environments/${ENV_ID}` : null;
  let createdUserId = null;
  const testUsername = `test-api-audit-${Date.now()}@example.com`;

  it_('POST /users creates user and returns documented shape', async () => {
    const token = await getWorkerToken();
    const res = await axios.post(
      `${API_URL}/users`,
      { username: testUsername, email: testUsername, population: { id: process.env.PINGONE_POPULATION_ID || undefined } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      id: expect.any(String),
      username: testUsername,
    });
    createdUserId = res.data.id;
  });

  it_('GET /users/{id} returns the created user', async () => {
    if (!createdUserId) return;
    const token = await getWorkerToken();
    const res = await axios.get(`${API_URL}/users/${createdUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ id: createdUserId, username: testUsername });
  });

  it_('GET /users/{id}/devices returns devices array for new user', async () => {
    if (!createdUserId) return;
    const token = await getWorkerToken();
    const res = await axios.get(`${API_URL}/users/${createdUserId}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    // New user has no devices — _embedded may be absent or devices may be empty
    const devices = res.data._embedded?.devices ?? [];
    expect(Array.isArray(devices)).toBe(true);
  });

  it_('PATCH /users/{id} updates user and returns patched fields', async () => {
    if (!createdUserId) return;
    const token = await getWorkerToken();
    const res = await axios.patch(
      `${API_URL}/users/${createdUserId}`,
      { name: { given: 'ApiAudit', family: 'Test' } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );
    expect(res.status).toBe(200);
    expect(res.data.name).toMatchObject({ given: 'ApiAudit', family: 'Test' });
  });

  it_('DELETE /users/{id} removes the user (HTTP 204)', async () => {
    if (!createdUserId) return;
    const token = await getWorkerToken();
    const res = await axios.delete(`${API_URL}/users/${createdUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
    createdUserId = null;
  });

  afterAll(async () => {
    // Safety cleanup in case a mid-suite failure left the user behind
    if (createdUserId && HAVE_CREDENTIALS) {
      try {
        const res = await axios.post(
          `${AUTH_URL}/as/token`,
          new URLSearchParams({ grant_type: 'client_credentials', scope: 'p1:read:user p1:read:env' }),
          { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        );
        await axios.delete(`${API_URL}/users/${createdUserId}`, {
          headers: { Authorization: `Bearer ${res.data.access_token}` },
        });
      } catch (_) { /* best-effort */ }
    }
  });
});

// ---------------------------------------------------------------------------
// POST /as/token — worker token (client_credentials) — detailed claims
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token
// ---------------------------------------------------------------------------
describe('POST /as/token — worker token claims', () => {
  it_('token is a JWT with three dot-separated segments', async () => {
    const token = await getWorkerToken();
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  it_('token payload contains expected registered claims', async () => {
    const token = await getWorkerToken();
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    expect(payload).toMatchObject({
      iss: expect.stringContaining('pingone'),
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
    // exp must be in the future
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it_('token_type is Bearer and expires_in is a positive integer', async () => {
    const res = await axios.post(
      `${AUTH_URL}/as/token`,
      new URLSearchParams({ grant_type: 'client_credentials', scope: 'p1:read:user' }),
      { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    expect(res.data.token_type).toBe('Bearer');
    expect(res.data.expires_in).toBeGreaterThan(0);
    expect(Number.isInteger(res.data.expires_in)).toBe(true);
  });

  it_('scope narrowing — requested scope is reflected in introspection', async () => {
    const res = await axios.post(
      `${AUTH_URL}/as/token`,
      new URLSearchParams({ grant_type: 'client_credentials', scope: 'p1:read:user' }),
      { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    const token = res.data.access_token;
    const intro = await axios.post(
      `${AUTH_URL}/as/introspect`,
      new URLSearchParams({ token }),
      { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    expect(intro.data.active).toBe(true);
    // PingOne may omit scope from introspection response for CC tokens depending on policy config
    if (intro.data.scope !== undefined) {
      expect(intro.data.scope).toContain('p1:read:user');
    }
  });

  it_('unsupported grant_type returns error shape', async () => {
    try {
      await axios.post(
        `${AUTH_URL}/as/token`,
        new URLSearchParams({ grant_type: 'password', username: 'x', password: 'y' }),
        { auth: { username: CLIENT_ID, password: CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBeGreaterThanOrEqual(400);
      expect(err.response.data).toMatchObject({ error: expect.any(String) });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/decisionEndpoints — PingOne Authorize
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-decision-endpoints
// ---------------------------------------------------------------------------
const AUTHORIZE_CLIENT_ID     = process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID || CLIENT_ID;
const AUTHORIZE_CLIENT_SECRET = process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET || CLIENT_SECRET;
const DECISION_ENDPOINT_ID    = process.env.PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID;
const HAVE_AUTHZ = !!(HAVE_CREDENTIALS && AUTHORIZE_CLIENT_ID && AUTHORIZE_CLIENT_SECRET);
const it_authz = HAVE_AUTHZ ? it : it.skip;

async function getAuthorizeWorkerToken() {
  const res = await axios.post(
    `${AUTH_URL}/as/token`,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    { auth: { username: AUTHORIZE_CLIENT_ID, password: AUTHORIZE_CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return res.data.access_token;
}

describe('GET /v1/environments/{id}/decisionEndpoints', () => {
  const API_URL = ENV_ID ? `https://api.pingone.${REGION}/v1/environments/${ENV_ID}` : null;

  it_authz('returns array of decision endpoints with documented shape', async () => {
    const token = await getAuthorizeWorkerToken();
    const res = await axios.get(`${API_URL}/decisionEndpoints`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const endpoints = res.data._embedded?.decisionEndpoints || res.data.decisionEndpoints || [];
    expect(Array.isArray(endpoints)).toBe(true);
    if (endpoints.length > 0) {
      expect(endpoints[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
      });
    }
  });

  it_authz('configured DECISION_ENDPOINT_ID appears in the list', async () => {
    if (!DECISION_ENDPOINT_ID) return;
    const token = await getAuthorizeWorkerToken();
    const res = await axios.get(`${API_URL}/decisionEndpoints`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const endpoints = res.data._embedded?.decisionEndpoints || res.data.decisionEndpoints || [];
    const found = endpoints.find(e => e.id === DECISION_ENDPOINT_ID);
    expect(found).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POST /v1/environments/{id}/decisionEndpoints/{id} — transaction evaluation
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-evaluate-decision-endpoint
// Trust Framework parameters: Amount, TransactionType, UserId, Timestamp
// ---------------------------------------------------------------------------
describe('POST /v1/environments/{id}/decisionEndpoints/{id} — Authorize evaluation', () => {
  const API_URL = ENV_ID ? `https://api.pingone.${REGION}/v1/environments/${ENV_ID}` : null;
  const it_de = (HAVE_AUTHZ && DECISION_ENDPOINT_ID) ? it : it.skip;

  // PingOne Authorize rate-limits rapid back-to-back calls — pace tests at 1.5s
  beforeEach(() => new Promise(r => setTimeout(r, 1500)));

  it_de('small transfer returns valid decision shape (PERMIT/DENY/STEP_UP) with Trust Framework params', async () => {
    const token = await getAuthorizeWorkerToken();
    const res = await axios.post(
      `${API_URL}/decisionEndpoints/${DECISION_ENDPOINT_ID}`,
      {
        parameters: {
          Amount: 100,
          TransactionType: 'transfer',
          UserId: 'test-user-api-audit',
          Timestamp: new Date().toISOString(),
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );
    expect(res.status).toBe(200);
    // PingOne Authorize returns decision at top level
    const decision = res.data.decision || res.data.status;
    expect(['PERMIT', 'DENY', 'INDETERMINATE', 'STEP_UP']).toContain(decision);
  });

  it_de('large transfer returns DENY or step-up', async () => {
    const token = await getAuthorizeWorkerToken();
    const res = await axios.post(
      `${API_URL}/decisionEndpoints/${DECISION_ENDPOINT_ID}`,
      {
        parameters: {
          Amount: 999999,
          TransactionType: 'transfer',
          UserId: 'test-user-api-audit',
          Timestamp: new Date().toISOString(),
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );
    expect(res.status).toBe(200);
    const decision = res.data.decision || res.data.status;
    expect(['DENY', 'STEP_UP', 'INDETERMINATE']).toContain(decision);
  });

  it_de('returns 4xx for missing Authorization header', async () => {
    try {
      await axios.post(
        `${API_URL}/decisionEndpoints/${DECISION_ENDPOINT_ID}`,
        { parameters: { Amount: 100, TransactionType: 'transfer', UserId: 'x', Timestamp: new Date().toISOString() } },
        { headers: { 'Content-Type': 'application/json' } },
      );
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

// ---------------------------------------------------------------------------
// simulatedAuthorizeService — parity with PingOne Authorize shape (always runs)
// ---------------------------------------------------------------------------
describe('Simulated Authorize response shape (no credentials needed)', () => {
  // NODE_ENV guard in simulatedAuthorizeService blocks production loads.
  const orig = process.env.NODE_ENV;
  beforeAll(() => { process.env.NODE_ENV = 'test'; });
  afterAll(() => { process.env.NODE_ENV = orig; });

  const svc = require('../services/simulatedAuthorizeService');

  it('PERMIT response matches PingOne Authorize shape', async () => {
    const result = await svc.evaluate({
      parameters: { transactionAmount: 100, userId: 'test-user', transactionType: 'transfer' },
    });
    expect(result).toMatchObject({
      id: expect.any(String),
      createdAt: expect.any(String),
      completedAt: expect.any(String),
      duration: expect.any(Number),
      status: 'SUCCESS',
      result: { decision: expect.stringMatching(/^(PERMIT|DENY)$/), weight: 1.0 },
      statements: expect.any(Array),
      obligations: expect.any(Array),
    });
  });

  it('DENY response has same envelope shape as PERMIT', async () => {
    const result = await svc.evaluate({
      parameters: { transactionAmount: 100000, userId: 'test-user', transactionType: 'transfer' },
    });
    expect(result.result.decision).toBe('DENY');
    expect(result.status).toBe('SUCCESS');
    expect(result.id).toBeTruthy();
    expect(result.obligations).toEqual([]);
  });

  // Documented simulated-policy ladder: confirm ≥$250, step-up ≥$500,
  // DENY >$2,000 (defaults; see getConfirm/StepUp/DenyAmountUsd). The
  // step-up band is $500–$2,000, so $1,000 → PERMIT + IDENTITY_REQUIREMENT.
  // (This test previously used $20,000, which is > the $2,000 deny ceiling
  // — that ceiling has existed since 2026-05-05, predating the obligation-
  // classifier refactor; $20k correctly DENYs, covered by the test below.)
  it('step-up response includes IDENTITY_REQUIREMENT obligation', async () => {
    const result = await svc.evaluate({
      parameters: { transactionAmount: 1000, userId: 'test-user', transactionType: 'transfer' },
    });
    expect(result.status).toBe('SUCCESS');
    expect(result.result.decision).toBe('PERMIT');
    expect(result.obligations.length).toBeGreaterThan(0);
    expect(result.obligations[0]).toMatchObject({ type: 'IDENTITY_REQUIREMENT' });
  });

  it('amount over the $2,000 deny ceiling is DENIED (documented policy)', async () => {
    const result = await svc.evaluate({
      parameters: { transactionAmount: 20000, userId: 'test-user', transactionType: 'transfer' },
    });
    expect(result.status).toBe('SUCCESS');
    expect(result.result.decision).toBe('DENY');
    expect(result.obligations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /as/token — RFC 8693 token exchange
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token
// RFC 8693: https://datatracker.ietf.org/doc/html/rfc8693
//
// Request body fields:
//   grant_type          = urn:ietf:params:oauth:grant-type:token-exchange  (RFC 8693 §2.1)
//   subject_token       = access token to exchange
//   subject_token_type  = urn:ietf:params:oauth:token-type:access_token    (RFC 8693 §3)
//   requested_token_type = urn:ietf:params:oauth:token-type:access_token
//   audience            = target resource URI (RFC 8707)
//   scope               = requested scopes on the issued token
//   actor_token         = (optional) RFC 8693 §4.1 impersonation / delegation actor
//   actor_token_type    = urn:ietf:params:oauth:token-type:access_token
//
// Exchanger credentials: PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID/SECRET
// Audience:              PINGONE_RESOURCE_MCP_GATEWAY_URI (exchanger client is configured for the gateway)
// ---------------------------------------------------------------------------
const EXCHANGER_CLIENT_ID     = process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
const EXCHANGER_CLIENT_SECRET = process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET;
const MCP_RESOURCE_URI        = process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI || process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
const HAVE_EXCHANGE = !!(HAVE_CREDENTIALS && EXCHANGER_CLIENT_ID && EXCHANGER_CLIENT_SECRET && MCP_RESOURCE_URI);
const it_ex = HAVE_EXCHANGE ? it : it.skip;

describe('POST /as/token — RFC 8693 token exchange', () => {
  it_ex('invalid subject_token returns RFC 6749 error shape', async () => {
    // PingOne rejects invalid subject_token with error: invalid_grant or invalid_request
    // Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token (error responses)
    try {
      await axios.post(
        `${AUTH_URL}/as/token`,
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: 'not-a-real-token',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: MCP_RESOURCE_URI,
          scope: 'banking:read',
          client_id: EXCHANGER_CLIENT_ID,
          client_secret: EXCHANGER_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBeGreaterThanOrEqual(400);
      // RFC 6749 §5.2 error response shape
      expect(err.response.data).toMatchObject({ error: expect.any(String) });
    }
  });

  it_ex('valid subject_token exchange returns access_token or documented error', async () => {
    // Get a real worker token to use as subject_token
    const subjectToken = await getWorkerToken();

    let res;
    try {
      res = await axios.post(
        `${AUTH_URL}/as/token`,
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: subjectToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: MCP_RESOURCE_URI,
          scope: 'banking:read banking:write',
          client_id: EXCHANGER_CLIENT_ID,
          client_secret: EXCHANGER_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
    } catch (err) {
      // Policy may reject CC tokens as subject — that's expected and acceptable
      // What matters is PingOne returns a documented error shape, not a 5xx
      expect(err.response.status).toBeLessThan(500);
      expect(err.response.data).toMatchObject({ error: expect.any(String) });
      return;
    }
    // Success path: validate RFC 8693 §2.2 response fields
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      access_token: expect.any(String),
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      expires_in: expect.any(Number),
    });
  });

  it_ex('issued token is a JWT with aud narrowed to MCP resource URI', async () => {
    const subjectToken = await getWorkerToken();

    let exchangedToken;
    try {
      const res = await axios.post(
        `${AUTH_URL}/as/token`,
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: subjectToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: MCP_RESOURCE_URI,
          scope: 'banking:read',
          client_id: EXCHANGER_CLIENT_ID,
          client_secret: EXCHANGER_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      exchangedToken = res.data.access_token;
    } catch (err) {
      if (err.response?.status < 500) return; // policy rejection — skip aud check
      throw err;
    }

    // Decode JWT payload (no signature verification needed — just structural check)
    const payload = JSON.parse(Buffer.from(exchangedToken.split('.')[1], 'base64').toString());
    // aud should include or equal the requested MCP resource URI (RFC 8707)
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    expect(aud.some(a => a === MCP_RESOURCE_URI || a.startsWith(MCP_RESOURCE_URI))).toBe(true);
  });

  it_ex('missing grant_type returns 400 with error field', async () => {
    try {
      await axios.post(
        `${AUTH_URL}/as/token`,
        new URLSearchParams({
          subject_token: 'some-token',
          client_id: EXCHANGER_CLIENT_ID,
          client_secret: EXCHANGER_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBe(400);
      expect(err.response.data).toMatchObject({ error: expect.any(String) });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/resources — Resource Servers
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-resources
// ---------------------------------------------------------------------------
const MGMT_URL = ENV_ID ? `https://api.pingone.${REGION}/v1/environments/${ENV_ID}` : null;

describe('GET /v1/environments/{id}/resources — resource servers', () => {
  it_('returns _embedded.resources array with id and name', async () => {
    const token = await getWorkerToken();
    const res = await axios.get(`${MGMT_URL}/resources`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('_embedded');
    expect(res.data._embedded).toHaveProperty('resources');
    expect(Array.isArray(res.data._embedded.resources)).toBe(true);
    if (res.data._embedded.resources.length > 0) {
      const r = res.data._embedded.resources[0];
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('name');
    }
  });

  it_('unauthenticated request returns 4xx', async () => {
    try {
      await axios.get(`${MGMT_URL}/resources`);
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/resources/{id}/scopes — Resource Scopes
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-resource-scopes
// ---------------------------------------------------------------------------
describe('GET /v1/environments/{id}/resources/{id}/scopes — resource scopes', () => {
  it_('returns _embedded.scopes array with id and name for first resource', async () => {
    const token = await getWorkerToken();

    // Fetch resources first to get a real resource ID
    const resourcesRes = await axios.get(`${MGMT_URL}/resources`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const resources = resourcesRes.data._embedded?.resources || [];
    if (resources.length === 0) {
      console.warn('No resources found — skipping scope sub-test');
      return;
    }

    const resourceId = resources[0].id;
    const res = await axios.get(`${MGMT_URL}/resources/${resourceId}/scopes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('_embedded');
    expect(res.data._embedded).toHaveProperty('scopes');
    expect(Array.isArray(res.data._embedded.scopes)).toBe(true);
    if (res.data._embedded.scopes.length > 0) {
      const s = res.data._embedded.scopes[0];
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('name');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/applications — Applications
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-applications
// ---------------------------------------------------------------------------
describe('GET /v1/environments/{id}/applications — applications', () => {
  it_('returns _embedded.applications array with id, name, protocol', async () => {
    const token = await getWorkerToken();
    const res = await axios.get(`${MGMT_URL}/applications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('_embedded');
    expect(res.data._embedded).toHaveProperty('applications');
    expect(Array.isArray(res.data._embedded.applications)).toBe(true);
    if (res.data._embedded.applications.length > 0) {
      const app = res.data._embedded.applications[0];
      expect(app).toHaveProperty('id');
      expect(app).toHaveProperty('name');
      expect(app).toHaveProperty('protocol');
    }
  });

  it_('OIDC filter returns only OPENID_CONNECT apps', async () => {
    const token = await getWorkerToken();
    const res = await axios.get(`${MGMT_URL}/applications`, {
      params: { filter: 'protocol eq "OPENID_CONNECT"' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const apps = res.data._embedded?.applications || [];
    for (const app of apps) {
      expect(app.protocol).toBe('OPENID_CONNECT');
    }
  });

  it_('unauthenticated request returns 4xx', async () => {
    try {
      await axios.get(`${MGMT_URL}/applications`);
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/applications/{id} — Single Application
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-one-application
// ---------------------------------------------------------------------------
describe('GET /v1/environments/{id}/applications/{id} — single application', () => {
  it_('returns full application object with id, name, enabled, protocol', async () => {
    const token = await getWorkerToken();

    const listRes = await axios.get(`${MGMT_URL}/applications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const apps = listRes.data._embedded?.applications || [];
    if (apps.length === 0) {
      console.warn('No applications found — skipping single-app test');
      return;
    }

    const appId = apps[0].id;
    const res = await axios.get(`${MGMT_URL}/applications/${appId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('id', appId);
    expect(res.data).toHaveProperty('name');
    expect(res.data).toHaveProperty('enabled');
    expect(res.data).toHaveProperty('protocol');
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/applications/{id}/grants — Application Grants
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-application-resource-grants
// ---------------------------------------------------------------------------
describe('GET /v1/environments/{id}/applications/{id}/grants — application grants', () => {
  it_('returns grants or empty collection for first OIDC app', async () => {
    const token = await getWorkerToken();

    const listRes = await axios.get(`${MGMT_URL}/applications`, {
      params: { filter: 'protocol eq "OPENID_CONNECT"' },
      headers: { Authorization: `Bearer ${token}` },
    });
    const apps = listRes.data._embedded?.applications || [];
    if (apps.length === 0) {
      console.warn('No OIDC applications found — skipping grants test');
      return;
    }

    const appId = apps[0].id;
    const res = await axios.get(`${MGMT_URL}/applications/${appId}/grants`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    // PingOne wraps grants in _embedded.grants or returns count:0 object
    const grants = res.data._embedded?.grants || [];
    expect(Array.isArray(grants)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/environments/{id}/populations — Populations
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-populations
// ---------------------------------------------------------------------------
describe('GET /v1/environments/{id}/populations — populations', () => {
  it_('returns _embedded.populations array with id and name', async () => {
    const token = await getWorkerToken();
    const res = await axios.get(`${MGMT_URL}/populations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('_embedded');
    expect(res.data._embedded).toHaveProperty('populations');
    expect(Array.isArray(res.data._embedded.populations)).toBe(true);
    if (res.data._embedded.populations.length > 0) {
      const pop = res.data._embedded.populations[0];
      expect(pop).toHaveProperty('id');
      expect(pop).toHaveProperty('name');
    }
  });

  it_('unauthenticated request returns 4xx', async () => {
    try {
      await axios.get(`${MGMT_URL}/populations`);
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /.well-known/openid-configuration — OIDC Discovery
// Docs: https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-discovery-endpoint
// ---------------------------------------------------------------------------
describe('GET /.well-known/openid-configuration — OIDC discovery', () => {
  it_('returns standard OIDC discovery fields', async () => {
    const res = await axios.get(`${AUTH_URL}/as/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      issuer: expect.any(String),
      authorization_endpoint: expect.any(String),
      token_endpoint: expect.any(String),
      jwks_uri: expect.any(String),
      response_types_supported: expect.arrayContaining(['code']),
      subject_types_supported: expect.any(Array),
      id_token_signing_alg_values_supported: expect.any(Array),
    });
    // RFC 8414 / RFC 9728 — token introspection endpoint advertised
    if (res.data.introspection_endpoint) {
      expect(typeof res.data.introspection_endpoint).toBe('string');
    }
    // RFC 8693 token exchange grant type
    if (res.data.grant_types_supported) {
      expect(res.data.grant_types_supported).toContain('authorization_code');
    }
  });
});
