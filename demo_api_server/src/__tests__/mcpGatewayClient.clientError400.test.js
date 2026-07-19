'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((k) => null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

test('a 400 with a JSON-RPC error envelope surfaces the real message, not a generic "Gateway returned HTTP 400"', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 400,
    headers: {},
    data: {
      error: { code: -32602, message: 'Invalid params: missing required parameter account_id' },
    },
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'get_account_balance', {}, {})
  ).rejects.toMatchObject({
    code: 'gateway_client_error',
    httpStatus: 400,
    message: expect.stringContaining('account_id'),
  });
});

test('a 400 with a plain { message } body surfaces that message', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 400,
    headers: {},
    data: { message: 'Bad request: malformed tool arguments' },
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'get_account_balance', {}, {})
  ).rejects.toMatchObject({
    code: 'gateway_client_error',
    message: 'Bad request: malformed tool arguments',
  });
});

test('a 400 with no message body keeps the existing generic behavior', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 400,
    headers: {},
    data: {},
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'get_account_balance', {}, {})
  ).rejects.toMatchObject({
    code: 'gateway_client_error',
    httpStatus: 400,
    message: 'Gateway returned HTTP 400',
  });
});
