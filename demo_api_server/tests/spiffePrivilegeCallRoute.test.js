'use strict';

/**
 * POST /api/demo/spiffe/privilege/call is public (same surface as /svid) but mints
 * real tokens and forwards them to the Privilege gateway. The caller must not be able
 * to choose the audience, scopes, gateway path or JSON-RPC method, and the route is
 * rate limited. Spec: docs/superpowers/specs/2026-11-22-spiffe-privilege-call-input-lock.md
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

jest.mock('../services/spiffePrivilegeService', () => ({
  callPrivilegeWithWorkloadIdentity: jest.fn(),
}));

const PAGE_AUDIENCE = 'priv-nhi-l5hp7w677rxl3somiehznpomuyxxlhdr';
const PAGE_BODY = {
  token_mode: 'raw-svid',
  resource: '/spire-mcp/mcp',
  audience: PAGE_AUDIENCE,
  scopes: ['mcp:invoke'],
};

let svc;
let spiffeDemo;
let savedDisable;

// The route requires a session; tests are signed in unless they say otherwise.
function appFor({ signedIn = true } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    if (signedIn) req.session = { user: { id: 'u1' } };
    next();
  });
  app.use('/api/demo/spiffe', spiffeDemo);
  return app;
}

function post(body, opts) {
  return request(appFor(opts)).post('/api/demo/spiffe/privilege/call').send(body);
}

beforeEach(() => {
  jest.resetModules();
  savedDisable = process.env.DISABLE_RATE_LIMIT;
  delete process.env.DISABLE_RATE_LIMIT;
  svc = require('../services/spiffePrivilegeService');
  svc.callPrivilegeWithWorkloadIdentity.mockReset().mockResolvedValue({
    tokenMode: 'raw-svid', issuer: 'i', claims: {}, gatewayUrl: 'u', gatewayStatus: 200, gatewayBody: {}, token: 't',
  });
  spiffeDemo = require('../routes/spiffeDemo');
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedDisable === undefined) delete process.env.DISABLE_RATE_LIMIT;
  else process.env.DISABLE_RATE_LIMIT = savedDisable;
});

describe('requires a signed-in session', () => {
  it('401 for the exact body the page sends, service never called', async () => {
    const res = await post(PAGE_BODY, { signedIn: false });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
    expect(svc.callPrivilegeWithWorkloadIdentity).not.toHaveBeenCalled();
  });

  it('401 with no body at all', async () => {
    const res = await post(undefined, { signedIn: false });
    expect(res.status).toBe(401);
    expect(svc.callPrivilegeWithWorkloadIdentity).not.toHaveBeenCalled();
  });

  it('401 for a session object with no user', async () => {
    const app = express();
    app.use((req, _res, next) => { req.session = {}; next(); });
    app.use('/api/demo/spiffe', spiffeDemo);
    const res = await request(app).post('/api/demo/spiffe/privilege/call').send(PAGE_BODY);
    expect(res.status).toBe(401);
  });

  it('anonymous traffic does not use up the rate-limit bucket signed-in users share', async () => {
    const anon = appFor({ signedIn: false });
    for (let i = 0; i < 70; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(anon).post('/api/demo/spiffe/privilege/call').send(PAGE_BODY);
    }
    const res = await post(PAGE_BODY);
    expect(res.status).toBe(200);
  });
});

describe('accepted calls (demo unchanged)', () => {
  it('forwards exactly the body the page sends', async () => {
    const res = await post(PAGE_BODY);
    expect(res.status).toBe(200);
    expect(svc.callPrivilegeWithWorkloadIdentity).toHaveBeenCalledWith({
      tokenMode: 'raw-svid',
      resource: '/spire-mcp/mcp',
      audience: PAGE_AUDIENCE,
      scopes: ['mcp:invoke'],
      mcpMethod: undefined,
    });
  });

  it('keeps service defaults when only token_mode is sent (protocol-flow body)', async () => {
    const res = await post({ token_mode: 'raw-svid' });
    expect(res.status).toBe(200);
    expect(svc.callPrivilegeWithWorkloadIdentity).toHaveBeenCalledWith({
      tokenMode: 'raw-svid', resource: undefined, audience: undefined, scopes: undefined, mcpMethod: undefined,
    });
  });

  it('accepts tools/list', async () => {
    const res = await post({ token_mode: 'raw-svid', mcp_method: 'tools/list' });
    expect(res.status).toBe(200);
    expect(svc.callPrivilegeWithWorkloadIdentity.mock.calls[0][0]).toMatchObject({ mcpMethod: 'tools/list' });
  });

  it('allowlist still matches what SpiffePrivilegePage.jsx sends (drift guard)', async () => {
    // If the NHI is re-registered the page changes; this fails in CI, not at demo time.
    const src = fs.readFileSync(path.join(__dirname, '../../demo_api_ui/src/components/SpiffePrivilegePage.jsx'), 'utf8');
    const audience = /audience:\s*"([^"]+)"/.exec(src)?.[1];
    const resource = /resource:\s*"([^"]+)"/.exec(src)?.[1];
    const scopes = JSON.parse(`${/scopes:\s*(\[[^\]]*\])/.exec(src)?.[1].replace(/'/g, '"')}`);
    expect({ audience, resource, scopes }).toEqual({ audience: PAGE_AUDIENCE, resource: '/spire-mcp/mcp', scopes: ['mcp:invoke'] });
    const res = await post({ token_mode: 'raw-svid', resource, audience, scopes });
    expect(res.status).toBe(200);
  });
});

describe('caller-chosen inputs are refused (service never called)', () => {
  it.each([
    ['audience', { audience: 'https://evil.example' }],
    ['audience as array', { audience: [PAGE_AUDIENCE] }],
    ['resource', { resource: '/admin' }],
    ['resource traversal', { resource: '/spire-mcp/mcp/../../admin' }],
    ['resource as array', { resource: ['/spire-mcp/mcp'] }],
    ['scope outside allowlist', { scopes: ['admin:all'] }],
    ['scope mixed with allowed one', { scopes: ['mcp:invoke', 'admin:all'] }],
    ['scopes as string', { scopes: 'mcp:invoke' }],
    ['empty scope list', { scopes: [] }],
    ['mcp_method tools/call', { mcp_method: 'tools/call' }],
    ['mcp_method as object', { mcp_method: { x: 1 } }],
  ])('400 for %s', async (_name, extra) => {
    const res = await post({ token_mode: 'raw-svid', ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(svc.callPrivilegeWithWorkloadIdentity).not.toHaveBeenCalled();
  });

  it('does not echo the rejected value back', async () => {
    const res = await post({ token_mode: 'raw-svid', audience: 'https://evil.example/<script>' });
    expect(JSON.stringify(res.body)).not.toContain('evil.example');
  });
});

describe('service failures still map as before', () => {
  it('maps isConfigError to its structured status', async () => {
    const err = new Error('disabled (ff_spiffe_privilege)');
    err.isConfigError = true;
    err.httpStatus = 503;
    svc.callPrivilegeWithWorkloadIdentity.mockRejectedValueOnce(err);
    const res = await post(PAGE_BODY);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('spiffe_privilege_unavailable');
  });
});

describe('rate limit', () => {
  it('returns 429 after 60 calls a minute from one client', async () => {
    const app = appFor();
    const statuses = [];
    for (let i = 0; i < 61; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await request(app).post('/api/demo/spiffe/privilege/call').send(PAGE_BODY)).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it('is off when DISABLE_RATE_LIMIT is set, like the other limiters', async () => {
    process.env.DISABLE_RATE_LIMIT = 'true';
    const app = appFor();
    let last;
    for (let i = 0; i < 65; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = (await request(app).post('/api/demo/spiffe/privilege/call').send(PAGE_BODY)).status;
    }
    expect(last).toBe(200);
  });
});
