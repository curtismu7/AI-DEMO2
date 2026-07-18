'use strict';
jest.mock('axios');
const axios = require('axios');
const { getAvailableTools } = require('../../services/agentGatewayClient');

describe('getAvailableTools — tools/list Token Chain step', () => {
  test('success response includes a tools-list buildTokenEvent-shaped step', async () => {
    axios.post.mockResolvedValueOnce({
      data: { result: { tools: [{ name: 'get_account_balance' }, { name: 'create_transfer' }] } },
    });
    const result = await getAvailableTools({}, 'cc-token-123');
    expect(result.tokenEvents).toHaveLength(1);
    const ev = result.tokenEvents[0];
    expect(ev.id).toBe('tools-list');
    expect(ev.status).toBe('success');
    expect(ev.label).toMatch(/tools\/list/i);
    expect(ev.toolCount).toBe(2);
    expect(ev.toolNames).toEqual(['get_account_balance', 'create_transfer']);
  });

  test('gateway JSON-RPC error response includes a tools-list-failed step', async () => {
    axios.post.mockResolvedValueOnce({
      data: { error: { code: 'gateway_error', message: 'boom' } },
    });
    try {
      await getAvailableTools({}, 'cc-token-123');
      throw new Error('expected getAvailableTools to reject');
    } catch (err) {
      if (err.message === 'expected getAvailableTools to reject') throw err;
      expect(err.tokenEvents[0].id).toBe('tools-list-failed');
      expect(err.tokenEvents[0].status).toBe('failed');
    }
  });

  test('gateway transport error response includes a tools-list-failed step', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    try {
      await getAvailableTools({}, 'cc-token-123');
      throw new Error('expected getAvailableTools to reject');
    } catch (err) {
      if (err.message === 'expected getAvailableTools to reject') throw err;
      expect(err.tokenEvents[0].id).toBe('tools-list-failed');
      expect(err.tokenEvents[0].status).toBe('failed');
    }
  });
});
