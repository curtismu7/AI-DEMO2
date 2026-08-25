'use strict';

jest.mock('axios');

// Fresh module instances per test — http.js keeps a module-level `_sessions`
// Map keyed by profile.url, so a stale session from one test would otherwise
// leak into the next. jest.resetModules() means the axios instance http.js
// sees internally is a NEW mock each time too, so re-require it here rather
// than reuse a require captured at file load — a mismatched reference is
// what made every axios.post call resolve to undefined the first time this
// was written.
function freshTransport() {
  jest.resetModules();
  const axios = require('axios');
  const transport = require('../../services/mcpTransports/http');
  return { transport, axios };
}

function jsonRpcResponse(result, { sessionId } = {}) {
  return {
    status: 200,
    headers: sessionId ? { 'mcp-session-id': sessionId } : {},
    data: JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
  };
}

function expiredSessionError() {
  const err = new Error('MCP HTTP 404: Unknown or expired MCP-Session-Id; send a new initialize request');
  err.code = 'mcp_http_error';
  err.httpStatus = 404;
  err.response = { status: 404, data: { error: 'Unknown or expired MCP-Session-Id; send a new initialize request' } };
  return err;
}

describe('mcpTransports/http session recovery', () => {
  const profile = { url: 'https://example.test/mcp' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resets and re-initializes once on a 404 expired-session error, then succeeds', async () => {
    const { transport, axios } = freshTransport();

    axios.post
      // initial handshake
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-1' }))
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' }) // notifications/initialized
      // first tools/list — server has evicted sid-1
      .mockRejectedValueOnce(expiredSessionError())
      // recovery handshake
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-2' }))
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' })
      // retried tools/list succeeds
      .mockResolvedValueOnce(jsonRpcResponse({ tools: [{ name: 'get_my_accounts' }] }));

    const result = await transport.listTools(profile);

    expect(result.tools).toEqual([{ name: 'get_my_accounts' }]);
    expect(axios.post).toHaveBeenCalledTimes(6);
    // The retried tools/list call must carry the NEW session id, not the evicted one.
    const lastCallHeaders = axios.post.mock.calls[5][2].headers;
    expect(lastCallHeaders['Mcp-Session-Id']).toBe('sid-2');
  });

  it('does not retry and propagates a non-404 error unchanged', async () => {
    const { transport, axios } = freshTransport();
    const authError = new Error('MCP HTTP 401: unauthorized');
    authError.code = 'mcp_http_error';
    authError.httpStatus = 401;

    axios.post
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-1' }))
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' })
      .mockRejectedValueOnce(authError);

    await expect(transport.listTools(profile)).rejects.toThrow('MCP HTTP 401: unauthorized');
    expect(axios.post).toHaveBeenCalledTimes(3); // no recovery handshake attempted
  });

  it('propagates the error if the retried call also gets a 404 (real, persistent failure)', async () => {
    const { transport, axios } = freshTransport();

    axios.post
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-1' }))
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' })
      .mockRejectedValueOnce(expiredSessionError())
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-2' }))
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' })
      .mockRejectedValueOnce(expiredSessionError());

    await expect(transport.listTools(profile)).rejects.toThrow('Unknown or expired MCP-Session-Id');
    expect(axios.post).toHaveBeenCalledTimes(6); // exactly one retry, not a loop
  });
});
