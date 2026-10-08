'use strict';

const express = require('express');
const request = require('supertest');
const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

const values = {
  pf_ai_cimd_enabled: 'true', pf_ai_rar_enabled: 'true',
  pf_issuer: 'https://pf.example.test',
  pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
  pf_authorization_endpoint: 'https://pf.example.test/as/authorize',
  pf_token_endpoint: 'https://pf.example.test/as/token',
  pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
  pf_par_endpoint: 'https://pf.example.test/as/par',
};
const discovery = () => ({ ok: true, json: async () => ({
  issuer: 'https://pf.example.test',
  authorization_endpoint: 'https://pf.example.test/as/authorize',
  token_endpoint: 'https://pf.example.test/as/token',
  jwks_uri: 'https://pf.example.test/pf/JWKS',
  pushed_authorization_request_endpoint: 'https://pf.example.test/as/par',
}) });
const parAnswer = () => ({ ok: true, json: async () => ({
  request_uri: 'urn:ietf:params:oauth:request_uri:playground', expires_in: 90,
}) });

function appWith({ fetchImpl, session, extra = {} }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/pf-ai-agent', createPfAiAgentRouter({
    configStore: { getEffective: (key) => ({ ...values, ...extra })[String(key).toLowerCase()] || '' }, fetchImpl,
  }));
  return app;
}
const signedIn = () => ({
  oauthProvider: 'pingfederate',
  oauthTokens: { accessToken: 'pf-session-token' },
  user: { username: 'demouser' },
  pfAiAgent: {},
});

describe('Protocol Playground starts on PingFederate', () => {
  test('par/start pushes the request without authorization_details and returns the sign-in URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery()).mockResolvedValueOnce(parAnswer());

    const res = await request(appWith({ fetchImpl, session: signedIn() }))
      .post('/api/pf-ai-agent/par/start').send({}).expect(200);

    const body = fetchImpl.mock.calls[1][1].body;
    expect(body.get('authorization_details')).toBeNull();
    expect(body.get('code_challenge_method')).toBe('S256');
    expect(res.body.authorizeUrl).toContain('request_uri=');
    expect(res.body.trace.map((step) => step.id)).toEqual(['par', 'authorize']);
    expect(JSON.stringify(res.body)).not.toContain('pf-session-token');
  });

  test('pkce/start returns the metadata-document client and the authorize request with a challenge', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(discovery());

    const res = await request(appWith({ fetchImpl, session: signedIn() }))
      .post('/api/pf-ai-agent/pkce/start').send({}).expect(200);

    const url = new URL(res.body.authorizeUrl);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_verifier')).toBeNull();
    expect(res.body.trace.map((step) => step.id)).toEqual(['metadata', 'authorize']);
  });

  test('dpop/start is refused with 503 until the DPoP client is configured', async () => {
    const res = await request(appWith({ fetchImpl: jest.fn().mockResolvedValue(discovery()), session: signedIn() }))
      .post('/api/pf-ai-agent/dpop/start').send({}).expect(503);
    expect(res.body).toEqual({ error: 'PF_AI_RAR_DPOP_NOT_CONFIGURED' });
  });

  test('a start without any application session is refused', async () => {
    await request(appWith({ fetchImpl: jest.fn(), session: {} })).post('/api/pf-ai-agent/par/start').send({}).expect(401);
  });

  test('result routes answer state none before a run and the stored result after', async () => {
    const session = signedIn();
    const app = appWith({ fetchImpl: jest.fn(), session });
    expect((await request(app).get('/api/pf-ai-agent/par/result').expect(200)).body).toEqual({ state: 'none' });

    session.pfAiAgent.rarResult = { outcome: 'accepted', tokenType: 'DPoP', dpopThumbprint: 'abc' };
    session.pfAiAgent.cimdResult = { outcome: 'accepted', subject: 'demouser' };
    expect((await request(app).get('/api/pf-ai-agent/dpop/result').expect(200)).body.tokenType).toBe('DPoP');
    expect((await request(app).get('/api/pf-ai-agent/pkce/result').expect(200)).body.subject).toBe('demouser');
  });
});
