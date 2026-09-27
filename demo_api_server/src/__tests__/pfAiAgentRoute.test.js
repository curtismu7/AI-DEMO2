'use strict';

const express = require('express');
const request = require('supertest');
const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

describe('PF AI Agent namespace status', () => {
  test('reports disabled features without exposing secrets or switching the provider', async () => {
    const values = {
      oauth_provider: 'pingone',
      pf_ai_cross_domain_client_secret: 'pf-test-client-secret',
      pf_ai_third_party_client_secret: 'downstream-test-client-secret',
    };
    const store = {
      getEffective: jest.fn((key) => values[String(key).toLowerCase()] ?? ''),
      getOAuthProvider: jest.fn(() => 'pingone'),
    };
    const app = express();
    app.use((req, res, next) => {
      req.session = { oauthProvider: 'pingone' };
      next();
    });
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: store }));

    const response = await request(app).get('/api/pf-ai-agent/status').expect(200);

    expect(response.body.sessionProvider).toBe('pingone');
    expect(response.body.features).toEqual({ cimd: false, crossDomain: false, rar: false });
    expect(response.body.nativeIdJagPath).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain('test-client-secret');
    expect(store.getOAuthProvider()).toBe('pingone');
    expect(store.getEffective).not.toHaveBeenCalledWith('oauth_provider');
  });
});
