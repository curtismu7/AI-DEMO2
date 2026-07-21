'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((k) => null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

test('a 503 gateway_misconfigured response surfaces its real message, not a generic "Gateway upstream error"', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 503,
    headers: {},
    data: {
      error: 'gateway_misconfigured',
      message: 'The security gateway could not validate this token (introspection unavailable). This is a gateway configuration/connectivity issue, not a problem with your credentials.',
    },
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'get_my_accounts', {}, {})
  ).rejects.toMatchObject({
    code: 'gateway_misconfigured',
    message: expect.stringContaining('introspection unavailable'),
  });
});

test('a genuine unrelated 503 (no gateway_misconfigured marker) keeps the existing generic behavior', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 503,
    headers: {},
    data: {},
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'get_my_accounts', {}, {})
  ).rejects.toMatchObject({
    code: 'gateway_upstream_error',
  });
});

test('a 502 backend-exchange failure attaches gwAuditTrail so the token chain can show the denial (mirrors the 401/403 branches)', async () => {
  const gwAuditTrail = {
    introspection: { active: true, sub: 'u1' },
    authorize: { decision: 'PERMIT' },
    backend: { target: 'jwtverifier', audience: null, exchanged: false, error: 'invalid_scope' },
  };
  axios.post = jest.fn().mockResolvedValue({
    status: 502,
    headers: { 'x-gw-audit-trail': JSON.stringify(gwAuditTrail) },
    data: {},
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'get_my_accounts', {}, {})
  ).rejects.toMatchObject({
    code: 'gateway_upstream_error',
    httpStatus: 502,
    gwAuditTrail,
  });
});
