'use strict';

// POST /doors/probe answers "my grant is denied here — does this identity work
// anywhere else?". It used to send the CURRENT door's token to every other
// door, but the Privilege AI Gateway binds each token to one Agentic App and
// refuses it elsewhere. Measured on the live gateway 2026-09-10:
//
//   [mcpgw] token issued for app "opensearch22" presented on app
//           "probe-agent-gateway"; rejecting
//
// so every Privilege door came back 401 regardless of the operator's real
// grants. That reads as "you are signed out everywhere" and drives a re-login
// the user did not need. The session already stores a per-door token in
// savedOauthByDoor (see getClientSession) — the probe must use it, and must
// say "needs its own sign-in" rather than presenting a foreign token.

const express = require('express');
const request = require('supertest');

const GW = 'https://gw.example';
const DOOR_A = `${GW}/appA/mcp`; // current door
const DOOR_B = `${GW}/appB/mcp`; // previously signed in — token stashed
const DOOR_C = `${GW}/appC/mcp`; // never signed in

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeApp() {
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'doors-probe-token-test';
    req.session = {
      privilegeMcpClientOAuth: {
        oauth: { accessToken: 'TOKEN-A', expiresAt: Date.now() + 3600_000, source: 'gateway' },
        currentOauthKey: `privilege::${DOOR_A}`,
        savedOauthByDoor: {
          [`privilege::${DOOR_B}`]: { accessToken: 'TOKEN-B', expiresAt: Date.now() + 3600_000, source: 'gateway' },
        },
      },
    };
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

describe('POST /doors/probe uses each door own token', () => {
  const savedUrl = process.env.PRIVILEGE_MCPGW_URL;
  let calls;

  beforeEach(() => {
    jest.resetModules();
    process.env.PRIVILEGE_MCPGW_URL = DOOR_A;
    calls = [];
    global.fetch = jest.fn(async (url, opts = {}) => {
      const target = String(url);
      const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || null;
      let method = null;
      try { method = JSON.parse(opts.body || '{}').method; } catch { /* not JSON */ }
      calls.push({ target, auth, method });
      if (method === 'server/discover') return jsonRes({ error: 'unsupported' }, 400);
      if (method === 'initialize') {
        return jsonRes({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'probe' } } });
      }
      if (method === 'tools/list') {
        return jsonRes({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 't1' }] } });
      }
      return jsonRes({ jsonrpc: '2.0', result: {} }, 202);
    });
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.PRIVILEGE_MCPGW_URL;
    else process.env.PRIVILEGE_MCPGW_URL = savedUrl;
    delete global.fetch;
  });

  test('a door with a stashed token is probed with THAT token, never the current one', async () => {
    await request(makeApp())
      .post('/api/privilege-mcp/doors/probe')
      .send({ urls: [DOOR_B] })
      .expect(200);

    const toB = calls.filter((c) => c.target.startsWith(DOOR_B.replace('/mcp', '')));
    expect(toB.length).toBeGreaterThan(0);
    for (const c of toB) {
      if (c.auth) expect(c.auth).toBe('Bearer TOKEN-B');
    }
    expect(calls.some((c) => c.auth === 'Bearer TOKEN-A')).toBe(false);
  });

  test('a door with no token is reported as needing its own sign-in, and is never called', async () => {
    const res = await request(makeApp())
      .post('/api/privilege-mcp/doors/probe')
      .send({ urls: [DOOR_C] })
      .expect(200);

    const row = res.body.results.find((r) => r.url === DOOR_C);
    expect(row).toBeDefined();
    expect(row.ok).toBe(false);
    expect(row.needsAuth).toBe(true);
    // The whole point: no foreign token is presented, so the gateway is not
    // asked a question whose 401 answer would be meaningless.
    expect(calls.some((c) => c.target.includes('/appC/'))).toBe(false);
  });
});
