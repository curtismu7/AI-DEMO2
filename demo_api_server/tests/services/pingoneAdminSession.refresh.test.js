'use strict';

const mockRefreshAccessToken = jest.fn();
jest.mock('../../services/pingoneMcpTokenService', () => ({ refreshAccessToken: mockRefreshAccessToken }));

describe('pingoneAdminSession refresh', () => {
  let session;
  const previousSharedSessionFlag = process.env.MCP_FACADE_PINGONE_ADMIN_SHARED_SESSION;

  beforeEach(() => {
    process.env.MCP_FACADE_PINGONE_ADMIN_SHARED_SESSION = 'true';
    jest.resetModules();
    mockRefreshAccessToken.mockReset();
    session = require('../../services/pingoneAdminSession');
    session.clear();
  });

  afterAll(() => {
    if (previousSharedSessionFlag === undefined) delete process.env.MCP_FACADE_PINGONE_ADMIN_SHARED_SESSION;
    else process.env.MCP_FACADE_PINGONE_ADMIN_SHARED_SESSION = previousSharedSessionFlag;
  });

  test('refreshes an expired hosted MCP access token and keeps the rotated refresh token', async () => {
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      expiresAt: Date.now() + 3600_000,
    });
    session.remember({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      clientId: 'pingone-mcp-server',
      tokenEndpoint: 'https://auth.pingone.com/env/as/token',
      expiresAt: Date.now() - 1,
    });

    await expect(session.getFreshAccessToken()).resolves.toBe('access-token-2');
    expect(mockRefreshAccessToken).toHaveBeenCalledWith({
      refreshToken: 'refresh-token-1',
      clientId: 'pingone-mcp-server',
      tokenEndpoint: 'https://auth.pingone.com/env/as/token',
    });
    expect(session.getAccessToken()).toBe('access-token-2');
  });

  test('coalesces concurrent refreshes so token rotation is used only once', async () => {
    let resolveRefresh;
    mockRefreshAccessToken.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));
    session.remember({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      clientId: 'pingone-mcp-server',
      tokenEndpoint: 'https://auth.pingone.com/env/as/token',
      expiresAt: Date.now() - 1,
    });

    const first = session.getFreshAccessToken();
    const second = session.getFreshAccessToken();
    resolveRefresh({
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      expiresAt: Date.now() + 3600_000,
    });

    await expect(Promise.all([first, second])).resolves.toEqual(['access-token-2', 'access-token-2']);
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });
});
