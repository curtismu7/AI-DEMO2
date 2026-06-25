'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((k) => null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

beforeEach(() => {
  axios.post = jest.fn().mockResolvedValue({
    status: 200,
    headers: {},
    data: { jsonrpc: '2.0', id: '1', result: { content: [{ text: '{}' }] } },
  });
});

test('attaches X-Intent-Token header when opts.intentToken is set', async () => {
  await callToolViaGateway(
    'https://api.ping.demo:3005',
    'bearer-tok',
    'get_my_accounts',
    {},
    { intentToken: 'header.payload.sig' },
  );
  const headers = axios.post.mock.calls[0][2].headers;
  expect(headers['X-Intent-Token']).toBe('header.payload.sig');
});

test('omits X-Intent-Token header when opts.intentToken is absent', async () => {
  await callToolViaGateway(
    'https://api.ping.demo:3005',
    'bearer-tok',
    'get_my_accounts',
    {},
    {},
  );
  const headers = axios.post.mock.calls[0][2].headers;
  expect(headers['X-Intent-Token']).toBeUndefined();
});
