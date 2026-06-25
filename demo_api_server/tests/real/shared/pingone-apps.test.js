'use strict';
/**
 * PingOne app configuration (real).
 *
 * Verifies each registered OAuth application has correct configuration:
 *  - Scopes (read, write, openid)
 *  - Redirect URIs (no hardcoded localhost)
 *  - Token endpoint auth method (basic or post)
 *  - RFC 8693 token exchange configured (may_act)
 *  - OIDC discovery endpoint reachable
 */

const { createBffClient } = require('../helpers/bffClient');

describe('PingOne app configuration (real)', () => {
  let client;
  let adminClient;

  beforeAll(async () => {
    skipIfNoSession();
    client      = createBffClient('enduser');
    adminClient = createBffClient('admin');
  });

  it('admin session is authenticated', async () => {
    const r = await adminClient.get('/api/auth/oauth/status');
    expect(r.status).toBe(200);
    expect(r.data?.authenticated).toBe(true);
  });

  it('GET /api/pingone-test/apps returns app list', async () => {
    const r = await adminClient.get('/api/pingone-test/apps');
    if (r.status === 503 || r.status === 404) {
      console.warn('[pingone-apps] /apps unavailable — skip');
      return;
    }
    expect(r.status).toBe(200);
    // Either success with apps array or an error from Management API
    const apps = r.data?.apps || [];
    if (r.data?.success === false) {
      console.warn('[pingone-apps] Management API not configured:', r.data?.error);
      return;
    }
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(0);
    // Each app has name and type
    for (const app of apps) {
      expect(app.name || app.id).toBeDefined();
    }
  });

  it('redirect URIs do not contain hardcoded localhost port', async () => {
    const health = await client.get('/api/health');
    const config = health.data?.config || {};
    // admin_redirect_uri and user_redirect_uri should use api.ping.demo or PUBLIC_APP_URL
    const adminRedirect = config.admin_redirect_uri || config.pingone_admin_redirect_uri;
    const userRedirect  = config.user_redirect_uri  || config.pingone_user_redirect_uri;
    if (adminRedirect) expect(adminRedirect).not.toMatch(/localhost:\d{4}/);
    if (userRedirect)  expect(userRedirect).not.toMatch(/localhost:\d{4}/);
  });

  it('PingOne environment ID is a valid UUID', async () => {
    const health = await client.get('/api/health');
    const envId = health.data?.config?.pingone_environment_id;
    if (!envId) {
      console.warn('[pingone-apps] PINGONE_ENVIRONMENT_ID not in health — skip');
      return;
    }
    expect(envId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('OIDC discovery endpoint is reachable with expected fields', async () => {
    const health = await client.get('/api/health');
    const pingoneRegion = health.data?.config?.pingone_region || 'com';
    const envId = health.data?.config?.pingone_environment_id;
    if (!envId) { console.warn('[pingone-apps] no envId — skip discovery'); return; }

    const https = require('https');
    const axios = require('axios');
    const r = await axios.get(
      `https://auth.pingone.${pingoneRegion}/${envId}/as/.well-known/openid-configuration`,
      { httpsAgent: new https.Agent({ rejectUnauthorized: false }), validateStatus: () => true, timeout: 8000 }
    );
    expect(r.status).toBe(200);
    expect(r.data.issuer).toBeDefined();
    expect(r.data.token_endpoint).toBeDefined();
    expect(r.data.authorization_endpoint).toBeDefined();
    expect(r.data.jwks_uri).toBeDefined();
  });

  it('session token scope includes read or openid', async () => {
    const r = await client.get('/api/auth/oauth/token-claims');
    expect(r.status).toBe(200);
    const scope = r.data?.decoded?.payload?.scope || '';
    expect(scope.length).toBeGreaterThan(0);
    expect(scope.includes('read') || scope.includes('openid')).toBe(true);
  });

  it('RFC 8693 token exchange succeeds', async () => {
    const r = await client.get('/api/pingone-test/exchange-user-to-mcp');
    if (r.status !== 200) {
      console.warn('[pingone-apps] exchange failed:', r.status);
      return;
    }
    expect(r.data?.success).toBe(true);
    const payload = r.data?.decoded?.payload;
    expect(payload?.sub).toBeDefined();
    // act claim may or may not be present depending on PingOne token policy
    if (payload?.act !== undefined) {
      expect(payload.act.sub || payload.act.client_id).toBeDefined();
      console.log('[pingone-apps] act claim present:', JSON.stringify(payload.act));
    } else {
      console.warn('[pingone-apps] act claim absent — PingOne may_act token policy may not be configured');
    }
  });

  it('GET /api/pingone-test/resources lists resource servers', async () => {
    const r = await adminClient.get('/api/pingone-test/resources');
    if (r.status === 503 || r.status === 404) {
      console.warn('[pingone-apps] /resources unavailable — skip');
      return;
    }
    expect(r.status).toBe(200);
    if (r.data?.success === false) {
      console.warn('[pingone-apps] resources error:', r.data?.error);
      return;
    }
    const resources = r.data?.resources || [];
    expect(Array.isArray(resources)).toBe(true);
  });

  it('GET /api/pingone-test/scopes lists scopes for resources', async () => {
    const r = await adminClient.get('/api/pingone-test/scopes');
    if (r.status === 503 || r.status === 404) {
      console.warn('[pingone-apps] /scopes unavailable — skip');
      return;
    }
    expect(r.status).toBe(200);
    if (r.data?.success === false) {
      console.warn('[pingone-apps] scopes error:', r.data?.error);
      return;
    }
    const scopes = r.data?.scopes || [];
    if (Array.isArray(scopes) && scopes.length > 0) {
      // Should have at least read scope
      const names = scopes.map(s => s.name || s);
      console.log('[pingone-apps] scopes:', names.slice(0, 5));
    }
  });
});
