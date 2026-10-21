'use strict';

// The connector sandbox end to end: every leg of the 12-step diagram runs real logic (PKCE, CIMD client acceptance,
// consent record, private_key_jwt assertion against the client JWKS, audience-bound token, policy decision).

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

// supertest binds a new port per request; a real deployment has one stable origin, which the client document needs.
const ORIGIN = 'https://demo.test';
beforeAll(() => { process.env.PUBLIC_APP_URL = ORIGIN; });
afterAll(() => { delete process.env.PUBLIC_APP_URL; });

function buildApp(user = { id: 'member-1', username: 'ann' }) {
  jest.resetModules();
  const svc = require('../../services/connectorSandbox');
  svc.__reset();
  const router = require('../../routes/connectorSandbox');
  const app = express();
  app.use((req, _res, next) => { req.session = user ? { user } : {}; next(); });
  app.use('/api/connector-sandbox', router);
  return { app, svc };
}

const B = '/api/connector-sandbox';

// Walks the browser legs the way a popup would: authorize -> consent page -> consent POST -> callback with the code.
async function signIn(app, authUrl, decision = 'allow') {
  const u = new URL(authUrl);
  const authz = await request(app).get(`${u.pathname}${u.search}`);
  expect(authz.status).toBe(302);
  const consentPath = new URL(authz.headers.location, 'http://x').pathname + new URL(authz.headers.location, 'http://x').search;
  const consent = await request(app).get(consentPath);
  expect(consent.status).toBe(200);
  expect(consent.text).toContain('Allow ChatGPT');
  const rid = new URL(authz.headers.location, 'http://x').searchParams.get('rid');
  const decided = await request(app).post(`${B}/as/consent`).type('form').send({ rid, decision });
  expect(decided.status).toBe(302);
  const cb = new URL(decided.headers.location);
  return request(app).get(`${cb.pathname}${cb.search}`);
}

describe('connector sandbox', () => {
  it('serves the discovery documents and a CIMD client that uses private_key_jwt with a published JWKS', async () => {
    const { app } = buildApp();
    const client = (await request(app).get(`${B}/client.json`)).body;
    expect(client.client_id.endsWith(`${B}/client.json`)).toBe(true);
    expect(client.token_endpoint_auth_method).toBe('private_key_jwt');
    expect((await request(app).get(client.jwks_uri.replace(/^https?:\/\/[^/]+/, ''))).body.keys[0].kty).toBe('RSA');
    const as = (await request(app).get(`${B}/as/.well-known/oauth-authorization-server`)).body;
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('refuses a tokenless call with a 401 pointing at the protected-resource metadata', async () => {
    const { app } = buildApp();
    const res = await request(app).post(`${B}/mcp`).send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_my_benefits' } });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('runs all 12 steps and permits the member their own benefits, recording consent', async () => {
    const { app } = buildApp();
    const started = (await request(app).post(`${B}/runs`).send({})).body;
    const runId = started.run.id;
    expect(started.run.trace['1b'].response.status).toBe(401);

    const cb = await signIn(app, started.authUrl);
    expect(cb.text).toContain('Connected');

    const tok = (await request(app).post(`${B}/runs/${runId}/token`)).body.run;
    expect(tok.trace['7a'].clientAssertion.payload.iss).toContain('/client.json');
    expect(tok.token.decoded.payload).toMatchObject({ scope: 'benefits:read', sub: 'member-1' });
    expect(tok.token.decoded.payload.aud).toContain(`${B}/mcp`);
    expect(tok.consent).toMatchObject({ status: 'active', version: 1, member: 'member-1' });

    const call = (await request(app).post(`${B}/runs/${runId}/call`).send({ tool: 'get_my_benefits' })).body;
    expect(call.result.status).toBe(200);
    expect(call.run.trace['10b'].response.decision).toBe('PERMIT');
    expect(call.run.trace['10a'].request.context.consent_id).toBe(tok.consent.consentId);
    expect(call.run.trace['11b'].response.body.coverage).toBe('active');
    for (const id of ['1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b', '5a', '5b', '6a', '6b', '6c', '6d', '7a', '8a', '8b', '8c', '9a', '10a', '10b', '11a', '11b', '12a', '12b']) {
      expect(call.run.trace[id]).toBeDefined();
    }
  });

  it('DENYs another member\'s benefits at the policy decision and never calls the downstream API', async () => {
    const { app } = buildApp();
    const { authUrl, run } = (await request(app).post(`${B}/runs`).send({})).body;
    await signIn(app, authUrl);
    await request(app).post(`${B}/runs/${run.id}/token`);
    const call = (await request(app).post(`${B}/runs/${run.id}/call`).send({ tool: 'get_other_member_benefits' })).body;
    expect(call.result.status).toBe(403);
    expect(call.run.trace['10b'].response.decision).toBe('DENY');
    expect(call.run.trace['11a']).toBeUndefined();
  });

  it('issues no code when the member denies consent', async () => {
    const { app } = buildApp();
    const { authUrl, run } = (await request(app).post(`${B}/runs`).send({})).body;
    const cb = await signIn(app, authUrl, 'deny');
    expect(cb.text).toContain('Not connected');
    expect((await request(app).post(`${B}/runs/${run.id}/token`)).status).toBe(400);
  });

  it('rejects a replayed authorization code, and a gateway call with an access token signed by the wrong key', async () => {
    const { app, svc } = buildApp();
    const { authUrl, run } = (await request(app).post(`${B}/runs`).send({})).body;
    await signIn(app, authUrl);
    const first = (await request(app).post(`${B}/runs/${run.id}/token`)).body.run;
    expect(first.token).toBeTruthy();
    // Same run again: the code is single-use, so the exchange fails.
    const again = await request(app).post(`${B}/runs/${run.id}/token`);
    expect(again.status).toBe(400);

    // A forged assertion (different key) fails client authentication.
    const { run: run2, authUrl: authUrl2 } = (await request(app).post(`${B}/runs`).send({})).body;
    await signIn(app, authUrl2);
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const u = svc.urls(ORIGIN);
    const data = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'chatgpt-sandbox-1' })).toString('base64url')}.${Buffer.from(JSON.stringify({ iss: u.clientId, sub: u.clientId, aud: u.token, jti: 'x', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}`;
    const forged = `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
    const stored = svc.publicRun(run2.id);
    expect(stored.status).toBe('code_received');
    const out = svc.gatewayHandle(ORIGIN, { authorization: `Bearer ${forged}`, body: { params: { name: 'get_my_benefits' } } });
    expect(out.status).toBe(401);
    expect(out.body.error_description).toContain('signature');
  });

  it('requires a signed-in member for the browser legs and the run endpoints', async () => {
    const { app } = buildApp(null);
    expect((await request(app).post(`${B}/runs`).send({})).status).toBe(401);
    expect((await request(app).get(`${B}/as/authorize?state=x`)).status).toBe(401);
  });

  it('does not let one member read another member\'s run', async () => {
    const a = buildApp({ id: 'member-1', username: 'ann' });
    const { run } = (await request(a.app).post(`${B}/runs`).send({})).body;
    const other = express();
    other.use((req, _res, next) => { req.session = { user: { id: 'member-2' } }; next(); });
    other.use(B, require('../../routes/connectorSandbox'));
    expect((await request(other).get(`${B}/runs/${run.id}`)).status).toBe(404);
  });
});
