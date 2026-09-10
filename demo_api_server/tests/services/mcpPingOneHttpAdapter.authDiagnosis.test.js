'use strict';

// "PingOne MCP HTTP 401: Invalid authentication" is the same string for every
// rejection, so the error alone never says what to change.
//
// THE RULE, established by measurement 2026-09-10: the hosted MCP accepts a
// token only when it was minted for PingOne's OWN built-in client
// `pingone-mcp-server`, and only against the endpoint for the SAME environment
// that issued it. Two tokens identical in aud, scope, sub, env, org, iss and
// acr — differing only in client_id — behave differently: an app we register
// 401s, the built-in one returns 78 tools.
//
// These tests exist to keep two earlier WRONG conclusions from coming back:
//   1. "the tenant lacks Remote MCP enablement";
//   2. "the admin MCP is served from the organisation's Administrators
//      environment, not the one being administered".
// Both were drawn from real measurements plus a wrong assumption, and (2)
// survived a whole PR because one environment was only ever tested with the
// built-in client and the other only with our own app.

const axios = require('axios');

jest.mock('axios');
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));

const adapter = require('../../services/mcpPingOneHttpAdapter');

const ENV = '01d89b06-66d5-430e-9f28-65636843788b';
const OTHER_ENV = '9e2f2f0c-f9fa-46da-b6f0-7eda4d3ccca2';
const BUILTIN = 'pingone-mcp-server';
const MCP_URL = `https://mcp.pingone.com/admin/${ENV}/mcp`;
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
    saved.region = process.env.PINGONE_REGION;
    process.env.PINGONE_ENVIRONMENT_ID = ENV;
    process.env.PINGONE_REGION = 'com';
  });

  afterEach(() => {
    for (const [k, v] of [['PINGONE_ENVIRONMENT_ID', saved.env], ['PINGONE_REGION', saved.region]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('the URL is the environment being administered — no separate admin-env variable', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));

    await expect(adapter.listTools(jwt({ iss: iss(ENV), client_id: BUILTIN }))).rejects.toThrow();
    expect(axios.post).toHaveBeenCalledWith(MCP_URL, expect.anything(), expect.anything());
  });

  test('a token from a client that is not the built-in one says exactly that', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));
    const token = jwt({ iss: iss(ENV), client_id: '2be907e4-4af7-432f-928b-eab0fda2d407', aud: ['https://api.pingone.com'], scope: 'openid' });

    await expect(adapter.listTools(token)).rejects.toThrow(/minted for client 2be907e4/);
    await expect(adapter.listTools(token)).rejects.toThrow(new RegExp(BUILTIN));
    // The three answers that cost days and are all wrong.
    await expect(adapter.listTools(token)).rejects.toThrow(/Roles, scopes, audience and app type are NOT the/);
    await expect(adapter.listTools(token)).rejects.not.toThrow(/enablement/);
    // The underlying error must survive — a diagnosis explains, never replaces.
    await expect(adapter.listTools(token)).rejects.toThrow(/PingOne MCP HTTP 401/);
  });

  test('the built-in client against another environment names the mismatch', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));
    const token = jwt({ iss: iss(OTHER_ENV), client_id: BUILTIN });

    await expect(adapter.listTools(token)).rejects.toThrow(new RegExp(`issued by environment ${OTHER_ENV}`));
    await expect(adapter.listTools(token)).rejects.toThrow(new RegExp(`endpoint is ${ENV}`));
    await expect(adapter.listTools(token)).rejects.not.toThrow(/minted for client/);
  });

  test('right client and right environment is the only case that points at roles', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));
    const token = jwt({ iss: iss(ENV), client_id: BUILTIN });

    await expect(adapter.listTools(token)).rejects.toThrow(/permissions problem/);
    await expect(adapter.listTools(token)).rejects.toThrow(/admin roles/);
  });

  test('a non-JWT credential is reported as such rather than crashing the handler', async () => {
    axios.post.mockRejectedValue(httpErr(401, 'Invalid authentication'));

    await expect(adapter.listTools('opaque-token')).rejects.toThrow(/not a JWT/);
  });

  test('a non-401 error is left exactly as it was', async () => {
    axios.post.mockRejectedValue(httpErr(503, 'upstream down'));
    const token = jwt({ iss: iss(ENV), client_id: BUILTIN });

    await expect(adapter.listTools(token)).rejects.toThrow(/PingOne MCP HTTP 503/);
    await expect(adapter.listTools(token)).rejects.not.toThrow(/minted for client/);
  });
});
