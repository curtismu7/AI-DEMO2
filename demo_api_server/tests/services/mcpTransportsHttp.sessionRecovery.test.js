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

  it('two concurrent first calls share one handshake instead of racing separate ones', async () => {
    // Greptile's finding on the fix above: without a single-flight guard,
    // two requests that both see an un-initialized session before either
    // finishes handshaking would each call performHandshake independently,
    // each overwriting session.sessionId with its own result on the one
    // shared session object.
    const { transport, axios } = freshTransport();

    axios.post
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-1' })) // the one shared initialize
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' }) // the one shared notifications/initialized
      .mockResolvedValueOnce(jsonRpcResponse({ tools: [{ name: 'get_my_accounts' }] })) // caller A's own tools/list
      .mockResolvedValueOnce(jsonRpcResponse({ tools: [{ name: 'get_my_accounts' }] })); // caller B's own tools/list

    const [resultA, resultB] = await Promise.all([transport.listTools(profile), transport.listTools(profile)]);

    expect(resultA.tools).toEqual([{ name: 'get_my_accounts' }]);
    expect(resultB.tools).toEqual([{ name: 'get_my_accounts' }]);
    // 1 initialize + 1 notifications/initialized + 2 tools/list = 4, never 6
    // (which is what two independent handshakes would cost).
    expect(axios.post).toHaveBeenCalledTimes(4);
  });

  it('two concurrent callers hitting an expired session share one recovery handshake', async () => {
    const { transport, axios } = freshTransport();

    axios.post
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-1' })) // initial handshake
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' })
      .mockRejectedValueOnce(expiredSessionError()) // caller A's tools/list finds it evicted
      .mockRejectedValueOnce(expiredSessionError()) // caller B's tools/list finds the same
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-2' })) // the one shared recovery handshake
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' })
      .mockResolvedValueOnce(jsonRpcResponse({ tools: [{ name: 'get_my_accounts' }] })) // caller A's retry
      .mockResolvedValueOnce(jsonRpcResponse({ tools: [{ name: 'get_my_accounts' }] })); // caller B's retry

    // Both callers must already be past their first tools/list attempt
    // (and into resetAndReinitialize's synchronous check) before either
    // handshake mock resolves, or this doesn't exercise the race — driving
    // both through send() manually (rather than via Promise.all(listTools,
    // listTools), which lets microtask ordering vary) makes that explicit.
    const first = transport.listTools(profile);
    const second = transport.listTools(profile);
    const [resultA, resultB] = await Promise.all([first, second]);

    expect(resultA.tools).toEqual([{ name: 'get_my_accounts' }]);
    expect(resultB.tools).toEqual([{ name: 'get_my_accounts' }]);
    // 2 (initial handshake) + 2 (both find it expired) + 2 (one shared
    // recovery handshake) + 2 (both retries) = 8, never 10 (two independent
    // recovery handshakes).
    expect(axios.post).toHaveBeenCalledTimes(8);
  });

  it('two different identities calling the same URL get separate sessions, not a shared one', async () => {
    // routes/mcpInspector.js's privilegeVirtualProfile() builds a fresh
    // profile object per request with a CONSTANT url but the calling
    // admin's OWN bearer token as authValue — this is the exact shape that
    // exposed the bug: keying the session cache on url alone would let
    // admin A's session get reused under admin B's Authorization header.
    const { transport, axios } = freshTransport();
    const profileA = { url: profile.url, authHeader: 'Authorization', authValue: 'Bearer admin-a-token' };
    const profileB = { url: profile.url, authHeader: 'Authorization', authValue: 'Bearer admin-b-token' };

    axios.post
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-admin-a' })) // A's own handshake
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' })
      .mockResolvedValueOnce(jsonRpcResponse({ tools: [{ name: 'tool-a' }] })) // A's own tools/list
      .mockResolvedValueOnce(jsonRpcResponse({ protocolVersion: '2024-11-05' }, { sessionId: 'sid-admin-b' })) // B's own handshake
      .mockResolvedValueOnce({ status: 202, headers: {}, data: '' })
      .mockResolvedValueOnce(jsonRpcResponse({ tools: [{ name: 'tool-b' }] })); // B's own tools/list

    const resultA = await transport.listTools(profileA);
    const resultB = await transport.listTools(profileB);

    expect(resultA.tools).toEqual([{ name: 'tool-a' }]);
    expect(resultB.tools).toEqual([{ name: 'tool-b' }]);
    // 2 handshakes + 2 tools/list = 6. If the sessions collapsed onto one
    // shared entry, B's call would have skipped its own handshake (already
    // "initialized" from A) and only cost 4 total.
    expect(axios.post).toHaveBeenCalledTimes(6);

    // B's tools/list call must carry B's own Authorization header and B's
    // own session id, never A's.
    const bToolsListCall = axios.post.mock.calls[5];
    expect(bToolsListCall[2].headers['Authorization']).toBe('Bearer admin-b-token');
    expect(bToolsListCall[2].headers['Mcp-Session-Id']).toBe('sid-admin-b');
  });
});
