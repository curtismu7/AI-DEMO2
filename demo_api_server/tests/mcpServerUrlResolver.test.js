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

  beforeEach(() => {
    mockGetEffective.mockReset();
    delete process.env.MCP_SERVER_URL;
  });

  afterAll(() => {
    if (ORIG === undefined) delete process.env.MCP_SERVER_URL;
    else process.env.MCP_SERVER_URL = ORIG;
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
});
