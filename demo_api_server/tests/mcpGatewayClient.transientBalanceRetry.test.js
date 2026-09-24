'use strict';

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../services/mcpGatewayClient');

function successResponse(result = { content: [{ type: 'text', text: 'balance' }] }) {
  return { status: 200, headers: {}, data: { jsonrpc: '2.0', id: 1, result } };
}

describe('mcpGatewayClient transient balance retry', () => {
  beforeEach(() => {
    axios.post.mockReset();
    axios.get.mockReset();
  });

  test('retries a transient gateway 502 for the read-only balance tool once', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 502, headers: {}, data: { error: 'upstream_error' } })
      .mockResolvedValueOnce(successResponse());

    const result = await callToolViaGateway('https://gw.example', 'token', 'get_account_balance', { account_id: 'acct-1' });

    expect(result.result).toEqual(successResponse().data.result);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('retries a transient gateway 502 for the airlines delegated-access read once', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 502, headers: {}, data: { error: 'upstream_error' } })
      .mockResolvedValueOnce(successResponse());

    const result = await callToolViaGateway('https://gw.example', 'token', 'get_airline_bookings', {});

    expect(result.result).toEqual(successResponse().data.result);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('retries a reset connection for the read-only balance tool once', async () => {
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce(successResponse());

    await expect(callToolViaGateway('https://gw.example', 'token', 'get_account_balance', { account_id: 'acct-1' }))
      .resolves.toMatchObject({ result: successResponse().data.result });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls.map(([url]) => url)).toEqual([
      'https://gw.example/mcp',
      'https://gw.example/mcp',
    ]);
  });

  test('retries a refused connection for the read-only balance tool once', async () => {
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }))
      .mockResolvedValueOnce(successResponse());

    await expect(callToolViaGateway('https://gw.example', 'token', 'get_account_balance', { account_id: 'acct-1' }))
      .resolves.toMatchObject({ result: successResponse().data.result });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('does not retry a write tool after a gateway 502', async () => {
    axios.post.mockResolvedValue({ status: 502, headers: {}, data: { error: 'upstream_error' } });

    await expect(callToolViaGateway('https://gw.example', 'token', 'create_transfer', {}))
      .rejects.toMatchObject({ code: 'gateway_upstream_error', httpStatus: 502 });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('does not retry a policy denial for the balance tool', async () => {
    axios.post.mockResolvedValue({ status: 403, headers: {}, data: { error: 'insufficient_scope' } });

    await expect(callToolViaGateway('https://gw.example', 'token', 'get_account_balance', {}))
      .rejects.toMatchObject({ code: 'gateway_policy_denied', httpStatus: 403 });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
