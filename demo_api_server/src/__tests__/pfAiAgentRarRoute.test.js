'use strict';

const express = require('express');
const request = require('supertest');
const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

describe('PF AI Agent RAR route', () => {
  test('starts only the PF PAR flow and binds it to a single pending PF callback', async () => {
    const values = {
      pf_ai_cimd_enabled: 'true', pf_ai_rar_enabled: 'true',
      pf_issuer: 'https://pf.example.test',
      pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
      pf_authorization_endpoint: 'https://pf.example.test/as/authorize',
      pf_token_endpoint: 'https://pf.example.test/as/token',
      pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
      pf_par_endpoint: 'https://pf.example.test/as/par',
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        issuer: 'https://pf.example.test',
        authorization_endpoint: 'https://pf.example.test/as/authorize',
        token_endpoint: 'https://pf.example.test/as/token',
        jwks_uri: 'https://pf.example.test/pf/JWKS',
        pushed_authorization_request_endpoint: 'https://pf.example.test/as/par',
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        request_uri: 'urn:ietf:params:oauth:request_uri:rar-request', expires_in: 90,
      }) });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = {
        oauthProvider: 'pingfederate',
        oauthTokens: { accessToken: 'pf-session-token' },
        user: { username: 'demouser' },
        pfAiAgent: {},
      };
      next();
    });
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({
      configStore: { getEffective: (key) => values[String(key).toLowerCase()] || '' }, fetchImpl,
    }));

    const response = await request(app)
      .post('/api/pf-ai-agent/rar/start')
      .send({ scenario: 'allowed', userKey: 'demouser' })
      .expect(302);

    expect(response.headers.location).toContain('https://pf.example.test/as/authorize');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].body.get('client_id')).toContain('/cimd/client-metadata.json');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body.get('authorization_details'))[0].type)
      .toBe('banking_transaction');
    expect(response.headers.location).not.toContain('oauth/callback');
  });
});
