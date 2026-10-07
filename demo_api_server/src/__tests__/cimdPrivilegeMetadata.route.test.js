/**
 * GET /api/cimd/privilege/:slug/client-metadata.json — the document PingOne
 * Privilege fetches. Spec shape: client_id is the document URL, public client.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/personalAgentCimdService', () => ({ metadataDocument: () => null }));

const routes = require('../../routes/cimdAgentMetadata');

const app = express();
app.use('/api/cimd', routes);

const path = (slug) => `/api/cimd/privilege/${slug}/client-metadata.json`;

describe('CIMD Privilege client documents', () => {
  test.each(['super-banking-investment-advisor-agent', 'langchain-agent', 'demo-agent-service'])(
    '%s serves a spec-shaped document',
    async (slug) => {
      const res = await request(app).get(path(slug)).set('Host', 'docs.example.test');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      const doc = res.body;
      expect(doc.client_id).toBe(`http://docs.example.test${path(slug)}`);
      expect(doc.client_name).toBeTruthy();
      expect(doc.grant_types).toContain('authorization_code');
      expect(doc.token_endpoint_auth_method).toBe('none');
      expect(doc.redirect_uris).toEqual(['http://docs.example.test/api/external-agents/callback']);
      expect(doc.client_secret).toBeUndefined();
    }
  );

  test('unknown agent is 404', async () => {
    const res = await request(app).get(path('nope'));
    expect(res.status).toBe(404);
  });
});
