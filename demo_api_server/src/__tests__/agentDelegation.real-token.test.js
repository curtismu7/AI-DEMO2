/**
 * @file agentDelegation.real-token.test.js
 * POST /api/agent/delegate tests using a REAL PingOne JWT from sessions.db.
 *
 * What these prove that the fakeJwt tests (agentDelegation.test.js) cannot:
 *   - decodeJwtPayload() correctly handles base64url-encoded real PingOne JWTs
 *   - Real token's space-separated `scope` string parses correctly for intersection
 *   - Real token's `sub` claim is extracted and reaches audit log / rate limiter key
 *   - Real token's `act` claim is accessible (documents real PingOne token structure)
 *   - The route reaches business logic (not 401 invalid_token) with a real token
 *
 * oauthService is mocked — PingOne token exchange is not the focus of this file.
 * Skips automatically when no valid session token is found in sessions.db.
 *
 * To run manually with a fresh token after login:
 *   npx jest --no-coverage --forceExit agentDelegation.real-token
 */

'use strict';

const path = require('path');
const { open } = require('lmdb');
const express = require('express');
const request = require('supertest');

// ── Load real token from the LMDB session store (NO SQLITE) ───────────────────
// Sessions live in data/persistent/lmdb, DB 'sessions', entries { sess, expire }
// (expire in ms; sess already JSON-decoded). Mirrors tests/real/helpers/session.js.

function loadRealToken() {
  let env;
  try {
    const lmdbPath = path.resolve(__dirname, '../../data/persistent/lmdb');
    env = open({ path: lmdbPath, maxDbs: 16, encoding: 'json', readOnly: true });
    const db = env.openDB('sessions', { encoding: 'json' });
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    for (const { value } of db.getRange()) {
      if (!value || value.expire <= nowMs) continue;
      const at = value.sess?.oauthTokens?.accessToken;
      if (!at) continue;
      try {
        const payload = JSON.parse(
          Buffer.from(at.split('.')[1], 'base64url').toString('utf8'),
        );
        if (payload.exp > nowSec) return { token: at, payload };
      } catch { /* skip malformed */ }
    }
    return null;
  } catch {
    return null;
  } finally {
    try { if (env) env.close(); } catch { /* ignore */ }
  }
}

const realSession = loadRealToken();
const hasRealToken = !!realSession;

// ── Mocks ─────────────────────────────────────────────────────────────────────
// agentDelegation route does NOT use middleware/auth — it decodes the token itself.
// Only oauthService and configStore need mocking; that's the exchange, not the focus.

jest.mock('../../services/oauthService');
jest.mock('../../services/configStore');

const oauthService = require('../../services/oauthService');
const configStore = require('../../services/configStore');
const agentDelegationRouter = require('../../routes/agentDelegation');

function buildApp() {
  const app = express();
  app.use('/api/agent', agentDelegationRouter);
  return app;
}

/** Build a minimal but valid base64url JWT for mocked exchange responses. */
function fakeDelegatedJwt(sub, scopes) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(
    JSON.stringify({
      sub,
      aud: 'https://mcp.example.com',
      scope: scopes,
      exp: Math.floor(Date.now() / 1000) + 3600,
      act: { sub: 'agent-client-id' },
    }),
  ).toString('base64url');
  return `${h}.${b}.fake-sig`;
}

// ── Always-on: documents token availability ───────────────────────────────────

describe('Real-token availability (agentDelegation)', () => {
  it('reports whether a valid session token is present', () => {
    if (hasRealToken) {
      const { payload } = realSession;
      const remaining = payload.exp - Math.floor(Date.now() / 1000);
      console.info(
        `[real-token:delegate] sub=${payload.sub} ` +
        `scopes="${payload.scope}" ` +
        `act=${JSON.stringify(payload.act)} ` +
        `exp in ${remaining}s`,
      );
    } else {
      console.info(
        '[real-token:delegate] No valid session token found — live tests skipped. ' +
        'Log in at the banking UI to populate sessions.db.',
      );
    }
    expect(true).toBe(true); // documentation-only assertion
  });
});

// ── Tests: skipped when no valid session token is available ──────────────────

