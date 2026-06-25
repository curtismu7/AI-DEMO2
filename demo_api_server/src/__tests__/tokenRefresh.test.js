/**
 * Tests for Token Refresh Service
 */

const axios = require('axios');
const {
  refreshAccessToken,
  refreshSessionTokens,
  shouldRefreshToken,
  autoRefreshMiddleware,
  getTimeUntilExpiry
} = require('../../services/tokenRefresh');

jest.mock('axios');
jest.mock('../../utils/logger', () => {
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger: mockLogger, LOG_LEVELS: {}, LOG_CATEGORIES: {} };
});

describe('Token Refresh Service', () => {
  const mockClientId = 'test-client-id';
  const mockClientSecret = 'test-client-secret';
  const mockRefreshToken = 'mock-refresh-token';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/token';
  });

  afterEach(() => {
    delete process.env.PINGONE_TOKEN_ENDPOINT;
  });

  describe('refreshAccessToken', () => {
    it('should successfully refresh access token', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          id_token: 'new-id-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'openid profile'
        }
      };

      axios.post.mockResolvedValue(mockResponse);

      const result = await refreshAccessToken(mockRefreshToken, mockClientId, mockClientSecret);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.expiresIn).toBe(3600);
      expect(result.issuedAt).toBeDefined();
    });

    it('should use old refresh token if new one not provided (no rotation)', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-access-token',
          expires_in: 3600,
          token_type: 'Bearer'
        }
      };

      axios.post.mockResolvedValue(mockResponse);

      const result = await refreshAccessToken(mockRefreshToken, mockClientId, mockClientSecret);

      expect(result.refreshToken).toBe(mockRefreshToken);
    });

    it('should throw error if token endpoint not configured', async () => {
      delete process.env.PINGONE_TOKEN_ENDPOINT;

      await expect(
        refreshAccessToken(mockRefreshToken, mockClientId, mockClientSecret)
      ).rejects.toThrow('PINGONE_TOKEN_ENDPOINT not configured');
    });

    it('should throw error if refresh token not provided', async () => {
      await expect(
        refreshAccessToken(null, mockClientId, mockClientSecret)
      ).rejects.toThrow('Refresh token required');
    });

    it('should handle invalid_grant error', async () => {
      axios.post.mockRejectedValue({
        response: {
          status: 400,
          data: { error: 'invalid_grant' }
        }
      });

      await expect(
        refreshAccessToken(mockRefreshToken, mockClientId, mockClientSecret)
      ).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_EXPIRED',
        requiresReauth: true
      });
    });

    it('should handle invalid_token error', async () => {
      axios.post.mockRejectedValue({
        response: {
          status: 400,
          data: { error: 'invalid_token' }
        }
      });

      await expect(
        refreshAccessToken(mockRefreshToken, mockClientId, mockClientSecret)
      ).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_EXPIRED',
        requiresReauth: true
      });
    });

    it('should include scope if provided', async () => {
      axios.post.mockResolvedValue({
        data: {
          access_token: 'new-token',
          expires_in: 3600
        }
      });

      await refreshAccessToken(mockRefreshToken, mockClientId, mockClientSecret, 'openid profile');

      const callParams = axios.post.mock.calls[0][1];
      expect(callParams.get('scope')).toBe('openid profile');
    });
  });

  describe('refreshSessionTokens', () => {
    it('should refresh tokens and update session', async () => {
      const mockSession = {
        oauthTokens: {
          refreshToken: mockRefreshToken,
          accessToken: 'old-access-token'
        }
      };

      axios.post.mockResolvedValue({
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        }
      });

      const result = await refreshSessionTokens(mockSession, mockClientId, mockClientSecret);

      expect(mockSession.oauthTokens.accessToken).toBe('new-access-token');
      expect(mockSession.oauthTokens.refreshToken).toBe('new-refresh-token');
      expect(result.accessToken).toBe('new-access-token');
    });

    it('should handle session without oauthTokens structure', async () => {
      const mockSession = {
        refreshToken: mockRefreshToken,
        accessToken: 'old-access-token'
      };

      axios.post.mockResolvedValue({
        data: {
          access_token: 'new-access-token',
          expires_in: 3600
        }
      });

      await refreshSessionTokens(mockSession, mockClientId, mockClientSecret);

      expect(mockSession.accessToken).toBe('new-access-token');
    });

    it('should throw error if no refresh token in session', async () => {
      const mockSession = {};

      await expect(
        refreshSessionTokens(mockSession, mockClientId, mockClientSecret)
      ).rejects.toThrow('No refresh token in session');
    });
  });

  describe('shouldRefreshToken', () => {
    it('should return true if token expires within buffer time', () => {
      const session = {
        oauthTokens: {
          issuedAt: Date.now() - 240000, // 4 minutes ago
          expiresIn: 300 // 5 minutes
        }
      };

      const result = shouldRefreshToken(session, 300); // 5 minute buffer
      expect(result).toBe(true);
    });

    it('should return false if token has plenty of time left', () => {
      const session = {
        oauthTokens: {
          issuedAt: Date.now(),
          expiresIn: 3600 // 1 hour
        }
      };

      const result = shouldRefreshToken(session, 300); // 5 minute buffer
      expect(result).toBe(false);
    });

    it('should return false if no expiry info available', () => {
      const session = {
        oauthTokens: {}
      };

      const result = shouldRefreshToken(session);
      expect(result).toBe(false);
    });

    it('should handle session without oauthTokens structure', () => {
      const session = {
        issuedAt: Date.now() - 240000,
        expiresIn: 300
      };

      const result = shouldRefreshToken(session, 300);
      expect(result).toBe(true);
    });
  });

  describe('getTimeUntilExpiry', () => {
    it('should calculate time until expiry correctly', () => {
      const session = {
        oauthTokens: {
          issuedAt: Date.now() - 60000, // 1 minute ago
          expiresIn: 300 // 5 minutes total
        }
      };

      const timeLeft = getTimeUntilExpiry(session);
      expect(timeLeft).toBeGreaterThan(230);
      expect(timeLeft).toBeLessThan(250);
    });

    it('should return 0 if token already expired', () => {
      const session = {
        oauthTokens: {
          issuedAt: Date.now() - 400000, // 6.67 minutes ago
          expiresIn: 300 // 5 minutes
        }
      };

      const timeLeft = getTimeUntilExpiry(session);
      expect(timeLeft).toBe(0);
    });

    it('should return null if no expiry info', () => {
      const session = {
        oauthTokens: {}
      };

      const timeLeft = getTimeUntilExpiry(session);
      expect(timeLeft).toBeNull();
    });
  });

  describe('autoRefreshMiddleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        session: {
          oauthTokens: {
            refreshToken: mockRefreshToken,
            issuedAt: Date.now() - 240000, // 4 minutes ago
            expiresIn: 300 // 5 minutes
          }
        },
        path: '/api/test'
      };
      res = {};
      next = jest.fn();

      process.env.PINGONE_CLIENT_ID = mockClientId;
      process.env.PINGONE_CLIENT_SECRET = mockClientSecret;
    });

    afterEach(() => {
      delete process.env.PINGONE_CLIENT_ID;
      delete process.env.PINGONE_CLIENT_SECRET;
    });

    it('should refresh token if expiring soon', async () => {
      axios.post.mockResolvedValue({
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        }
      });

      await autoRefreshMiddleware(req, res, next);

      expect(req.session.oauthTokens.accessToken).toBe('new-access-token');
      expect(next).toHaveBeenCalled();
    });

    it('should skip refresh if token not expiring', async () => {
      req.session.oauthTokens.issuedAt = Date.now();
      req.session.oauthTokens.expiresIn = 3600;

      await autoRefreshMiddleware(req, res, next);

      expect(axios.post).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should skip if no session', async () => {
      req.session = null;

      await autoRefreshMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should destroy session if refresh token expired', async () => {
      axios.post.mockRejectedValue({
        code: 'REFRESH_TOKEN_EXPIRED',
        requiresReauth: true
      });

      req.session.destroy = jest.fn((cb) => cb());
      res.status = jest.fn().mockReturnThis();
      res.json = jest.fn();

      await autoRefreshMiddleware(req, res, next);

      expect(req.session.destroy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Session expired',
        requiresReauth: true
      });
    });

    it('should continue on non-critical errors', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      await autoRefreshMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
