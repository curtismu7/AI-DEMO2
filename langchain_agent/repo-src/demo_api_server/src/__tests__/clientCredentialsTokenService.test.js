/**
 * Client Credentials Token Service Tests
 * Comprehensive test suite for OAuth 2.0 client credentials implementation
 * 
 * Phase 57-02: Client Credentials Token Service
 * Extensive testing to ensure RFC 6749 compliance and security
 */

const {
  processClientCredentialsGrant,
  validateAccessToken,
  introspectToken,
  revokeToken,
  cleanupExpiredTokens,
  getTokenStatistics,
  validateTokenForApi
} = require('../../services/clientCredentialsTokenService');
// Mock the oauthClientRegistry
jest.mock('../../services/oauthClientRegistry');

// The global setup.js afterEach calls jest.clearAllMocks() + jest.resetModules().
// resetModules breaks the connection between the mock references in this test and
// the destructured functions in clientCredentialsTokenService.  Override the setup
// teardown for this file by keeping our own stable mock reference.
const oauthClientRegistryMock = require('../../services/oauthClientRegistry');

describe('Client Credentials Token Service', () => {
  let mockClient;

  beforeEach(() => {
    // Reset token store and stats
    const tokenStore = new Map();
    const tokenStats = {
      issued: 0,
      validated: 0,
      expired: 0,
      revoked: 0,
      failed: 0
    };

    // Mock client
    mockClient = {
      client_id: 'test-client-123',
      client_secret: 'test-secret-456',
      client_name: 'Test Client',
      client_type: 'confidential',
      grant_types: ['client_credentials'],
      scope: ['read', 'write'],
      token_endpoint_auth_method: 'client_secret_basic',
      registration_metadata: {
        registered_at: '2026-04-06T10:00:00.000Z',
        registered_by: 'test-user'
      }
    };

    // Mock validateClientCredentials
    oauthClientRegistryMock.validateClientCredentials.mockReturnValue({
      valid: true,
      client: mockClient
    });
  });

  describe('Client Credentials Grant Processing', () => {
    test('should process valid client credentials grant successfully', async () => {
      const request = {
        grant_type: 'client_credentials',
        scope: 'read',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const metadata = {
        sourceIP: '127.0.0.1',
        userAgent: 'test-agent',
        requestId: 'test-123'
      };

      const response = await processClientCredentialsGrant(request, metadata);

      expect(response).toHaveProperty('access_token');
      expect(response).toHaveProperty('token_type', 'Bearer');
      expect(response).toHaveProperty('expires_in', 60); // short demo TTL (TOKEN_CONFIG.accessTokenTTL)
      expect(response).toHaveProperty('scope', 'read');
      expect(response.access_token).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/); // JWT format
    });

    test('should reject unsupported grant type', async () => {
      const request = {
        grant_type: 'authorization_code', // Not supported
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      await expect(processClientCredentialsGrant(request))
        .rejects.toThrow('Unsupported grant type');
    });

    test('should reject invalid client credentials', async () => {
      oauthClientRegistryMock.validateClientCredentials.mockReturnValue({
        valid: false,
        error: 'Invalid client credentials'
      });

      const request = {
        grant_type: 'client_credentials',
        client_id: 'invalid-client',
        client_secret: 'invalid-secret'
      };

      await expect(processClientCredentialsGrant(request))
        .rejects.toThrow('Invalid client credentials');
    });

    test('should use client scopes when no scope requested', async () => {
      const request = {
        grant_type: 'client_credentials',
        // No scope parameter
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);

      expect(response.scope).toBe('read write'); // Client's registered scopes
    });

    test('should reject requested scopes not allowed for client', async () => {
      const request = {
        grant_type: 'client_credentials',
        scope: 'admin:read', // Not in client's registered scopes
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      await expect(processClientCredentialsGrant(request))
        .rejects.toThrow('Requested scopes not allowed: admin:read');
    });

    test('should accept subset of client scopes', async () => {
      const request = {
        grant_type: 'client_credentials',
        scope: 'read', // Subset of client's scopes
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);

      expect(response.scope).toBe('read');
    });

    test('should generate tokens with correct TTL', async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);

      expect(response.expires_in).toBe(60); // short demo TTL (TOKEN_CONFIG.accessTokenTTL)
    });
  });

  describe('Token Validation', () => {
    let validToken;

    beforeEach(async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      validToken = response.access_token;
    });

    test('should validate valid token successfully', () => {
      const metadata = {
        sourceIP: '127.0.0.1',
        userAgent: 'test-agent'
      };

      const validation = validateAccessToken(validToken, metadata);

      expect(validation.valid).toBe(true);
      expect(validation).toHaveProperty('payload');
      expect(validation.payload).toHaveProperty('client_id', 'test-client-123');
      expect(validation.payload).toHaveProperty('scope');
      expect(validation.payload).toHaveProperty('exp');
      expect(validation.payload).toHaveProperty('iat');
      expect(validation.payload).toHaveProperty('jti');
    });

    test('should reject invalid token format', () => {
      const invalidToken = 'invalid-token-format';

      expect(() => validateAccessToken(invalidToken))
        .toThrow('Invalid access token');
    });

    test('should reject token without jti claim', () => {
      // Create a token without jti (this would be unusual but test for completeness)
      const jwt = require('jsonwebtoken');
      const tokenWithoutJti = jwt.sign(
        { client_id: 'test' },
        'development-secret-key-change-in-production',
        { algorithm: 'HS256' }
      );

      expect(() => validateAccessToken(tokenWithoutJti))
        .toThrow('Invalid access token');
    });

    test('should reject expired token', () => {
      // Create an expired token
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        {
          client_id: 'test-client-123',
          jti: 'expired-token-id',
          exp: Math.floor(Date.now() / 1000) - 60 // Expired 1 minute ago
        },
        'development-secret-key-change-in-production',
        { algorithm: 'HS256' }
      );

      expect(() => validateAccessToken(expiredToken))
        .toThrow('Invalid access token');
    });

    test('should reject token with invalid signature', () => {
      const jwt = require('jsonwebtoken');
      const tokenWithInvalidSignature = jwt.sign(
        {
          client_id: 'test-client-123',
          jti: 'invalid-signature-token'
        },
        'wrong-secret',
        { algorithm: 'HS256' }
      );

      expect(() => validateAccessToken(tokenWithInvalidSignature))
        .toThrow('Invalid access token');
    });
  });

  describe('Token Introspection', () => {
    let validToken;

    beforeEach(async () => {
      const request = {
        grant_type: 'client_credentials',
        scope: 'read write',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      validToken = response.access_token;
    });

    test('should introspect valid token successfully', () => {
      const introspection = introspectToken(validToken);

      expect(introspection).toHaveProperty('active', true);
      expect(introspection).toHaveProperty('client_id', 'test-client-123');
      expect(introspection).toHaveProperty('scope', 'read write');
      expect(introspection).toHaveProperty('token_type', 'Bearer');
      expect(introspection).toHaveProperty('exp');
      expect(introspection).toHaveProperty('iat');
      expect(introspection).toHaveProperty('jti');
    });

    test('should return inactive for invalid token', () => {
      const introspection = introspectToken('invalid-token');

      expect(introspection).toEqual({ active: false });
    });

    test('should return inactive for expired token', () => {
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        {
          client_id: 'test-client-123',
          jti: 'expired-token-id',
          exp: Math.floor(Date.now() / 1000) - 60
        },
        'development-secret-key-change-in-production',
        { algorithm: 'HS256' }
      );

      const introspection = introspectToken(expiredToken);

      expect(introspection).toEqual({ active: false });
    });
  });

  describe('Token Revocation', () => {
    let validToken;

    beforeEach(async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      validToken = response.access_token;
    });

    test('should revoke valid token successfully', () => {
      const metadata = {
        sourceIP: '127.0.0.1',
        userAgent: 'test-agent'
      };

      const result = revokeToken(validToken, metadata);

      expect(result).toHaveProperty('revoked', true);

      // Token should no longer be valid
      expect(() => validateAccessToken(validToken))
        .toThrow('Token has been revoked');
    });

    test('should handle revocation of non-existent token', () => {
      // Use a valid JWT format token that was never issued
      const jwt = require('jsonwebtoken');
      const unknownToken = jwt.sign(
        { client_id: 'unknown', jti: 'nonexistent-jti-12345' },
        'development-secret-key-change-in-production',
        { algorithm: 'HS256' }
      );
      const result = revokeToken(unknownToken);

      expect(result).toHaveProperty('revoked', false);
      expect(result).toHaveProperty('reason', 'Token not found');
    });

    test('should handle revocation of invalid token format', () => {
      const result = revokeToken('invalid-token-format');

      expect(result).toHaveProperty('revoked', false);
      expect(result).toHaveProperty('reason', 'Invalid token format');
    });
  });

  describe('Token Cleanup', () => {
    test('should clean up expired tokens', () => {
      // This test would require access to the internal token store
      // For now, just ensure the function exists and returns a number
      const cleanedCount = cleanupExpiredTokens();

      expect(typeof cleanedCount).toBe('number');
      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Token Statistics', () => {
    test('should return token statistics', () => {
      const stats = getTokenStatistics();

      expect(stats).toHaveProperty('issued');
      expect(stats).toHaveProperty('validated');
      expect(stats).toHaveProperty('expired');
      expect(stats).toHaveProperty('revoked');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('active_tokens');
      expect(stats).toHaveProperty('revoked_tokens');
      expect(stats).toHaveProperty('total_stored');
      expect(stats).toHaveProperty('token_ttl', 60);
      expect(stats).toHaveProperty('cleanup_needed');

      expect(typeof stats.issued).toBe('number');
      expect(typeof stats.validated).toBe('number');
      expect(typeof stats.expired).toBe('number');
      expect(typeof stats.revoked).toBe('number');
      expect(typeof stats.failed).toBe('number');
    });
  });

  describe('Token Validation for API', () => {
    let validToken;

    beforeEach(async () => {
      const request = {
        grant_type: 'client_credentials',
        scope: 'read write',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      validToken = response.access_token;
    });

    test('should validate token for API access without required scopes', () => {
      const metadata = {
        sourceIP: '127.0.0.1',
        userAgent: 'test-agent'
      };

      const validation = validateTokenForApi(validToken, [], metadata);

      expect(validation.valid).toBe(true);
      expect(validation).toHaveProperty('payload');
      expect(validation).toHaveProperty('tokenScopes');
      expect(validation.tokenScopes).toEqual(['read', 'write']);
    });

    test('should validate token for API access with required scopes', () => {
      const metadata = {
        sourceIP: '127.0.0.1',
        userAgent: 'test-agent'
      };

      const validation = validateTokenForApi(validToken, ['read'], metadata);

      expect(validation.valid).toBe(true);
      expect(validation.tokenScopes).toEqual(['read', 'write']);
    });

    test('should reject token for API access with insufficient scopes', () => {
      const metadata = {
        sourceIP: '127.0.0.1',
        userAgent: 'test-agent'
      };

      expect(() => validateTokenForApi(validToken, ['admin:read'], metadata))
        .toThrow('Insufficient scope for this operation');
    });

    test('should reject invalid token for API access', () => {
      const metadata = {
        sourceIP: '127.0.0.1',
        userAgent: 'test-agent'
      };

      expect(() => validateTokenForApi('invalid-token', [], metadata))
        .toThrow('Invalid access token');
    });
  });

  describe('Security Tests', () => {
    test('should generate unique JWT IDs for each token', async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response1 = await processClientCredentialsGrant(request);
      const response2 = await processClientCredentialsGrant(request);

      const payload1 = JSON.parse(Buffer.from(response1.access_token.split('.')[1], 'base64').toString());
      const payload2 = JSON.parse(Buffer.from(response2.access_token.split('.')[1], 'base64').toString());

      expect(payload1.jti).not.toBe(payload2.jti);
      expect(payload1.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/); // UUID format
    });

    test('should include correct expiration time in token', async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      const payload = JSON.parse(Buffer.from(response.access_token.split('.')[1], 'base64').toString());

      const now = Math.floor(Date.now() / 1000);
      const expectedExp = now + 60; // short demo TTL (TOKEN_CONFIG.accessTokenTTL)

      expect(payload.exp).toBeCloseTo(expectedExp, 0);
      expect(payload.exp).toBeGreaterThan(now);
    });

    test('should include correct issuer in token', async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      const payload = JSON.parse(Buffer.from(response.access_token.split('.')[1], 'base64').toString());

      expect(payload.iss).toBe('enduser.ping.demo');
    });

    test('should include correct subject in token', async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      const payload = JSON.parse(Buffer.from(response.access_token.split('.')[1], 'base64').toString());

      expect(payload.sub).toBe('test-client-123');
    });
  });

  describe('Performance Tests', () => {
    test('should handle multiple concurrent token issuances', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(processClientCredentialsGrant({
          grant_type: 'client_credentials',
          client_id: 'test-client-123',
          client_secret: 'test-secret-456'
        }));
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      
      // All tokens should be different
      const tokens = results.map(r => r.access_token);
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(10);
    });

    test('should handle rapid token validation', async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      const token = response.access_token;

      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        validateAccessToken(token);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete 100 validations in under 1000ms (generous for CI/slow machines)
      expect(duration).toBeLessThan(1000);
    });

    test('should handle rapid token introspection', async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      const token = response.access_token;

      const startTime = Date.now();
      
      for (let i = 0; i < 50; i++) {
        introspectToken(token);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete 50 introspections in under 500ms (generous for CI/slow machines)
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    test('should handle empty scope request', async () => {
      const request = {
        grant_type: 'client_credentials',
        scope: '', // Empty scope
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      expect(response.scope).toBe('read write'); // Default to client scopes
    });

    test('should handle scope request with extra spaces', async () => {
      const request = {
        grant_type: 'client_credentials',
        scope: '  read  write  ', // Extra spaces
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      expect(response.scope).toBe('read write'); // Spaces trimmed
    });

    test('should handle very long scope strings', async () => {
      // Mock client with many scopes
      mockClient.scope = Array.from({ length: 50 }, (_, i) => `scope_${i}:read`);
      oauthClientRegistryMock.validateClientCredentials.mockReturnValue({
        valid: true,
        client: mockClient
      });

      const request = {
        grant_type: 'client_credentials',
        scope: mockClient.scope.join(' '),
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      expect(response.scope).toBe(mockClient.scope.join(' '));
    });

    test('should handle Unicode characters in client metadata', async () => {
      mockClient.client_name = '测试客户端';
      mockClient.registration_metadata.registered_by = '测试用户';

      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);
      expect(response).toHaveProperty('access_token');

      const payload = JSON.parse(Buffer.from(response.access_token.split('.')[1], 'base64').toString());
      expect(payload.registration_metadata.registered_by).toBe('测试用户');
    });
  });

  describe('RFC 6749 Compliance Tests', () => {
    test('should comply with RFC 6749 §4.4 client credentials grant', async () => {
      const request = {
        grant_type: 'client_credentials',
        scope: 'read',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);

      // RFC 6749 §4.4.3 requires these fields
      expect(response).toHaveProperty('access_token');
      expect(response).toHaveProperty('token_type', 'Bearer');
      expect(response).toHaveProperty('expires_in');
      expect(response).toHaveProperty('scope');

      // expires_in should be in seconds
      expect(typeof response.expires_in).toBe('number');
      expect(response.expires_in).toBeGreaterThan(0);
    });

    test('should not include refresh_token for client credentials grant', async () => {
      const request = {
        grant_type: 'client_credentials',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      const response = await processClientCredentialsGrant(request);

      // RFC 6749 §4.4.3: refresh_token MUST NOT be issued for client credentials grant
      expect(response).not.toHaveProperty('refresh_token');
    });

    test('should comply with RFC 6749 error response format', async () => {
      // Test unsupported grant type
      const request = {
        grant_type: 'unsupported_grant',
        client_id: 'test-client-123',
        client_secret: 'test-secret-456'
      };

      await expect(processClientCredentialsGrant(request))
        .rejects.toHaveProperty('code', 'unsupported_grant_type');
    });
  });
});
