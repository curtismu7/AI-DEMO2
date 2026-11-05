'use strict';

// The hosted-MCP sign-in is a PingOne client talking to PingOne. It must not
// follow the demo's active sign-in provider: with PingFederate active, the PAR
// push went to PF and failed "401 Invalid client or client credentials".

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/configStore', () => ({
  getEffective: () => undefined,
  getOAuthProvider: () => 'pingfederate',
}));
jest.mock('../../services/pingoneAdminSession', () => ({ remember: jest.fn(), getAccessToken: () => null }));

describe('pingone-admin authorization server', () => {
  const SAVED = {};
  const ENV = { PINGONE_ENVIRONMENT_ID: '01d89b06-66d5-430e-9f28-65636843788b', PINGONE_REGION: 'com' };
  beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { SAVED[k] = process.env[k]; process.env[k] = v; } });
  afterAll(() => { for (const k of Object.keys(ENV)) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; } });

  test('PAR, authorize and token endpoints are PingOne\'s even while PingFederate is the active provider', () => {
    const { _test } = require('../../routes/mcpPingOneAdminAuth');
    const base = 'https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as';
    expect(_test.pingOneAs()).toEqual({ authorize: `${base}/authorize`, token: `${base}/token`, par: `${base}/par` });
  });
});
