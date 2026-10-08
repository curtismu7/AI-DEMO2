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
const CLIENT_CALLBACK = '/api/privilege-mcp/auth/callback';
const LOCAL_ORIGIN = 'https://local.ping-devops.com:4000';

describe('CIMD Privilege client documents', () => {
  test.each([
    ['super-banking-investment-advisor-agent', SHARED, []],
    ['langchain-agent', SHARED, []],
    ['demo-agent-service', SHARED, []],
    // The in-app Privilege MCP client signs in through its own callback, and Privilege only honours listed ones.
    // Its document also lists the local stack's callback: a local sign-in uses THIS document as its client_id.
    ['privilege-mcp-client', CLIENT_CALLBACK, [`${LOCAL_ORIGIN}${CLIENT_CALLBACK}`]]
  ])('%s serves a spec-shaped document', async (slug, redirectPath, alsoListed) => {
    const res = await request(app).get(path(slug)).set('Host', 'docs.example.test');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const doc = res.body;
    expect(doc.client_id).toBe(`http://docs.example.test${path(slug)}`);
    expect(doc.client_name).toBeTruthy();
    expect(doc.grant_types).toContain('authorization_code');
    expect(doc.token_endpoint_auth_method).toBe('none');
    expect(doc.redirect_uris).toEqual([`http://docs.example.test${redirectPath}`, ...alsoListed]);
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

  describe('behind a proxy that rewrites Host', () => {
    const saved = process.env.PUBLIC_APP_URL;
    afterEach(() => {
      if (saved === undefined) delete process.env.PUBLIC_APP_URL;
      else process.env.PUBLIC_APP_URL = saved;
    });

    test('PUBLIC_APP_URL names the document and its redirect, not the internal host the proxy sent', async () => {
      process.env.PUBLIC_APP_URL = 'https://app.example.test';
      // The Docker UI's nginx forwards Host: demo-api-server:3001, which is what the readiness check saw.
      const res = await request(app).get(path('privilege-mcp-client')).set('Host', 'demo-api-server:3001');
      expect(res.body.client_id).toBe(`https://app.example.test${path('privilege-mcp-client')}`);
      expect(res.body.redirect_uris).toEqual([
        'https://app.example.test/api/privilege-mcp/auth/callback',
        `${LOCAL_ORIGIN}${CLIENT_CALLBACK}`
      ]);
    });

    test('a malformed PUBLIC_APP_URL falls back to the request instead of failing', async () => {
      process.env.PUBLIC_APP_URL = 'not a url';
      const res = await request(app).get(path('langchain-agent')).set('Host', 'docs.example.test');
      expect(res.status).toBe(200);
      expect(res.body.client_id).toBe(`http://docs.example.test${path('langchain-agent')}`);
    });
  });
});

describe('the in-app client document lists the other origins it signs in from', () => {
  const KEYS = ['CIMD_PRIVILEGE_CLIENT_EXTRA_REDIRECT_ORIGINS', 'PUBLIC_APP_URL'];
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    delete process.env.PUBLIC_APP_URL;
    delete process.env.CIMD_PRIVILEGE_CLIENT_EXTRA_REDIRECT_ORIGINS;
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const redirects = async (slug = 'privilege-mcp-client') => (
    await request(app).get(path(slug)).set('Host', 'docs.example.test')
  ).body.redirect_uris;

  test('defaults to the serving origin plus the local stack', async () => {
    expect(await redirects()).toEqual([`http://docs.example.test${CLIENT_CALLBACK}`, `${LOCAL_ORIGIN}${CLIENT_CALLBACK}`]);
  });

  test('a comma list replaces the default; malformed entries are ignored', async () => {
    process.env.CIMD_PRIVILEGE_CLIENT_EXTRA_REDIRECT_ORIGINS = 'https://a.example.test, not a url, https://b.example.test:8443/ignored/path';
    expect(await redirects()).toEqual([
      `http://docs.example.test${CLIENT_CALLBACK}`,
      `https://a.example.test${CLIENT_CALLBACK}`,
      `https://b.example.test:8443${CLIENT_CALLBACK}`
    ]);
  });

  test('an explicitly empty value publishes only the serving origin', async () => {
    process.env.CIMD_PRIVILEGE_CLIENT_EXTRA_REDIRECT_ORIGINS = '';
    expect(await redirects()).toEqual([`http://docs.example.test${CLIENT_CALLBACK}`]);
  });

  test('an extra origin equal to the serving origin is listed once', async () => {
    process.env.PUBLIC_APP_URL = LOCAL_ORIGIN;
    expect(await redirects()).toEqual([`${LOCAL_ORIGIN}${CLIENT_CALLBACK}`]);
  });

  test('no other agent gets the extra callbacks', async () => {
    expect(await redirects('langchain-agent')).toEqual([`http://docs.example.test${SHARED}`]);
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
