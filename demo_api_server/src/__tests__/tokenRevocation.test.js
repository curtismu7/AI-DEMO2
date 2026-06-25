/**
 * Tests for Token Revocation Service (RFC 7009)
 */

const axios = require('axios');
const { revokeToken, revokeTokens, revokeSessionTokens } = require('../../services/tokenRevocation');

jest.mock('axios');
jest.mock('../../utils/logger', () => {
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger: mockLogger, LOG_LEVELS: {}, LOG_CATEGORIES: {} };
});

describe('Token Revocation Service', () => {
  const mockClientId = 'test-client-id';
  const mockClientSecret = 'test-client-secret';
  const mockToken = 'mock-access-token';
  const mockRefreshToken = 'mock-refresh-token';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PINGONE_REVOCATION_ENDPOINT = 'https://auth.pingone.com/revoke';
  });

  afterEach(() => {
    delete process.env.PINGONE_REVOCATION_ENDPOINT;
  });

  describe('revokeToken', () => {
    it('should successfully revoke an access token', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const result = await revokeToken(mockToken, 'access_token', mockClientId, mockClientSecret);

      expect(result).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        'https://auth.pingone.com/revoke',
        expect.any(URLSearchParams),
        expect.objectContaining({
          auth: {
            username: mockClientId,
            password: mockClientSecret
          }
        })
      );
    });

    it('should successfully revoke a refresh token', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const result = await revokeToken(mockRefreshToken, 'refresh_token', mockClientId, mockClientSecret);

      expect(result).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        'https://auth.pingone.com/revoke',
        expect.any(URLSearchParams),
        expect.objectContaining({
          auth: {
            username: mockClientId,
            password: mockClientSecret
          }
        })
      );
    });

    it('should throw error if revocation endpoint not configured', async () => {
      delete process.env.PINGONE_REVOCATION_ENDPOINT;

      await expect(
        revokeToken(mockToken, 'access_token', mockClientId, mockClientSecret)
      ).rejects.toThrow('PINGONE_REVOCATION_ENDPOINT not configured');
    });

    it('should throw error if client credentials not provided', async () => {
      await expect(
        revokeToken(mockToken, 'access_token', null, null)
      ).rejects.toThrow('Client credentials required');
    });

    it('should handle revocation endpoint errors', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      await expect(
        revokeToken(mockToken, 'access_token', mockClientId, mockClientSecret)
      ).rejects.toThrow('Network error');
    });

    it('should return true even if server returns 200 with error (RFC 7009)', async () => {
      axios.post.mockRejectedValue({
        response: { status: 200, data: { error: 'invalid_token' } }
      });

      const result = await revokeToken(mockToken, 'access_token', mockClientId, mockClientSecret);
      expect(result).toBe(true);
    });
  });

  describe('revokeTokens', () => {
    it('should revoke both access and refresh tokens', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const result = await revokeTokens(mockToken, mockRefreshToken, mockClientId, mockClientSecret);

      expect(result.accessTokenRevoked).toBe(true);
      expect(result.refreshTokenRevoked).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should continue if access token revocation fails', async () => {
      axios.post
        .mockRejectedValueOnce(new Error('Access token error'))
        .mockResolvedValueOnce({ status: 200, data: {} });

      const result = await revokeTokens(mockToken, mockRefreshToken, mockClientId, mockClientSecret);

      expect(result.accessTokenRevoked).toBe(false);
      expect(result.refreshTokenRevoked).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('access_token');
    });

    it('should handle only access token', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const result = await revokeTokens(mockToken, null, mockClientId, mockClientSecret);

      expect(result.accessTokenRevoked).toBe(true);
      expect(result.refreshTokenRevoked).toBe(false);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should handle only refresh token', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const result = await revokeTokens(null, mockRefreshToken, mockClientId, mockClientSecret);

      expect(result.accessTokenRevoked).toBe(false);
      expect(result.refreshTokenRevoked).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('revokeSessionTokens', () => {
    it('should revoke tokens from session', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const mockSession = {
        accessToken: mockToken,
        refreshToken: mockRefreshToken
      };

      const result = await revokeSessionTokens(mockSession, mockClientId, mockClientSecret);

      expect(result.accessTokenRevoked).toBe(true);
      expect(result.refreshTokenRevoked).toBe(true);
    });

    it('should handle session with no tokens', async () => {
      const mockSession = {};

      const result = await revokeSessionTokens(mockSession, mockClientId, mockClientSecret);

      expect(result.accessTokenRevoked).toBe(false);
      expect(result.refreshTokenRevoked).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should handle session with oauthTokens structure', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const mockSession = {
        oauthTokens: {
          accessToken: mockToken,
          refreshToken: mockRefreshToken
        }
      };

      // Note: Current implementation doesn't support oauthTokens structure
      // This test documents the limitation
      const result = await revokeSessionTokens(mockSession, mockClientId, mockClientSecret);

      expect(result.accessTokenRevoked).toBe(false);
      expect(result.refreshTokenRevoked).toBe(false);
    });
  });
});
