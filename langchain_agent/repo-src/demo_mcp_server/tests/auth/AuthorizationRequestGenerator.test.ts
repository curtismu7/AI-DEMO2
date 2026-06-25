/**
 * Unit tests for AuthorizationRequestGenerator
 */

import { AuthorizationRequestGenerator, AuthorizationRequestOptions } from '../../src/auth/AuthorizationRequestGenerator';
import { PingOneConfig } from '../../src/interfaces/auth';

describe('AuthorizationRequestGenerator', () => {
  let generator: AuthorizationRequestGenerator;
  let mockConfig: PingOneConfig;

  beforeEach(() => {
    mockConfig = {
      baseUrl: 'https://openam-dna.forgeblocks.com:443',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenIntrospectionEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
      authorizationEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      tokenEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token'
    };

    generator = new AuthorizationRequestGenerator(mockConfig, false); // Disable auto cleanup in tests
  });

  afterEach(() => {
    // Clean up any pending requests and destroy the generator
    if (generator) {
      generator.cleanupExpiredRequests();
      generator.destroy();
    }
  });

  afterAll(() => {
    // Ensure all timers are cleared
    jest.clearAllTimers();
  });

  describe('generateAuthorizationRequest', () => {
    it('should generate authorization request with valid banking scopes', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read', 'write'],
        sessionId: 'session-123'
      };

      const result = generator.generateAuthorizationRequest(options);

      expect(result).toMatchObject({
        scope: 'read write',
        sessionId: 'session-123'
      });
      expect(result.state).toBeDefined();
      expect(result.state).toMatch(/^[a-f0-9]{8}_[a-z0-9]+_[a-f0-9]{32}$/);
      expect(result.authorizationUrl).toContain('https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize');
      expect(result.authorizationUrl).toContain('response_type=code');
      expect(result.authorizationUrl).toContain('client_id=test-client-id');
      // After scope rename: 'banking:read' → 'read', 'banking:write' → 'write'
      expect(result.authorizationUrl).toContain('scope=read+write');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should include redirect_uri when provided', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123',
        redirectUri: 'https://example.com/callback'
      };

      const result = generator.generateAuthorizationRequest(options);

      expect(result.authorizationUrl).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
    });

    it('should use custom state when provided', () => {
      const customState = 'custom-state-123';
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123',
        state: customState
      };

      const result = generator.generateAuthorizationRequest(options);

      expect(result.state).toBe(customState);
      expect(result.authorizationUrl).toContain(`state=${customState}`);
    });

    it('should include PKCE parameters in authorization URL', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123'
      };

      const result = generator.generateAuthorizationRequest(options);

      expect(result.authorizationUrl).toContain('code_challenge=');
      expect(result.authorizationUrl).toContain('code_challenge_method=S256');
    });

    it('should set custom expiration time', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123',
        expirationMinutes: 5
      };

      const result = generator.generateAuthorizationRequest(options);

      const expectedExpiration = Date.now() + 5 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeCloseTo(expectedExpiration, -3); // Within 1 second
    });

    it('should throw error for empty scopes', () => {
      const options: AuthorizationRequestOptions = {
        scopes: [],
        sessionId: 'session-123'
      };

      expect(() => generator.generateAuthorizationRequest(options))
        .toThrow('At least one scope is required');
    });

    it('should throw error for invalid scopes', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['invalid:scope', 'malicious:action'],
        sessionId: 'session-123'
      };

      expect(() => generator.generateAuthorizationRequest(options))
        .toThrow('Invalid scopes: invalid:scope, malicious:action');
    });

    it('should accept valid banking scopes', () => {
      const validScopes = [
        'accounts:read',
        'transactions:read',
        'transactions:write',
        'read',
        'write',
        'openid',
        'profile',
        'email'
      ];

      const options: AuthorizationRequestOptions = {
        scopes: validScopes,
        sessionId: 'session-123'
      };

      expect(() => generator.generateAuthorizationRequest(options))
        .not.toThrow();
    });
  });

  describe('validateAuthorizationState', () => {
    it('should validate and return valid authorization request', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123'
      };

      const authRequest = generator.generateAuthorizationRequest(options);
      const result = generator.validateAuthorizationState(authRequest.state);

      expect(result).toEqual(authRequest);
    });

    it('should return null for invalid state', () => {
      const result = generator.validateAuthorizationState('invalid-state');

      expect(result).toBeNull();
    });

    it('should return null for expired request', async () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123',
        expirationMinutes: 0 // Expire immediately
      };

      const authRequest = generator.generateAuthorizationRequest(options);
      
      // Wait a bit to ensure expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const result = generator.validateAuthorizationState(authRequest.state);
      expect(result).toBeNull();
    });
  });

  describe('completeAuthorizationRequest', () => {
    it('should remove authorization request from pending', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123'
      };

      const authRequest = generator.generateAuthorizationRequest(options);
      
      // Verify it exists
      expect(generator.validateAuthorizationState(authRequest.state)).not.toBeNull();
      
      // Complete the request
      const result = generator.completeAuthorizationRequest(authRequest.state);
      expect(result).toBe(true);
      
      // Verify it's removed
      expect(generator.validateAuthorizationState(authRequest.state)).toBeNull();
    });

    it('should return false for non-existent state', () => {
      const result = generator.completeAuthorizationRequest('non-existent-state');
      expect(result).toBe(false);
    });
  });

  describe('getPendingRequestsForSession', () => {
    it('should return pending requests for specific session', () => {
      const session1Options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-1'
      };

      const session2Options: AuthorizationRequestOptions = {
        scopes: ['write'],
        sessionId: 'session-2'
      };

      generator.generateAuthorizationRequest(session1Options);
      generator.generateAuthorizationRequest(session2Options);
      generator.generateAuthorizationRequest(session1Options); // Another request for session-1

      const session1Requests = generator.getPendingRequestsForSession('session-1');
      const session2Requests = generator.getPendingRequestsForSession('session-2');

      expect(session1Requests).toHaveLength(2);
      expect(session2Requests).toHaveLength(1);
      expect(session1Requests.every(req => req.sessionId === 'session-1')).toBe(true);
      expect(session2Requests[0].sessionId).toBe('session-2');
    });

    it('should not return expired requests', async () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123',
        expirationMinutes: 0 // Expire immediately
      };

      generator.generateAuthorizationRequest(options);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const requests = generator.getPendingRequestsForSession('session-123');
      expect(requests).toHaveLength(0);
    });
  });

  describe('cleanupExpiredRequests', () => {
    it('should remove expired requests and return count', async () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123',
        expirationMinutes: 0 // Expire immediately
      };

      generator.generateAuthorizationRequest(options);
      generator.generateAuthorizationRequest(options);

      await new Promise(resolve => setTimeout(resolve, 10));
      
      const cleanedCount = generator.cleanupExpiredRequests();
      expect(cleanedCount).toBe(2);
    });

    it('should not remove valid requests', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123',
        expirationMinutes: 10
      };

      const authRequest = generator.generateAuthorizationRequest(options);
      const cleanedCount = generator.cleanupExpiredRequests();

      expect(cleanedCount).toBe(0);
      expect(generator.validateAuthorizationState(authRequest.state)).not.toBeNull();
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123'
      };

      generator.generateAuthorizationRequest(options);
      generator.generateAuthorizationRequest(options);

      const stats = generator.getStatistics();

      expect(stats.totalPending).toBe(2);
      expect(stats.expiredCount).toBe(0);
      expect(stats.oldestRequestAge).toBeGreaterThanOrEqual(0);
    });
  });

  describe('URL building edge cases', () => {
    it('should handle base URL with trailing slash', () => {
      const configWithSlash = {
        ...mockConfig,
        baseUrl: 'https://auth.pingone.com/'
      };

      const generatorWithSlash = new AuthorizationRequestGenerator(configWithSlash, false);
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123'
      };

      const result = generatorWithSlash.generateAuthorizationRequest(options);

      expect(result.authorizationUrl).toContain('https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize');
      expect(result.authorizationUrl).not.toContain('//am/oauth2/realms/root/realms/alpha/authorize');
    });

    it('should handle authorization endpoint without leading slash', () => {
      const configWithoutSlash = {
        ...mockConfig,
        authorizationEndpoint: 'as/authorization'
      };

      const generatorWithoutSlash = new AuthorizationRequestGenerator(configWithoutSlash, false);
      const options: AuthorizationRequestOptions = {
        scopes: ['read'],
        sessionId: 'session-123'
      };

      const result = generatorWithoutSlash.generateAuthorizationRequest(options);

      expect(result.authorizationUrl).toContain('https://openam-dna.forgeblocks.com:443/as/authorization');
    });
  });
});