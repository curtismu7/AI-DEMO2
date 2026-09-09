'use strict';

// The token-endpoint auth method for the admin-environment client.
//
// Default is client_secret_BASIC. Measured against the live app: the secret in
// the POST body is refused with `401 invalid_client — Unsupported
// authentication method`, while the same credential in an Authorization: Basic
// header gets through to a later, different check. Basic is also the OAuth 2.0
// default for a confidential client. PINGONE_MCP_ADMIN_CLIENT_AUTH=post exists
// because this repo registers apps both ways and the wrong choice fails with
// that same opaque string.
//
// Its own file for the same reason as the callback suite: jest.config.js sets
// clearMocks:true, so a second test in a file that needs a resolved value from
// axios leaves the route holding a cleared mock.

process.env.PINGONE_MCP_ENVIRONMENT_ID = '9e2f2f0c-f9fa-46da-b6f0-7eda4d3ccca2';
process.env.PINGONE_MCP_ADMIN_CLIENT_ID = 'admin-env-client-id';
process.env.PINGONE_MCP_ADMIN_CLIENT_SECRET = 'admin-env-secret';
process.env.PINGONE_MCP_ADMIN_CLIENT_AUTH = 'post';
process.env.PUBLIC_APP_URL = 'https://local.ping-devops.com:4000';
process.env.PINGONE_REGION = 'com';

const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));
jest.mock('../../services/pingoneAdminSession', () => ({ remember: jest.fn(), getAccessToken: () => null }));

const ADMIN_SECRET = process.env.PINGONE_MCP_ADMIN_CLIENT_SECRET;

test('PINGONE_MCP_ADMIN_CLIENT_AUTH=post puts the secret in the body, not the header', async () => {
  axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });

  const router = require('../../routes/mcpPingOneAdminAuth');
  const app = express();
  const sess = { user: { username: 'demoUser' } };
  app.use((req, _res, next) => {
    req.session = sess;
    req.session.save = (cb) => cb(null);
    next();
  });
  app.use('/api/mcp/inspector/pingone-admin', router);

  const loginRes = await request(app).get('/api/mcp/inspector/pingone-admin/login').expect(302);
  const state = new URL(loginRes.headers.location).searchParams.get('state');

  await request(app)
    .get(`/api/mcp/inspector/pingone-admin/callback?code=abc&state=${state}`)
    .expect(302);

  const [, bodyStr, opts] = axios.post.mock.calls[0];
  expect(new URLSearchParams(bodyStr).get('client_secret')).toBe(ADMIN_SECRET);
  expect(opts.headers.Authorization).toBeUndefined();
});
