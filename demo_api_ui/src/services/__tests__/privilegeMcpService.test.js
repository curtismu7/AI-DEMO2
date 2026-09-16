import { describe, test, expect, vi, beforeEach } from 'vitest';
import apiClient from '../apiClient';
import { callMcpToolViaPrivilege } from '../privilegeMcpService';

vi.mock('../apiClient', () => ({ default: { post: vi.fn() } }));

describe('callMcpToolViaPrivilege', () => {
  beforeEach(() => vi.clearAllMocks());

  test('posts name/arguments to the standalone Privilege MCP endpoint and unwraps the JSON-RPC envelope', async () => {
    const rawMcpResult = { content: [{ type: 'text', text: '{"balance":1200}' }], isError: false };
    apiClient.post.mockResolvedValue({ data: { jsonrpc: '2.0', id: 1, result: rawMcpResult } });

    const outcome = await callMcpToolViaPrivilege('get_my_accounts', { accountId: 'acc-1' });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/privilege-mcp-simple/tools/call',
      { name: 'get_my_accounts', arguments: { accountId: 'acc-1' } },
      { signal: undefined },
    );
    expect(outcome).toEqual({ result: rawMcpResult, tokenEvents: [] });
  });

  test('defaults params to an empty object when omitted, and threads an abort signal through when provided', async () => {
    const controller = new AbortController();
    apiClient.post.mockResolvedValue({
      data: { jsonrpc: '2.0', id: 2, result: { content: [], isError: false } },
    });

    await callMcpToolViaPrivilege('list_transactions', undefined, { signal: controller.signal });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/privilege-mcp-simple/tools/call',
      { name: 'list_transactions', arguments: {} },
      { signal: controller.signal },
    );
  });
});
