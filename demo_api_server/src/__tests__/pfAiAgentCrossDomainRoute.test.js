'use strict';

const express = require('express');
const request = require('supertest');
const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

describe('PF AI Agent cross-domain route', () => {
  test('binds the requested source to the provider and token in the authenticated session', async () => {
    const fetchImpl = jest.fn();
    const store = { getEffective: (key) => ({
      pf_issuer: 'https://pf.example.test',
      pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
      pf_token_endpoint: 'https://pf.example.test/as/token',
      pf_ai_cross_domain_enabled: 'true',
      pf_ai_cross_domain_client_id: 'pf-client',
      pf_ai_cross_domain_client_secret: 'pf-secret',
      pf_ai_cross_domain_audience: 'https://third.example.test',
      pf_ai_cross_domain_resource: 'https://third.example.test/api',
      pf_ai_cross_domain_scope: 'api:invoke',
      pf_ai_third_party_token_endpoint: 'https://third.example.test/token',
      pf_ai_third_party_client_id: 'third-client',
      pf_ai_third_party_client_secret: 'third-secret',
      pf_ai_third_party_resource: 'https://third.example.test/api',
      pf_ai_third_party_scope: 'api:invoke',
    }[String(key).toLowerCase()] || ''),
    };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = { oauthProvider: 'pingone', oauthTokens: { accessToken: 'p1-session-token' } };
      next();
    });
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: store, fetchImpl }));

    const response = await request(app)
      .post('/api/pf-ai-agent/cross-domain/exchange')
      .send({ subjectProvider: 'pingfederate', subject_token: 'attacker-controlled-token' })
      .expect(403);

    expect(response.body.error).toBe('PF_AI_SUBJECT_PROVIDER_MISMATCH');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('p1-session-token');
  });
});
