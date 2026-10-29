'use strict';

const express = require('express');
const request = require('supertest');

const APP = 'https://app.example.test';
const DOC = `${APP}/api/pf-ai-agent/cimd/client-metadata.json`;
const mockConfig = {
  issuer: 'https://pf.example.test',
  discoveryEndpoint: 'https://pf.example.test/.well-known/openid-configuration',
  authorizationEndpoint: 'https://pf.example.test/as/authorization.oauth2',
  clientMetadataUrl: DOC,
  redirectUri: `${APP}/api/pf-ai-agent/cimd/callback`,
};
jest.mock('../../services/pfAiAgentFeatureConfig', () => ({
  ...jest.requireActual('../../services/pfAiAgentFeatureConfig'),
  resolveCimdConfig: jest.fn(() => mockConfig),
  getFeatureStatus: jest.fn(() => ({ cimd: true })),
}));

const { validateCimdDocument } = require('../../services/pfAiAgentCimdTesterService');
const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

const good = {
  client_id: DOC, client_name: 'Agent', client_uri: APP,
  redirect_uris: [mockConfig.redirectUri], token_endpoint_auth_method: 'none',
};

describe('CIMD document rules (after client.dev)', () => {
  test('a good document passes with no warnings', () => {
    expect(validateCimdDocument(good, DOC)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  test.each([
    ['client_id must match the URL', { ...good, client_id: `${APP}/other.json` }, DOC, 'client_id'],
    ['client_id must be HTTPS', { ...good, client_id: 'http://app.example.test/doc.json' }, null, 'client_id'],
    ['redirect_uris required', { ...good, redirect_uris: undefined }, DOC, 'redirect_uris'],
    ['redirect_uris unique', { ...good, redirect_uris: ['https://a.example.test', 'https://a.example.test'] }, DOC, 'redirect_uris'],
    ['no shared secret method', { ...good, token_endpoint_auth_method: 'client_secret_basic' }, DOC, 'token_endpoint_auth_method'],
    ['no client secret', { ...good, client_secret: 'x' }, DOC, 'client_secret'],
  ])('%s', (_, doc, source, path) => {
    const result = validateCimdDocument(doc, source);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain(path);
  });

  // client.dev compared .hostname on strings, so this warning never fired there.
  test('warns when client_uri is on another host', () => {
    const result = validateCimdDocument({ ...good, client_uri: 'https://elsewhere.example.test' }, DOC);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.path)).toEqual(['client_uri']);
  });

  test('a non-object is refused, not thrown on', () => {
    expect(validateCimdDocument(null, DOC).valid).toBe(false);
    expect(validateCimdDocument([], DOC).valid).toBe(false);
  });
});

function appWith(fetchImpl, session = { oauthProvider: 'pingone', oauthTokens: { accessToken: 't' } }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: { getEffective: () => '' }, fetchImpl }));
  return app;
}

describe('CIMD tester routes', () => {
  test('serves the negative documents publicly and nothing else under that path', async () => {
    const app = appWith(jest.fn(), {});
    const mismatch = await request(app).get('/api/pf-ai-agent/cimd/negative/client-id-mismatch.json').expect(200);
    expect(mismatch.body.client_id).toBe(DOC);
    const secret = await request(app).get('/api/pf-ai-agent/cimd/negative/shared-secret.json').expect(200);
    expect(secret.body).toMatchObject({ client_id: `${APP}/api/pf-ai-agent/cimd/negative/shared-secret.json`, token_endpoint_auth_method: 'client_secret_basic' });
    await request(app).get('/api/pf-ai-agent/cimd/negative/other.json').expect(404);
  });

  test('checks a pasted document without fetching anything', async () => {
    const fetchImpl = jest.fn();
    const res = await request(appWith(fetchImpl)).post('/api/pf-ai-agent/cimd/tester/client')
      .send({ document: JSON.stringify({ ...good, token_endpoint_auth_method: 'client_secret_post' }) }).expect(200);
    expect(res.body).toMatchObject({ source: 'pasted', valid: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('refuses pasted text that is not JSON', async () => {
    const res = await request(appWith(jest.fn())).post('/api/pf-ai-agent/cimd/tester/client').send({ document: 'not json' }).expect(400);
    expect(res.body.error).toBe('PF_AI_CIMD_DOCUMENT_INVALID');
  });

  test('reads CIMD support from PingFederate discovery', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ issuer: mockConfig.issuer, client_id_metadata_document_supported: true, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] }),
    }));
    const res = await request(appWith(fetchImpl)).post('/api/pf-ai-agent/cimd/tester/server').expect(200);
    expect(res.body.checks.every((c) => c.ok)).toBe(true);
  });

  test('reports PingFederate\'s own verdict for each probe and whether it was the expected one', async () => {
    // PingFederate accepts only this app's document with its own redirect URI.
    const fetchImpl = jest.fn(async (url) => {
      const params = new URL(url).searchParams;
      const ok = params.get('client_id') === DOC && params.get('redirect_uri') === mockConfig.redirectUri;
      return ok
        ? { status: 200, text: async () => '<html>Sign in</html>' }
        : { status: 400, text: async () => `<div>400 - Invalid ${params.get('client_id') === DOC ? 'redirect_uri' : 'client_id'}</div>` };
    });
    const res = await request(appWith(fetchImpl)).post('/api/pf-ai-agent/cimd/tester/probe').expect(200);
    const byId = Object.fromEntries(res.body.results.map((r) => [r.id, r]));
    expect(byId.valid).toMatchObject({ accepted: true, asExpected: true });
    expect(byId['redirect-not-listed']).toMatchObject({ accepted: false, pfSays: '400 - Invalid redirect_uri', asExpected: true });
    expect(byId['not-in-policy']).toMatchObject({ accepted: false, pfSays: '400 - Invalid client_id' });
    // The impersonating document is served at its own URL, so it is a different client_id from this app's.
    expect(byId['client-id-mismatch'].clientId).toBe(`${APP}/api/pf-ai-agent/cimd/negative/client-id-mismatch.json`);
    expect(fetchImpl.mock.calls.every(([url]) => url.startsWith(mockConfig.authorizationEndpoint))).toBe(true);
  });

  test('needs an application session', async () => {
    await request(appWith(jest.fn(), {})).post('/api/pf-ai-agent/cimd/tester/probe').expect(401);
  });
});
