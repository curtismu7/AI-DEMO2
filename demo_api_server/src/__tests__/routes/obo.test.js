// demo_api_server/src/__tests__/routes/obo.test.js
'use strict';
const express = require('express');
const request = require('supertest');

jest.mock('../../../services/tokenValidationService');
jest.mock('../../../services/oboExchangeService');
jest.mock('../../../services/oboDownstream');
jest.mock('../../../services/oboEventHub');
jest.mock('../../../services/oboConfig', () => ({
  getOboConfig: () => ({ issuer: 'https://iss', jwksUri: 'https://iss/jwks', inboundAudiences: ['mcpgateway.ping.demo'] }),
}));

const { validateToken } = require('../../../services/tokenValidationService');
const { runObo } = require('../../../services/oboExchangeService');
const { verifyDownstream } = require('../../../services/oboDownstream');
const hub = require('../../../services/oboEventHub');
const { router, metadataHandler } = require('../../../routes/obo');

const app = express();
app.use(express.json());
app.use('/api/obo', router);
app.get('/.well-known/oauth-protected-resource/api/obo/mcp', metadataHandler);

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const evidence = {
  sub: 'u1', leak: false,
  delegated: { aud: ['obo-demo.ping.demo'], scope: 'obo:invoke', sub: 'u1', act: { client_id: 'AGENT' }, exp: 1 },
  downstream: { delegated: 200, userToken: 401 }, checks: [{ id: 'x', label: 'x', pass: true }],
};

describe('POST /api/obo/mcp', () => {
  test('401 with an OAuth resource_metadata challenge when no Bearer', async () => {
    const res = await request(app).post('/api/obo/mcp').send(rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer resource_metadata="https?:\/\/[^"]+\/api\/obo\/mcp\/oauth-protected-resource"$/);
  });

  test('401 challenge when the token fails validation', async () => {
    validateToken.mockRejectedValue(new Error('bad sig'));
    const res = await request(app).post('/api/obo/mcp').set('Authorization', 'Bearer x').send(rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBeDefined();
  });

  test('absent token: challenge has no error=; failed Bearer: error="invalid_token"', async () => {
    const none = await request(app).post('/api/obo/mcp').send(rpc('tools/list'));
    expect(none.headers['www-authenticate']).not.toMatch(/error=/);
    validateToken.mockRejectedValue(new Error('bad sig'));
    const bad = await request(app).post('/api/obo/mcp').set('Authorization', 'Bearer x').send(rpc('tools/list'));
    expect(bad.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  test('logs a rejected inbound call with aud/client_id but never the token', async () => {
    const payload = Buffer.from(JSON.stringify({ aud: 'wrong-aud', client_id: 'cid-1' })).toString('base64url');
    const token = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
    validateToken.mockRejectedValue(new Error('jwt audience invalid'));
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await request(app).post('/api/obo/mcp').set('Authorization', `Bearer ${token}`).send(rpc('tools/list'));
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    spy.mockRestore();
    expect(logged).toContain('jwt audience invalid');
    expect(logged).toContain('wrong-aud');
    expect(logged).toContain('cid-1');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(payload);
  });

  test('validates against the configured inbound audiences', async () => {
    validateToken.mockResolvedValue({ sub: 'u1' });
    await request(app).post('/api/obo/mcp').set('Authorization', 'Bearer x').send(rpc('ping'));
    expect(validateToken).toHaveBeenCalledWith('x', { jwksUri: 'https://iss/jwks', issuer: 'https://iss', audience: ['mcpgateway.ping.demo'] });
  });

  describe('with a valid token', () => {
    beforeEach(() => validateToken.mockResolvedValue({ sub: 'u1' }));
    const post = (body) => request(app).post('/api/obo/mcp').set('Authorization', 'Bearer x').send(body);

    test('initialize echoes the protocol version', async () => {
      const res = await post(rpc('initialize', { protocolVersion: '2025-06-18' }));
      expect(res.body.result.protocolVersion).toBe('2025-06-18');
      expect(res.body.result.capabilities).toEqual({ tools: {} });
    });

    test('tools/list returns the single tool', async () => {
      const res = await post(rpc('tools/list'));
      expect(res.body.result.tools.map((t) => t.name)).toEqual(['act_on_my_behalf']);
    });

    test('tools/call runs the exchange, publishes evidence for the user, and returns claims only', async () => {
      runObo.mockResolvedValue(evidence);
      const res = await post(rpc('tools/call', { name: 'act_on_my_behalf' }));
      expect(runObo).toHaveBeenCalledWith(expect.objectContaining({ subjectToken: 'x', source: 'claude' }));
      expect(hub.publish).toHaveBeenCalledWith('u1', evidence);
      const text = res.body.result.content[0].text;
      expect(text).toContain('"client_id": "AGENT"');
      expect(text).not.toMatch(/eyJ/);
    });

    test('a leaking result is withheld from the model', async () => {
      runObo.mockResolvedValue({ ...evidence, leak: true });
      const res = await post(rpc('tools/call', { name: 'act_on_my_behalf' }));
      expect(res.body.result.content[0].text).toMatch(/withheld/);
    });

    test('an exchange failure is a tool error, not an HTTP 500', async () => {
      runObo.mockRejectedValue(new Error('Token exchange failed for ex: invalid_scope'));
      const res = await post(rpc('tools/call', { name: 'act_on_my_behalf' }));
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/invalid_scope/);
    });

    test('an exchange error containing a token is withheld from the model', async () => {
      runObo.mockRejectedValue(new Error('boom eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig'));
      const res = await post(rpc('tools/call', { name: 'act_on_my_behalf' }));
      const text = res.body.result.content[0].text;
      expect(text).not.toMatch(/eyJ/);
      expect(text).toMatch(/withheld/);
    });

    test('an unknown tool name is a JSON-RPC invalid-params error', async () => {
      const res = await post(rpc('tools/call', { name: 'other' }, 7));
      expect(res.body.id).toBe(7);
      expect(res.body.error).toEqual({ code: -32602, message: 'unknown tool' });
    });

    test('a notification (no id) gets 202 with no body', async () => {
      const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(res.status).toBe(202);
    });

    test('an unknown method gets a JSON-RPC method-not-found error', async () => {
      const res = await post(rpc('resources/list'));
      expect(res.body.error.code).toBe(-32601);
    });
  });
});

describe('GET /api/obo/mcp', () => {
  test('405 with Allow: POST', async () => {
    const res = await request(app).get('/api/obo/mcp');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});

describe('GET /api/obo/downstream', () => {
  test('401 without a Bearer', async () => {
    expect((await request(app).get('/api/obo/downstream')).status).toBe(401);
  });
  test('passes the verifier result through', async () => {
    verifyDownstream.mockResolvedValue({ status: 200, acting_for: 'u1', acted_by: { client_id: 'A' } });
    const res = await request(app).get('/api/obo/downstream').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.acted_by).toEqual({ client_id: 'A' });
  });
});

describe('metadata', () => {
  test('advertises this resource and PingOne as the authorization server', async () => {
    const res = await request(app).get('/.well-known/oauth-protected-resource/api/obo/mcp');
    expect(res.body.resource).toMatch(/\/api\/obo\/mcp$/);
    expect(res.body.authorization_servers).toEqual(['https://iss']);
  });
});

describe('metadata on the proxied /api/ path', () => {
  test('GET /api/obo/mcp/oauth-protected-resource returns the metadata JSON', async () => {
    const res = await request(app).get('/api/obo/mcp/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.resource).toMatch(/\/api\/obo\/mcp$/);
    expect(res.body.authorization_servers).toEqual(['https://iss']);
  });
});
