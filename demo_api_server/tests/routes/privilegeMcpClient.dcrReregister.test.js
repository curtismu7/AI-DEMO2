'use strict';

// A self-advertising gateway (MCPGW) keeps its DCR client registry in memory,
// so restarting it forgets every client the BFF registered. The BFF caches its
// registration for the life of the process, which turned that into a permanent
// failure: /authorize answered "Unknown client" forever and signing out did not
// help, because the cache is process-wide rather than per-session.
// Observed live 2026-09-02. The BFF must notice and register again.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://mcpgw.example.com/opensearch22/mcp';
const AUTH_URI = 'https://mcpgw.example.com/opensearch22/authorize';
const TOKEN_URI = 'https://mcpgw.example.com/opensearch22/token';
const REGISTER_URI = 'https://mcpgw.example.com/opensearch22/register';

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-dcr-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

function textResponse(text, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
  };
}

// `known` decides how the gateway answers the liveness probe on /token:
// a forgotten client is rejected 401, a live one only fails on the bad code.
//
// `secret` makes /register issue a confidential client. Such a client answers an
// UNAUTHENTICATED probe with 401 too — indistinguishable from being forgotten —
// so the probe has to present the secret it holds.
function gatewayFetch({ calls, issuedClientIds, known, secret = null }) {
  return jest.fn(async (url, options = {}) => {
    const target = String(url);
    calls.push(target);

    if (target === MCP_URL) {
      return jsonResponse({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI });
    }
    if (target === REGISTER_URI) {
      const clientId = `dcr-client-${issuedClientIds.length + 1}`;
      issuedClientIds.push(clientId);
      return jsonResponse(secret ? { client_id: clientId, client_secret: secret } : { client_id: clientId });
    }
    if (target === TOKEN_URI) {
      const body = String(options.body || '');
      if (body.includes('dcr-liveness-probe')) {
        if (!known()) return textResponse('Invalid client credentials', { status: 401 });
        if (secret && !body.includes(`client_secret=${secret}`)) {
          return textResponse('Invalid client credentials', { status: 401 });
        }
        return textResponse('Invalid or expired authorization code', { status: 400 });
      }
      return jsonResponse({ access_token: 'access-1', expires_in: 3600 });
    }
    return jsonResponse({});
  });
}

async function startAuth(app) {
  const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
  return new URL(res.body.authUrl).searchParams.get('client_id');
}

describe('privilege MCP client DCR re-registration', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('reuses the cached client while the gateway still knows it', async () => {
    const app = buildApp();
    const calls = [];
    const issuedClientIds = [];
    global.fetch = gatewayFetch({ calls, issuedClientIds, known: () => true });

    // clientId is the statically configured PingOne app id; DCR replaces it,
    // because a self-advertising gateway keeps its own registry.
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: MCP_URL, clientId: 'configured-pingone-client' })
      .expect(200);

    const first = await startAuth(app);
    const second = await startAuth(app);

    expect(second).toBe(first);
    expect(issuedClientIds).toHaveLength(1);
    expect(calls.filter((c) => c === REGISTER_URI)).toHaveLength(1);
  });

  test('keeps a confidential client instead of re-registering on every sign-in', async () => {
    const app = buildApp();
    const calls = [];
    const issuedClientIds = [];
    global.fetch = gatewayFetch({ calls, issuedClientIds, known: () => true, secret: 'sh-secret' });

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: MCP_URL, clientId: 'configured-pingone-client' })
      .expect(200);

    const first = await startAuth(app);
    const second = await startAuth(app);

    // Probing without the secret would read as 401 -> "forgotten" -> a fresh
    // registration on every login, leaking a client per sign-in.
    expect(second).toBe(first);
    expect(calls.filter((c) => c === REGISTER_URI)).toHaveLength(1);
  });

  test('registers again once the gateway has forgotten the cached client', async () => {
    const app = buildApp();
    const calls = [];
    const issuedClientIds = [];
    let gatewayRemembers = true;
    global.fetch = gatewayFetch({ calls, issuedClientIds, known: () => gatewayRemembers });

    // clientId is the statically configured PingOne app id; DCR replaces it,
    // because a self-advertising gateway keeps its own registry.
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: MCP_URL, clientId: 'configured-pingone-client' })
      .expect(200);

    const beforeRestart = await startAuth(app);

    // The gateway restarts: its in-memory client registry is empty again.
    gatewayRemembers = false;
    const afterRestart = await startAuth(app);

    expect(afterRestart).not.toBe(beforeRestart);
    expect(issuedClientIds).toEqual(['dcr-client-1', 'dcr-client-2']);
    expect(calls.filter((c) => c === REGISTER_URI)).toHaveLength(2);
  });
});
