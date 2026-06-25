/**
 * @file agentDelegation.test.js
 * Tests for POST /api/agent/delegate — Option D delegation endpoint.
 */

'use strict';

jest.mock('../../services/oauthService');
jest.mock('../../services/configStore');

const express = require('express');
const request = require('supertest');
const oauthService = require('../../services/oauthService');
const configStore = require('../../services/configStore');
const agentDelegationRouter = require('../../routes/agentDelegation');

/** Build a fake JWT with the given payload (no signature verification in test). */
function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

function createApp() {
  const app = express();
  app.use('/api/agent', agentDelegationRouter);
  return app;
}

describe('POST /api/agent/delegate', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();

    // Default configStore stubs
    configStore.getEffective = jest.fn((key) => {
      const defaults = {
        pingone_mcp_token_exchanger_client_id: 'agent-client-id',
        pingone_mcp_token_exchanger_client_secret: 'agent-client-secret',
        pingone_resource_mcp_server_uri: 'https://mcp.example.com',
        pingone_mcp_token_exchanger_auth_method: 'basic',
      };
      return defaults[key] || null;
    });

    // Default oauthService stubs
    oauthService.getClientCredentialsTokenAs = jest.fn().mockResolvedValue('actor-token-123');
    oauthService.performTokenExchangeWithActor = jest.fn().mockResolvedValue(
      fakeJwt({
        sub: 'user-123',
        aud: 'https://mcp.example.com',
        scope: 'read write',
        exp: Math.floor(Date.now() / 1000) + 3600,
        act: { sub: 'agent-client-id' },
      })
    );
  });

  // ── Auth checks ─────────────────────────────────────────

  it('returns 401 when no Authorization header', async () => {
    const res = await request(app).post('/api/agent/delegate').send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', 'Basic abc123')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('returns 401 when Bearer token is empty', async () => {
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', 'Bearer ')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('returns 401 when token cannot be decoded', async () => {
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', 'Bearer not-a-jwt')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 401 when token has no sub claim', async () => {
    const token = fakeJwt({ aud: 'test' }); // no sub
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  // ── Config checks ───────────────────────────────────────

  it('returns 503 when agent credentials not configured', async () => {
    configStore.getEffective = jest.fn(() => null);
    // Also clear env
    const origId = process.env.AGENT_OAUTH_CLIENT_ID;
    const origSec = process.env.AGENT_OAUTH_CLIENT_SECRET;
    delete process.env.AGENT_OAUTH_CLIENT_ID;
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;

    const token = fakeJwt({ sub: 'user-123', scope: 'read' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('agent_not_configured');

    // Restore
    if (origId) process.env.AGENT_OAUTH_CLIENT_ID = origId;
    if (origSec) process.env.AGENT_OAUTH_CLIENT_SECRET = origSec;
  });

  it('returns 503 when MCP resource URI not configured', async () => {
    configStore.getEffective = jest.fn((key) => {
      if (key === 'pingone_mcp_token_exchanger_client_id') return 'cid';
      if (key === 'pingone_mcp_token_exchanger_client_secret') return 'csec';
      return null; // no audience
    });
    const token = fakeJwt({ sub: 'user-123', scope: 'read' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('mcp_resource_not_configured');
  });

  // ── Scope handling ──────────────────────────────────────

  it('intersects requested scopes with token scopes', async () => {
    const token = fakeJwt({ sub: 'user-123', scope: 'read write openid' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'read admin:everything' });

    expect(res.status).toBe(200);
    // Only read should pass through (admin:everything is not on the token)
    expect(oauthService.performTokenExchangeWithActor).toHaveBeenCalledWith(
      token,
      'actor-token-123',
      'https://mcp.example.com',
      ['read'] // intersected
    );
  });

  it('returns 400 when no requested scopes match token', async () => {
    const token = fakeJwt({ sub: 'user-123', scope: 'read' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'admin:everything' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
  });

  it('uses all token scopes when no scope requested', async () => {
    const token = fakeJwt({ sub: 'user-123', scope: 'read write' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(oauthService.performTokenExchangeWithActor).toHaveBeenCalledWith(
      token,
      'actor-token-123',
      'https://mcp.example.com',
      ['read', 'write']
    );
  });

  // ── Happy path ──────────────────────────────────────────

  it('returns delegated token on success', async () => {
    const token = fakeJwt({ sub: 'user-123', scope: 'read write' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Agent-Client-ID', 'n8n-platform')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body).toHaveProperty('scope');
    expect(res.body).toHaveProperty('act');
  });

  it('calls getClientCredentialsTokenAs with correct agent credentials', async () => {
    const token = fakeJwt({ sub: 'user-123', scope: 'read' });
    await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(oauthService.getClientCredentialsTokenAs).toHaveBeenCalledWith(
      'agent-client-id',
      'agent-client-secret',
      'https://mcp.example.com',
      'basic'
    );
  });

  // ── Error handling ──────────────────────────────────────

  it('returns 502 when actor token fetch fails', async () => {
    oauthService.getClientCredentialsTokenAs.mockRejectedValue(new Error('network error'));
    const token = fakeJwt({ sub: 'user-123', scope: 'read' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('actor_token_failed');
  });

  it('returns PingOne error status when token exchange fails', async () => {
    const err = new Error('invalid_grant');
    err.httpStatus = 400;
    err.pingoneError = 'invalid_grant';
    err.pingoneErrorDescription = 'The subject token has expired.';
    oauthService.performTokenExchangeWithActor.mockRejectedValue(err);

    const token = fakeJwt({ sub: 'user-123', scope: 'read' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.message).toBe('The subject token has expired.');
  });

  it('defaults to 401 when exchange error has no httpStatus', async () => {
    oauthService.performTokenExchangeWithActor.mockRejectedValue(new Error('something failed'));

    const token = fakeJwt({ sub: 'user-123', scope: 'read' });
    const res = await request(app)
      .post('/api/agent/delegate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('token_exchange_failed');
  });
});
