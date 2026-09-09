'use strict';

// "PingOne MCP HTTP 401: Invalid authentication" is the same string whether no
// credential arrived or a perfectly valid admin token carried the wrong
// audience — and those need opposite actions. Three investigations chased roles,
// app type and scopes before the audience was ever read.
//
// Measured 2026-09-09 (env 01d89b06): the delegated PKCE token is a real RS256
// token for an Environment Admin that authenticates fine against the Management
// API, but its `aud` is https://api.pingone.com rather than the MCP resource,
// because PingOne ignores the RFC 8707 `resource` indicator for this tenant.

const axios = require('axios');

jest.mock('axios');
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));

const adapter = require('../../services/mcpPingOneHttpAdapter');

const ENV_ID = '01d89b06-66d5-430e-9f28-65636843788b';
const MCP_URL = `https://mcp.pingone.com/admin/${ENV_ID}/mcp`;

function jwt(claims) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256', kid: 'k' })}.${part(claims)}.sig`;
}

function http401() {
  const err = new Error('Request failed with status code 401');
  err.response = { status: 401, data: 'Invalid authentication' };
  return err;
}

describe('a 401 from the hosted MCP names which 401 it is', () => {
  const saved = {};

  beforeEach(() => {
    saved.env = process.env.PINGONE_ENVIRONMENT_ID;
    saved.region = process.env.PINGONE_REGION;
    process.env.PINGONE_ENVIRONMENT_ID = ENV_ID;
    process.env.PINGONE_REGION = 'com';
    axios.post.mockReset();
  });

  afterEach(() => {
    if (saved.env === undefined) delete process.env.PINGONE_ENVIRONMENT_ID;
    else process.env.PINGONE_ENVIRONMENT_ID = saved.env;
    if (saved.region === undefined) delete process.env.PINGONE_REGION;
    else process.env.PINGONE_REGION = saved.region;
  });

  test('a wrong-audience token says so, and says roles/scopes will not fix it', async () => {
    axios.post.mockRejectedValue(http401());

    const token = jwt({ aud: ['https://api.pingone.com'], scope: 'openid' });
    await expect(adapter.listTools(token)).rejects.toThrow(/audience is \[https:\/\/api\.pingone\.com\]/);

    await expect(adapter.listTools(token)).rejects.toThrow(new RegExp(MCP_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(adapter.listTools(token)).rejects.toThrow(/needs PingOne-side enablement/);
    // The underlying error must survive — a diagnosis explains, never replaces.
    await expect(adapter.listTools(token)).rejects.toThrow(/PingOne MCP HTTP 401/);
  });

  test('a right-audience token points at permissions instead, not at enablement', async () => {
    axios.post.mockRejectedValue(http401());

    const token = jwt({ aud: [MCP_URL], scope: 'openid' });
    await expect(adapter.listTools(token)).rejects.toThrow(/audience is correct/);
    await expect(adapter.listTools(token)).rejects.toThrow(/admin roles/);
    await expect(adapter.listTools(token)).rejects.not.toThrow(/needs PingOne-side enablement/);
  });

  test('a non-JWT credential is reported as such rather than crashing the handler', async () => {
    axios.post.mockRejectedValue(http401());

    await expect(adapter.listTools('opaque-token')).rejects.toThrow(/not a JWT/);
  });

  test('a non-401 error is left exactly as it was', async () => {
    const err = new Error('boom');
    err.response = { status: 503, data: 'upstream down' };
    axios.post.mockRejectedValue(err);

    const token = jwt({ aud: ['https://api.pingone.com'] });
    await expect(adapter.listTools(token)).rejects.toThrow(/PingOne MCP HTTP 503/);
    await expect(adapter.listTools(token)).rejects.not.toThrow(/audience/);
  });
});
