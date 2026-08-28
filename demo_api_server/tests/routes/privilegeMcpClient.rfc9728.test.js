'use strict';

// RFC 9728 discovery for doors that advertise a protected-resource document.
//
// Before this, discoverAuth() only understood the Privilege gateway's shape
// (authorization_uri/token_uri minted into the GET body). An mcp-facade door
// answers GET with 405 and no challenge, so discovery found nothing and the
// PingOne branch signed the user in with the Privilege SSO client — a token the
// door's own AS never issued. Driven live, that showed up as a redirect to
// apps.pingone.com instead of the gateway broker.
//
// These tests pin the two things that make the narrow door work: following the
// challenge to the AS, and requesting the scope the RESOURCE advertises rather
// than the session default.

const express = require('express');
const request = require('supertest');

const DOOR = 'http://localhost:3002/mcp-facade/audit/mcp';
const META = 'http://localhost:3002/mcp-facade/audit/.well-known/oauth-protected-resource';
const AS = 'http://localhost:3005';

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'rfc9728-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function jsonRes(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// The live door's actual behaviour: 405 on GET, 401 + resource_metadata on POST.
function wireFetch() {
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u === DOOR && (opts.method || 'GET') === 'GET') {
      return jsonRes({}, { status: 405 });
    }
    if (u === DOOR && opts.method === 'POST') {
      return jsonRes({ error: 'unauthorized' }, {
        status: 401,
        headers: {
          'www-authenticate':
            `Bearer realm="banking-mcp-gateway", scope="audit:read", resource_metadata="${META}"`,
        },
      });
    }
    if (u === META) {
      return jsonRes({
        resource: DOOR,
        scopes_supported: ['audit:read'],
        authorization_servers: [AS],
      });
    }
    if (u === `${AS}/.well-known/oauth-authorization-server`) {
      return jsonRes({
        issuer: AS,
        authorization_endpoint: `${AS}/oauth/authorize`,
        token_endpoint: `${AS}/oauth/token`,
        registration_endpoint: `${AS}/oauth/register`,
      });
    }
    if (u === `${AS}/oauth/register`) {
      return jsonRes({ client_id: 'dcr-client-123' }, { status: 201 });
    }
    throw new Error(`unexpected fetch: ${opts.method || 'GET'} ${u}`);
  });
}

describe('privilege-mcp auth/start — RFC 9728 door', () => {
  const saved = process.env.AUDIT_MCP_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.AUDIT_MCP_URL;
    else process.env.AUDIT_MCP_URL = saved;
    delete global.fetch;
  });

  async function startAuth() {
    wireFetch();
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/api/privilege-mcp/config').send({ mcpUrl: DOOR, clientId: 'configured-pingone-client' });
    return agent.post('/api/privilege-mcp/auth/start').send({ returnTo: '/audit-agent' });
  }

  it('sends the browser to the door’s AS, not PingOne', async () => {
    const res = await startAuth();
    expect(res.status).toBe(200);
    const url = new URL(res.body.authUrl);
    expect(url.origin).toBe(AS);
    expect(url.pathname).toBe('/oauth/authorize');
    // The exact regression seen live: signing in at PingOne with the Privilege
    // SSO client, whose token the door's AS never issued.
    expect(res.body.authUrl).not.toContain('pingone.com');
  });

  it('requests the scope the RESOURCE advertises, not the session default', async () => {
    const res = await startAuth();
    const url = new URL(res.body.authUrl);
    expect(url.searchParams.get('scope')).toBe('audit:read');
    expect(url.searchParams.get('scope')).not.toContain('openid');
  });

  it('registers a DCR client rather than reusing the configured PingOne id', async () => {
    const res = await startAuth();
    const url = new URL(res.body.authUrl);
    // The broker keeps its own client registry — a PingOne app id means nothing
    // to it, so a configured id here would fail at the token endpoint.
    expect(url.searchParams.get('client_id')).toBe('dcr-client-123');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
