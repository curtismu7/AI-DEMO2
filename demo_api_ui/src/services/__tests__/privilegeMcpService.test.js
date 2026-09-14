import { describe, test, expect, vi, beforeEach } from 'vitest';
import apiClient from '../apiClient';
import { callMcpToolViaPrivilege } from '../privilegeMcpService';

vi.mock('../apiClient', () => ({ default: { post: vi.fn() } }));

describe('callMcpToolViaPrivilege', () => {
  beforeEach(() => vi.clearAllMocks());

  test('posts name/arguments to the standalone Privilege MCP endpoint and wraps the raw result', async () => {
    const rawMcpResult = { content: [{ type: 'text', text: '{"balance":1200}' }], isError: false };
    apiClient.post.mockResolvedValue({ data: rawMcpResult });

    const outcome = await callMcpToolViaPrivilege('get_my_accounts', { accountId: 'acc-1' });

    expect(apiClient.post).toHaveBeenCalledWith('/api/privilege-mcp-simple/tools/call', {
      name: 'get_my_accounts',
      arguments: { accountId: 'acc-1' },
    });
    expect(outcome).toEqual({ result: rawMcpResult, tokenEvents: [] });
  });

  test('defaults params to an empty object when omitted', async () => {
    apiClient.post.mockResolvedValue({ data: { content: [], isError: false } });

    await callMcpToolViaPrivilege('list_transactions');

    expect(apiClient.post).toHaveBeenCalledWith('/api/privilege-mcp-simple/tools/call', {
      name: 'list_transactions',
      arguments: {},
    });
  });
});
