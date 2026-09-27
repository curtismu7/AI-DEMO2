'use strict';

const express = require('express');
const request = require('supertest');
const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

describe('PF AI Agent CIMD routes', () => {
  test('serves CIMD metadata with no application session or secret', async () => {
    const store = {
      getEffective: (key) => ({
        pf_ai_cimd_enabled: 'true',
        pf_issuer: 'https://pf.example.test',
        pf_authorization_endpoint: 'https://pf.example.test/as/authorize',
        pf_token_endpoint: 'https://pf.example.test/as/token',
        pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
        pf_admin_client_secret: 'must-never-be-exposed',
      }[String(key).toLowerCase()] || ''),
    };
    const app = express();
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: store }));

    const response = await request(app).get('/api/pf-ai-agent/cimd/client-metadata.json').expect(200);

    expect(response.body.client_id).toBe(response.body.redirect_uris[0]
      .replace('/cimd/callback', '/cimd/client-metadata.json'));
    expect(response.body.token_endpoint_auth_method).toBe('none');
    expect(JSON.stringify(response.body)).not.toContain('must-never-be-exposed');
  });

  test('rejects CIMD start when there is no signed-in BFF session', async () => {
    const store = { getEffective: () => '' };
    const app = express();
    app.use((req, res, next) => { req.session = {}; next(); });
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: store }));

    await request(app).get('/api/pf-ai-agent/cimd/start').expect(401);
  });
});
