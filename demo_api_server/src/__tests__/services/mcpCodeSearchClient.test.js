/**
 * MCPCodeSearchClient error-contract tests: routes switch on err.status, so
 * the client must set 503 both for an explicit 503 response AND for
 * network-level failures (ECONNREFUSED / timeout — no response at all).
 */

'use strict';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('axios', () => ({
  create: jest.fn(() => ({ get: mockGet, post: mockPost })),
}));

const MCPCodeSearchClient = require('../../services/mcpCodeSearchClient');

function axiosError(message, response) {
  return Object.assign(new Error(message), { isAxiosError: true, response });
}

describe('MCPCodeSearchClient error contract', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  test('network failure (no response) maps to status 503 + unavailable message', async () => {
    mockGet.mockRejectedValueOnce(axiosError('connect ECONNREFUSED 127.0.0.1:8095'));

    const client = new MCPCodeSearchClient();
    await expect(client.listCodebases()).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('MCP server unavailable'),
    });
  });

  test('explicit 503 response maps to status 503', async () => {
    mockPost.mockRejectedValueOnce(
      axiosError('Request failed with status code 503', { status: 503 })
    );

    const client = new MCPCodeSearchClient();
    await expect(client.search({ query: 'q', codebase_id: 'cb' })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('MCP server unavailable'),
    });
  });

  test('other HTTP errors map to status 500 with the op label', async () => {
    mockPost.mockRejectedValueOnce(
      axiosError('Request failed with status code 400', { status: 400 })
    );

    const client = new MCPCodeSearchClient();
    await expect(
      client.index({ files: [], codebase_id: 'cb', codebase_name: 'demo' })
    ).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining('Failed to index codebase'),
    });
  });
});
