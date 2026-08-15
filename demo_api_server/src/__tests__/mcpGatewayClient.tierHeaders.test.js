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

test('sends X-User-Tier and tier definition headers when userGroups maps to a non-default tier', async () => {
  await callToolViaGateway(
    'https://api.ping.demo:3005',
    'bearer-tok',
    'get_my_accounts',
    {},
    { userGroups: ['Banking_PremiumTier'], vertical: 'banking' },
  );
  const headers = axios.post.mock.calls[0][2].headers;
  expect(headers['X-User-Tier']).toBe('PrivateBanking');
  expect(headers['X-Tier-Max-Amount-Usd']).toBeDefined();
});

test('sends X-User-Tier: Standard (the default) when userGroups is present but matches no mapping', async () => {
  await callToolViaGateway(
    'https://api.ping.demo:3005',
    'bearer-tok',
    'get_my_accounts',
    {},
    { userGroups: ['some_unrelated_group'], vertical: 'banking' },
  );
  const headers = axios.post.mock.calls[0][2].headers;
  expect(headers['X-User-Tier']).toBe('Standard');
});

test('omits tier headers when userGroups is not provided (no regression to existing callers)', async () => {
  await callToolViaGateway(
    'https://api.ping.demo:3005',
    'bearer-tok',
    'get_my_accounts',
    {},
    {},
  );
  const headers = axios.post.mock.calls[0][2].headers;
  expect(headers['X-User-Tier']).toBeUndefined();
  expect(headers['X-Tier-Max-Amount-Usd']).toBeUndefined();
  expect(headers['X-Tier-Restricted-Tools']).toBeUndefined();
});
