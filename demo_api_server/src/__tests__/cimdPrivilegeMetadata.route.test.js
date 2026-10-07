/**
 * GET /api/cimd/privilege/:slug/client-metadata.json — the document PingOne
 * Privilege fetches. Spec shape: client_id is the document URL, public client.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/personalAgentCimdService', () => ({ metadataDocument: () => null }));
jest.mock('../../services/cimdReadinessService', () => ({
  runReadiness: jest.fn(async () => ({ ok: true, checks: [], targets: {} }))
}));

const routes = require('../../routes/cimdAgentMetadata');
const cimdReadinessService = require('../../services/cimdReadinessService');

const app = express();
app.use('/api/cimd', routes);

const path = (slug) => `/api/cimd/privilege/${slug}/client-metadata.json`;
const SHARED = '/api/external-agents/callback';

describe('CIMD Privilege client documents', () => {
  test.each([
    ['super-banking-investment-advisor-agent', SHARED],
    ['langchain-agent', SHARED],
    ['demo-agent-service', SHARED],
    // The in-app Privilege MCP client signs in through its own callback, and Privilege only honours listed ones.
    ['privilege-mcp-client', '/api/privilege-mcp/auth/callback']
  ])('%s serves a spec-shaped document', async (slug, redirectPath) => {
    const res = await request(app).get(path(slug)).set('Host', 'docs.example.test');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const doc = res.body;
    expect(doc.client_id).toBe(`http://docs.example.test${path(slug)}`);
    expect(doc.client_name).toBeTruthy();
    expect(doc.grant_types).toContain('authorization_code');
    expect(doc.token_endpoint_auth_method).toBe('none');
    expect(doc.redirect_uris).toEqual([`http://docs.example.test${redirectPath}`]);
    expect(doc.client_secret).toBeUndefined();
  });

  test('unknown agent is 404', async () => {
    const res = await request(app).get(path('nope'));
    expect(res.status).toBe(404);
  });

  test('a slug that is an Object.prototype name is 404, not an inherited value', async () => {
    const res = await request(app).get(path('constructor'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/cimd/privilege/check', () => {
  test('returns the readiness result and takes no caller-supplied target', async () => {
    const res = await request(app).get('/api/cimd/privilege/check?url=http://evil.example.test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // runReadiness is called with no arguments: nothing from the query string can reach it.
    expect(cimdReadinessService.runReadiness).toHaveBeenLastCalledWith();
  });

  test('a failure in the check is a 500 with { error }, not a leak', async () => {
    cimdReadinessService.runReadiness.mockRejectedValueOnce(new Error('boom: secret detail'));
    const res = await request(app).get('/api/cimd/privilege/check');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'cimd_readiness_failed' });
  });
});
