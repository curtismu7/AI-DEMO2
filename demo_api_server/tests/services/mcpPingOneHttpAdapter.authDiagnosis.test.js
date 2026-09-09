'use strict';

// "PingOne MCP HTTP 401: Invalid authentication" is the same string whether no
// credential arrived or a valid token was issued by the wrong environment — and
// those need opposite actions.
//
// The load-bearing fact, corrected 2026-09-09 after a first pass got it wrong:
// PingOne serves the admin-plane MCP from the ORGANISATION'S ADMINISTRATORS
// environment, and that one endpoint administers every environment in the org.
// The env in the URL is therefore NOT the env whose data you administer. Reading
// it as the latter is what made an earlier revision blame tenant enablement —
// a conclusion these tests exist to keep from coming back.

const axios = require('axios');

jest.mock('axios');
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));

const adapter = require('../../services/mcpPingOneHttpAdapter');

// The org's Administrators environment — where the admin MCP is actually served.
const ADMIN_ENV = '9e2f2f0c-f9fa-46da-b6f0-7eda4d3ccca2';
// The environment whose data the demo administers. NOT what belongs in the URL.
const RESOURCE_ENV = '01d89b06-66d5-430e-9f28-65636843788b';
const MCP_URL = `https://mcp.pingone.com/admin/${ADMIN_ENV}/mcp`;
const iss = (env) => `https://auth.pingone.com/${env}/as`;

function jwt(claims) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256', kid: 'k' })}.${part(claims)}.sig`;
}

function httpErr(status, data) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  return err;
}

describe('a 401 from the hosted MCP names which 401 it is', () => {
  const saved = {};

  beforeEach(() => {
    saved.env = process.env.PINGONE_ENVIRONMENT_ID;
    saved.mcpEnv = process.env.PINGONE_MCP_ENVIRONMENT_ID;
    saved.region = process.env.PINGONE_REGION;
    process.env.PINGONE_ENVIRONMENT_ID = RESOURCE_ENV;
    process.env.PINGONE_MCP_ENVIRONMENT_ID = ADMIN_ENV;
    process.env.PINGONE_REGION = 'com';
    axios.post.mockReset();
  });

  afterEach(() => {
    const pairs = [
      ['PINGONE_ENVIRONMENT_ID', saved.env],
      ['PINGONE_MCP_ENVIRONMENT_ID', saved.mcpEnv],
      ['PINGONE_REGION', saved.region],
    ];
    for (const [k, v] of pairs) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('the URL is built from the ADMIN env, not the environment being administered', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));

    await expect(adapter.listTools(jwt({ iss: iss(ADMIN_ENV) }))).rejects.toThrow();
    expect(axios.post).toHaveBeenCalledWith(MCP_URL, expect.anything(), expect.anything());
  });

  test('a token from the resource env names both environments and the var to set', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));
    const token = jwt({ iss: iss(RESOURCE_ENV), aud: ['https://api.pingone.com'] });

    await expect(adapter.listTools(token)).rejects.toThrow(new RegExp(`issued by environment ${RESOURCE_ENV}`));
    await expect(adapter.listTools(token)).rejects.toThrow(new RegExp(`endpoint belongs to ${ADMIN_ENV}`));
    await expect(adapter.listTools(token)).rejects.toThrow(/PINGONE_MCP_ENVIRONMENT_ID/);
    // The wrong answer this replaced must not come back.
    await expect(adapter.listTools(token)).rejects.not.toThrow(/enablement/);
    // The underlying error must survive — a diagnosis explains, never replaces.
    await expect(adapter.listTools(token)).rejects.toThrow(/PingOne MCP HTTP 401/);
  });

  test('a token from the admin env points at permissions instead of the environment', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));
    const token = jwt({ iss: iss(ADMIN_ENV) });

    await expect(adapter.listTools(token)).rejects.toThrow(/matches this endpoint/);
    await expect(adapter.listTools(token)).rejects.toThrow(/admin roles/);
    await expect(adapter.listTools(token)).rejects.not.toThrow(/PINGONE_MCP_ENVIRONMENT_ID/);
  });

  test('without the admin var it falls back to the resource env, as before', async () => {
    delete process.env.PINGONE_MCP_ENVIRONMENT_ID;
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));

    await expect(adapter.listTools(jwt({ iss: iss(RESOURCE_ENV) }))).rejects.toThrow();
    expect(axios.post).toHaveBeenCalledWith(
      `https://mcp.pingone.com/admin/${RESOURCE_ENV}/mcp`,
      expect.anything(),
      expect.anything(),
    );
  });

  // Agreeing on the wrong environment is not the same as being right. The
  // fallback makes issuer and endpoint match, and reporting that as "matches,
  // so it must be permissions" is the same wrong turn that cost days before.
  test('an UNSET admin var is named, not reported as a permissions problem', async () => {
    delete process.env.PINGONE_MCP_ENVIRONMENT_ID;
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));
    const token = jwt({ iss: iss(RESOURCE_ENV) });

    await expect(adapter.listTools(token)).rejects.toThrow(/PINGONE_MCP_ENVIRONMENT_ID is not set/);
    await expect(adapter.listTools(token)).rejects.toThrow(/ADMINISTRATORS/);
    await expect(adapter.listTools(token)).rejects.not.toThrow(/permissions or client problem/);
    await expect(adapter.listTools(token)).rejects.toThrow(/PingOne MCP HTTP 401/);
  });

  test('with the admin var SET, a matching issuer is still a permissions problem', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));
    const token = jwt({ iss: iss(ADMIN_ENV) });

    await expect(adapter.listTools(token)).rejects.toThrow(/permissions or client problem/);
    await expect(adapter.listTools(token)).rejects.not.toThrow(/is not set/);
  });

  test('a non-JWT credential is reported as such rather than crashing the handler', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));

    await expect(adapter.listTools('opaque-token')).rejects.toThrow(/not a JWT/);
  });

  test('a non-401 error is left exactly as it was', async () => {
    axios.post.mockRejectedValue(httpErr(503, 'upstream down'));
    const token = jwt({ iss: iss(RESOURCE_ENV) });

    await expect(adapter.listTools(token)).rejects.toThrow(/PingOne MCP HTTP 503/);
    await expect(adapter.listTools(token)).rejects.not.toThrow(/issued by environment/);
  });
});