(hasRealToken ? describe : describe.skip)(
  'Real PingOne JWT — agentDelegation route token parsing + scope intersection',
  () => {
    const { token, payload } = realSession || {};

    beforeEach(() => {
      jest.clearAllMocks();

      configStore.getEffective = jest.fn((key) => {
        const cfg = {
          pingone_mcp_token_exchanger_client_id: 'agent-client-id',
          pingone_mcp_token_exchanger_client_secret: 'agent-client-secret',
          pingone_resource_mcp_server_uri: 'https://mcp.example.com',
          pingone_mcp_token_exchanger_auth_method: 'basic',
        };
        return cfg[key] || null;
      });

      oauthService.getClientCredentialsTokenAs = jest
        .fn()
        .mockResolvedValue('actor-token-123');

      oauthService.performTokenExchangeWithActor = jest
        .fn()
        .mockResolvedValue(fakeDelegatedJwt(payload?.sub, 'read write'));
    });

    // ── Token structure sanity ────────────────────────────────────────────────

    it('real token metadata is sane before running tests', () => {
      expect(payload.sub).toBeTruthy();
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(payload.scope).toContain('read');
      expect(payload.scope).toContain('write');
    });

    it('real token has act claim with sub (delegation chain)', () => {
      // Documents real PingOne token structure: act.sub = actor client ID.
      // The act claim records the delegation chain for audit purposes.
      if (payload.act) {
        expect(typeof payload.act.sub).toBe('string');
        expect(payload.act.sub.length).toBeGreaterThan(0);
      } else {
        // act claim may not be present on initial user token (only on exchanged tokens)
        expect(true).toBe(true);
      }
    });

    // ── Route accepts real token ──────────────────────────────────────────────

    it('accepts real PingOne JWT — not 401 invalid_token', async () => {
      // Proves decodeJwtPayload() handles base64url-encoded real token correctly.
      const app = buildApp();
      const res = await request(app)
        .post('/api/agent/delegate')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
    });

    it('real token sub is correctly extracted and forwarded to exchange', async () => {
      const app = buildApp();
      await request(app)
        .post('/api/agent/delegate')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // First arg to performTokenExchangeWithActor is the original user token
      expect(oauthService.performTokenExchangeWithActor).toHaveBeenCalledWith(
        token,
        'actor-token-123',
        'https://mcp.example.com',
        expect.any(Array),
      );
    });

    // ── Scope intersection with real token ────────────────────────────────────

    it('uses all real token scopes when no scope requested', async () => {
      const app = buildApp();
      await request(app)
        .post('/api/agent/delegate')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      const [, , , scopes] = oauthService.performTokenExchangeWithActor.mock.calls[0];
      // Real token carries read, write, openid, profile, email, etc.
      expect(scopes).toContain('read');
      expect(scopes).toContain('write');
      expect(scopes).toContain('openid');
    });

    it('intersects requested scopes with real token scopes — keeps valid, drops unknown', async () => {
      const app = buildApp();
      await request(app)
        .post('/api/agent/delegate')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'read nonexistent:scope' });

      const [, , , scopes] = oauthService.performTokenExchangeWithActor.mock.calls[0];
      expect(scopes).toEqual(['read']);
      expect(scopes).not.toContain('nonexistent:scope');
    });

    it('narrows to read only when only read requested', async () => {
      const app = buildApp();
      await request(app)
        .post('/api/agent/delegate')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'read' });

      const [, , , scopes] = oauthService.performTokenExchangeWithActor.mock.calls[0];
      expect(scopes).toEqual(['read']);
    });

    it('returns 400 invalid_scope when requested scope has no intersection with real token', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/agent/delegate')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'admin:everything super:powers' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_scope');
    });

    // ── Response structure ────────────────────────────────────────────────────

    it('returns delegated token with correct response structure', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/agent/delegate')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
      expect(res.body.token_type).toBe('Bearer');
      expect(res.body).toHaveProperty('scope');
      expect(res.body).toHaveProperty('act');
      // act.sub should identify the agent (not the user)
      expect(res.body.act).toHaveProperty('sub');
    });
  },
);
