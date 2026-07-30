'use strict';

// Unit test for mcpWebSocketClient.getMcpServerUrl() resolution precedence.
//
// Same env-first contract as getMcpGatewayHttpUrl (see mcpGatewayResolver.test.js):
// process.env.MCP_SERVER_URL must win over configStore.getEffective('mcp_server_url').
// The boot-time env->LMDB seed is async, so resolving via getEffective alone can
// return the committed 'ws://localhost:8080' default during the cold-start window
// and dial the wrong host (in-cluster the value is ws://mcp-server:8080). This guards
// the last instance of the cold-start URL race that hit getMcpGatewayHttpUrl.

const mockGetEffective = jest.fn();
jest.mock('../services/configStore', () => ({
  getEffective: (...args) => mockGetEffective(...args),
}));

const { getMcpServerUrl } = require('../services/mcpWebSocketClient');

describe('getMcpServerUrl resolution precedence', () => {
  const ORIG = process.env.MCP_SERVER_URL;
  const ORIG_MTLS = process.env.MCP_MTLS_ENABLED;

  beforeEach(() => {
    mockGetEffective.mockReset();
    delete process.env.MCP_SERVER_URL;
    delete process.env.MCP_MTLS_ENABLED;
  });

  afterAll(() => {
    if (ORIG === undefined) delete process.env.MCP_SERVER_URL;
    else process.env.MCP_SERVER_URL = ORIG;
    if (ORIG_MTLS === undefined) delete process.env.MCP_MTLS_ENABLED;
    else process.env.MCP_MTLS_ENABLED = ORIG_MTLS;
  });

  test('env var wins over configStore (prevents cold-start localhost race)', () => {
    process.env.MCP_SERVER_URL = 'ws://mcp-server:8080';
    // configStore still returning the committed loopback default mid-seed:
    mockGetEffective.mockReturnValue('ws://localhost:8080');

    expect(getMcpServerUrl()).toBe('ws://mcp-server:8080');
  });

  test('falls back to configStore when the env var is unset', () => {
    mockGetEffective.mockReturnValue('ws://mcp-server:8080');

    expect(getMcpServerUrl()).toBe('ws://mcp-server:8080');
    expect(mockGetEffective).toHaveBeenCalledWith('mcp_server_url');
  });

  test('falls back to the localhost default when neither env nor configStore provides a URL', () => {
    mockGetEffective.mockReturnValue(undefined);
    expect(getMcpServerUrl()).toBe('ws://localhost:8080');
  });

  // MCP_MTLS_ENABLED=true (compose default since #910) makes mcp-server serve
  // TLS on MCP_SERVER_PORT, so a ws:// URL lands in a TLS listener and the
  // server destroys the socket — "socket hang up", exactly the break #910 fixed
  // for scripts/health-check.js but not for this client. Scheme follows the flag.
  test('upgrades ws:// to wss:// when the MCP server serves mTLS', () => {
    process.env.MCP_MTLS_ENABLED = 'true';
    process.env.MCP_SERVER_URL = 'ws://mcp-server:8080';

    expect(getMcpServerUrl()).toBe('wss://mcp-server:8080');
  });

  test('leaves ws:// alone when mTLS is off (server serves plain HTTP)', () => {
    process.env.MCP_MTLS_ENABLED = 'false';
    process.env.MCP_SERVER_URL = 'ws://mcp-server:8080';

    expect(getMcpServerUrl()).toBe('ws://mcp-server:8080');
  });

  test('leaves an explicit wss:// URL untouched with mTLS on', () => {
    process.env.MCP_MTLS_ENABLED = 'true';
    process.env.MCP_SERVER_URL = 'wss://mcp-server:8080';

    expect(getMcpServerUrl()).toBe('wss://mcp-server:8080');
  });
});
