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
