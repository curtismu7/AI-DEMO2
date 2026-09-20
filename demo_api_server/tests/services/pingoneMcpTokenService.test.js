'use strict';

const mockPost = jest.fn();
jest.mock('axios', () => ({ post: (...args) => mockPost(...args) }));

const { refreshAccessToken } = require('../../services/pingoneMcpTokenService');

describe('pingoneMcpTokenService', () => {
  beforeEach(() => mockPost.mockReset());

  test('redeems a refresh token without a client secret and returns the rotated token', async () => {
    mockPost.mockResolvedValue({ data: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 1800 } });

    const result = await refreshAccessToken({
      refreshToken: 'refresh-1',
      clientId: 'pingone-mcp-server',
      tokenEndpoint: 'https://auth.pingone.com/env/as/token',
    });

    const [endpoint, body, config] = mockPost.mock.calls[0];
    expect(endpoint).toBe('https://auth.pingone.com/env/as/token');
    expect(new URLSearchParams(body)).toEqual(new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: 'pingone-mcp-server',
    }));
    expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(result).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });
});
