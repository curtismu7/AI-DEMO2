'use strict';

// The code-exchange half of the admin-environment flow. See
// mcpPingOneAdminAuth.adminEnv.test.js for why the admin env is the right one.
//
// Its own file on purpose: this suite needs axios.post to carry a resolved
// value into the route, and jest.config.js sets clearMocks:true. Sharing a file
// with the /login tests left the route holding an axios whose implementation
// had been cleared, so the token POST returned undefined and the assertion read
// "0 calls" — a red test over correct code. Verified: identical assertions pass
// when this suite runs alone.

process.env.PINGONE_MCP_ENVIRONMENT_ID = '9e2f2f0c-f9fa-46da-b6f0-7eda4d3ccca2';
process.env.PINGONE_MCP_ADMIN_CLIENT_ID = 'admin-env-client-id';
process.env.PINGONE_MCP_ADMIN_CLIENT_SECRET = 'admin-env-secret';
process.env.PUBLIC_APP_URL = 'https://local.ping-devops.com:4000';
process.env.PINGONE_REGION = 'com';

const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));
jest.mock('../../services/pingoneAdminSession', () => ({ remember: jest.fn(), getAccessToken: () => null }));

const ADMIN_ENV = process.env.PINGONE_MCP_ENVIRONMENT_ID;
const ADMIN_CLIENT = process.env.PINGONE_MCP_ADMIN_CLIENT_ID;
const ADMIN_SECRET = process.env.PINGONE_MCP_ADMIN_CLIENT_SECRET;

function buildApp() {
  const router = require('../../routes/mcpPingOneAdminAuth');
  const app = express();
  const sess = { user: { username: 'demoUser' } };
  app.use((req, _res, next) => {
    req.session = sess;
    req.session.save = (cb) => cb(null);
    next();
  });
  app.use('/api/mcp/inspector/pingone-admin', router);
  return app;
}

test('/callback redeems the code at the ADMIN token endpoint, with the configured secret', async () => {
  axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });

  const app = buildApp();
  const loginRes = await request(app).get('/api/mcp/inspector/pingone-admin/login').expect(302);
  const state = new URL(loginRes.headers.location).searchParams.get('state');

  const res = await request(app)
    .get(`/api/mcp/inspector/pingone-admin/callback?code=abc&state=${state}`)
    .expect(302);

  // A redirect carrying no error is the success path.
  expect(decodeURIComponent(res.headers.location)).not.toMatch(/pingone_admin_error/);

  expect(axios.post).toHaveBeenCalledTimes(1);
  const [endpoint, bodyStr] = axios.post.mock.calls[0];
  expect(endpoint).toBe(`https://auth.pingone.com/${ADMIN_ENV}/as/token`);

  // client_secret_BASIC, not post: measured against the live admin-env app, the
  // secret in the body is refused with "Unsupported authentication method".
  const [, , opts] = axios.post.mock.calls[0];
  const expected = 'Basic ' + Buffer.from(ADMIN_CLIENT + ':' + ADMIN_SECRET).toString('base64');
  expect(opts.headers.Authorization).toBe(expected);

  const body = new URLSearchParams(bodyStr);
  expect(body.get('client_id')).toBe(ADMIN_CLIENT);
  expect(body.get('client_secret')).toBeNull();
  expect(body.get('grant_type')).toBe('authorization_code');
  expect(body.get('code_verifier')).toBeTruthy();
  // `resource` is not sent on this path: PingOne ignores it, and carrying it is
  // what made the old flow look correct while minting a token for the wrong env.
  expect(body.get('resource')).toBeNull();
});
