'use strict';

// config.clientId defaults to EMPTY (see getClientSession): every door this page
// ships with self-advertises its AS and gets its id by Dynamic Client
// Registration inside beginOAuthFlow. /auth/start used to reject an empty id up
// front with "Client ID is required before auth start.", which pre-empted the
// very step that fills it.
//
// clientSessions is a module-level in-memory Map, so a BFF restart drops every
// session back to that empty default — after which NO door could start OAuth
// until an operator hand-typed a client id that DCR then immediately replaced.
// Observed live 2026-09-08 on ai-demo.ping-devops.com right after a BFF rollout.
//
// Every other DCR spec posts an explicit clientId, which is why this never
// surfaced in tests. This one deliberately does not.

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
    req.sessionID = 'privilege-no-client-id-test';
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

function selfAdvertisingGateway({ issuedClientIds }) {
  return jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (target === MCP_URL) {
      return jsonResponse({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI });
    }
    if (target === REGISTER_URI) {
      const clientId = `dcr-client-${issuedClientIds.length + 1}`;
      issuedClientIds.push(clientId);
      return jsonResponse({ client_id: clientId });
    }
    if (target === TOKEN_URI) {
      const body = String(options.body || '');
      if (body.includes('dcr-liveness-probe')) {
        return textResponse('Invalid or expired authorization code', { status: 400 });
      }
      return jsonResponse({ access_token: 'access-1', expires_in: 3600 });
    }
    return jsonResponse({});
  });
}

describe('POST /auth/start with no configured client id', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('a self-advertising door registers by DCR instead of demanding a client id', async () => {
    const app = buildApp();
    const issuedClientIds = [];
    global.fetch = selfAdvertisingGateway({ issuedClientIds });

    // No clientId — exactly what a session looks like after a BFF restart.
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: MCP_URL })
      .expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);

    // The guard used to make this a 400 before DCR ever ran.
    expect(res.body.authUrl).toBeTruthy();
    expect(issuedClientIds).toHaveLength(1);
    expect(new URL(res.body.authUrl).searchParams.get('client_id')).toBe(issuedClientIds[0]);
  });

  test('a door with no DCR still fails, naming the gateway and what to set', async () => {
    const app = buildApp();
    // Advertises a complete AS but refuses registration: the genuine "operator
    // must set Client ID" case beginOAuthFlow is responsible for reporting, and
    // the reason the removed guard was redundant.
    global.fetch = jest.fn(async (url) => {
      const target = String(url);
      if (target === MCP_URL) {
        return jsonResponse({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI });
      }
      if (target === REGISTER_URI) return textResponse('Not Found', { status: 404 });
      return jsonResponse({});
    });

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: MCP_URL })
      .expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toMatch(/client id/i);
  });
});
