'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: (key) => (key === 'pf_issuer' ? 'https://pf.example:9031' : ''),
}));

const express = require('express');
const request = require('supertest');

function app() {
  const poppy = require('../routes/poppyDiscovery');
  const a = express();
  a.use('/.well-known', poppy.router);
  a.use('/.well-known/oauth-protected-resource', poppy.protectedResourceOnPoppyHost);
  a.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({ resource: 'https://main.example/api' }));
  return a;
}

describe('Poppy discovery', () => {
  beforeEach(() => {
    process.env.POPPY_DOMAIN = 'poppy.example';
    delete process.env.POPPY_MCP_URL;
  });
  afterEach(() => {
    delete process.env.POPPY_DOMAIN;
    jest.resetModules();
  });

  it('serves poppy.json on the Poppy host with scope_hints for every scope', async () => {
    const res = await request(app()).get('/.well-known/poppy.json').set('Host', 'poppy.example');
    expect(res.status).toBe(200);
    expect(res.body.protocol_version).toBe('0.3');
    expect(res.body.organization.domain).toBe('poppy.example');
    expect(res.body.auth.issuer).toBe('https://pf.example:9031');
    const scopes = Object.keys(res.body.auth.scopes);
    expect(Object.keys(res.body.auth.scope_hints).sort()).toEqual(scopes.sort());
    for (const hint of Object.values(res.body.auth.scope_hints)) {
      expect(['none', 'reversible', 'irreversible']).toContain(hint.changes);
      expect(typeof hint.personal_data).toBe('boolean');
    }
    expect(res.body.apis).toBeUndefined();
  });

  it('lists the MCP api when POPPY_MCP_URL is set', async () => {
    process.env.POPPY_MCP_URL = 'https://poppy.example/mcp';
    const res = await request(app()).get('/.well-known/poppy.json').set('Host', 'poppy.example');
    expect(res.body.apis).toEqual([expect.objectContaining({ type: 'mcp', url: 'https://poppy.example/mcp' })]);
  });

  it('404s poppy.json on any other host', async () => {
    const res = await request(app()).get('/.well-known/poppy.json').set('Host', 'main.example');
    expect(res.status).toBe(404);
  });

  it('serves resource = https://{domain} on the Poppy host', async () => {
    const res = await request(app()).get('/.well-known/oauth-protected-resource').set('Host', 'poppy.example');
    expect(res.body.resource).toBe('https://poppy.example');
    expect(res.body.authorization_servers).toEqual(['https://pf.example:9031']);
  });

  it('leaves the main host protected-resource document untouched', async () => {
    const res = await request(app()).get('/.well-known/oauth-protected-resource').set('Host', 'main.example');
    expect(res.body.resource).toBe('https://main.example/api');
  });

  it('does nothing when POPPY_DOMAIN is unset', async () => {
    delete process.env.POPPY_DOMAIN;
    const res = await request(app()).get('/.well-known/poppy.json').set('Host', 'poppy.example');
    expect(res.status).toBe(404);
  });
});
