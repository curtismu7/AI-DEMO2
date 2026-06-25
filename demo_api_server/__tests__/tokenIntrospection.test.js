/**
 * Token Introspection Service Tests
 * Comprehensive test suite for validateToken and extractScopes
 * 
 * Phase 91-01: External client token validation
 * Tests cover: valid tokens, invalid tokens, scope extraction, caching, error handling
 */

'use strict';

const axios = require('axios');
const introspectionService = require('../services/tokenIntrospectionService');

// Mock axios
jest.mock('axios');

describe('Token Introspection Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    introspectionService.clearCache();
    
    // Set required environment variables
    process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://auth.pingone.com/v1/environments/test-env/oauth2/introspect';
    process.env.PINGONE_WORKER_CLIENT_ID = 'test-worker-client-id';
    process.env.PINGONE_WORKER_CLIENT_SECRET = 'test-worker-secret';
  });

  afterEach(() => {
    introspectionService.clearCache();
  });

  // ==================== Valid Token Cases ====================

  describe('Valid token cases', () => {
    test('should validate a valid token with scopes', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read write',
          client_id: 'external-claude-001',
          sub: 'agent-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          aud: 'banking-api',
          token_type: 'Bearer',
        },
      });

      const result = await introspectionService.validateToken('valid-token-jwt');

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(['read', 'write']);
      expect(result.client_id).toBe('external-claude-001');
      expect(result.sub).toBe('agent-123');
    });

    test('should handle single scope as string', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read',
          client_id: 'test-client',
          sub: 'user-456',
          exp: Math.floor(Date.now() / 1000) + 1800,
        },
      });

      const result = await introspectionService.validateToken('token-single-scope');

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(['read']);
    });

    test('should handle scopes with multiple spaces', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read  write   sensitive:read',
          client_id: 'test-client',
        },
      });

      const result = await introspectionService.validateToken('token-multi-space');

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(['read', 'write', 'sensitive:read']);
    });

    test('should handle token with empty scope field', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: '',
          client_id: 'test-client',
          sub: 'user-789',
        },
      });

      const result = await introspectionService.validateToken('token-no-scope');

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual([]);
    });

    test('should handle token with no scope field', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          client_id: 'test-client',
          sub: 'user-789',
        },
      });

      const result = await introspectionService.validateToken('token-no-scope-field');

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual([]);
    });
  });

  // ==================== Invalid Token Cases ====================

  describe('Invalid token cases', () => {
    test('should reject expired token', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: false,
          expired: true,
        },
      });

      const result = await introspectionService.validateToken('expired-token');

      expect(result.valid).toBe(false);
    });

    test('should reject malformed token', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: false,
          error: 'invalid_request',
        },
      });

      const result = await introspectionService.validateToken('malformed-token');

      expect(result.valid).toBe(false);
    });

    test('should reject token signed with wrong key', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: false,
          error: 'invalid_token',
        },
      });

      const result = await introspectionService.validateToken('wrong-key-token');

      expect(result.valid).toBe(false);
    });

    test('should reject missing token', async () => {
      const result = await introspectionService.validateToken(null);
      expect(result.valid).toBe(false);
    });

    test('should reject empty string token', async () => {
      const result = await introspectionService.validateToken('');
      expect(result.valid).toBe(false);
    });
  });

  // ==================== Caching Tests ====================

  describe('Token caching behavior', () => {
    test('should cache valid token result', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read',
          client_id: 'test-client',
        },
      });

      const token = 'token-to-cache';
      const result1 = await introspectionService.validateToken(token);
      const result2 = await introspectionService.validateToken(token);

      // Axios should have been called only once
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });

    test('should return same cached result on repeated calls', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read write',
          client_id: 'cached-client',
        },
      });

      const token = 'repeated-token';
      const result1 = await introspectionService.validateToken(token);
      const result2 = await introspectionService.validateToken(token);
      const result3 = await introspectionService.validateToken(token);

      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    test('should respect token expiration for caching', async () => {
      const expiresIn = 10; // 10 seconds from now
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read',
          exp: Math.floor(Date.now() / 1000) + expiresIn,
          client_id: 'expiring-client',
        },
      });

      const token = 'expiring-token';
      const result = await introspectionService.validateToken(token);

      expect(result.valid).toBe(true);
      expect(result.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + expiresIn);
    });

    test('should differentiate cache entries for different tokens', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read',
          client_id: 'test-client',
        },
      });

      await introspectionService.validateToken('token-1');
      await introspectionService.validateToken('token-2');
      await introspectionService.validateToken('token-1');

      // Should have called axios twice (once for each unique token)
      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== Error Handling Tests ====================

  describe('Error handling', () => {
    test('should handle PingOne unreachable', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      const result = await introspectionService.validateToken('network-error-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('token_introspection_failed');
    });

    test('should handle PingOne timeout', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.code = 'ECONNABORTED';
      axios.post.mockRejectedValue(timeoutError);

      const result = await introspectionService.validateToken('timeout-token');

      expect(result.valid).toBe(false);
    });

    test('should handle missing environment variables', async () => {
      delete process.env.PINGONE_INTROSPECTION_ENDPOINT;

      const result = await introspectionService.validateToken('env-missing-token');

      // Service should return invalid gracefully
      expect(result.valid).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();

      // Restore env var
      process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://auth.pingone.com/v1/environments/test-env/oauth2/introspect';
    });

    test('should handle malformed introspection response', async () => {
      axios.post.mockResolvedValue({
        data: null,
      });

      const result = await introspectionService.validateToken('malformed-response-token');

      // Should handle gracefully, return invalid
      expect(result.valid).toBe(false);
    });
  });

  // ==================== Scope Extraction Tests ====================

  describe('Extract Scopes function', () => {
    test('should extract scopes from space-separated string', () => {
      const response = { scope: 'read write sensitive:read' };
      const scopes = introspectionService.extractScopes(response);

      expect(scopes).toEqual(['read', 'write', 'sensitive:read']);
    });

    test('should extract scopes from array', () => {
      const response = { scope: ['read', 'write'] };
      const scopes = introspectionService.extractScopes(response);

      expect(scopes).toEqual(['read', 'write']);
    });

    test('should handle missing scope field', () => {
      const response = { client_id: 'test' };
      const scopes = introspectionService.extractScopes(response);

      expect(scopes).toEqual([]);
    });

    test('should handle null response', () => {
      const scopes = introspectionService.extractScopes(null);
      expect(scopes).toEqual([]);
    });

    test('should filter empty strings from scope array', () => {
      const response = { scope: ['read', '', 'write', ''] };
      const scopes = introspectionService.extractScopes(response);

      expect(scopes).toEqual(['read', 'write']);
    });
  });

  // ==================== Integration Tests ====================

  describe('Full introspection flow', () => {
    test('should complete full introspection flow successfully', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read write',
          client_id: 'external-client',
          sub: 'user-abc',
          exp: Math.floor(Date.now() / 1000) + 3600,
          aud: 'banking-api',
          token_type: 'Bearer',
          username: 'claude-agent',
        },
      });

      const result = await introspectionService.validateToken('full-flow-token');

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(['read', 'write']);
      expect(result.client_id).toBe('external-client');
      expect(result.sub).toBe('user-abc');
      expect(axios.post).toHaveBeenCalledWith(
        'https://auth.pingone.com/v1/environments/test-env/oauth2/introspect',
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 5000,
        })
      );
    });

    test('should handle concurrent token validations', async () => {
      axios.post.mockResolvedValue({
        data: {
          active: true,
          scope: 'read',
          client_id: 'test-client',
        },
      });

      const promises = [
        introspectionService.validateToken('token-1'),
        introspectionService.validateToken('token-2'),
        introspectionService.validateToken('token-3'),
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      expect(results.every(r => r.valid === true)).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(3);
    });
  });
});
