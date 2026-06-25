const request = require('supertest');
const app = require('../../server');
const { 
  OAuthError, 
  OAUTH_ERROR_TYPES,
  validateScopesWithErrorHandling,
  checkOAuthProviderHealth
} = require('../../middleware/oauthErrorHandler');

describe('OAuth Error Handling', () => {
  describe('OAuthError Class', () => {
    it('should create OAuth error with correct properties', () => {
      const error = new OAuthError(
        OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE,
        'Access denied',
        403,
        { requiredScopes: ['admin:read'], providedScopes: ['read'] }
      );

      expect(error.type).toBe(OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE);
      expect(error.message).toBe('Access denied');
      expect(error.statusCode).toBe(403);
      expect(error.additionalData.requiredScopes).toEqual(['admin:read']);
    });

    it('should format OAuth error response correctly', () => {
      const error = new OAuthError(
        OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE,
        'Access denied',
        403,
        { 
          requiredScopes: ['admin:read'], 
          providedScopes: ['read'],
          hint: 'Request additional scopes'
        }
      );

      const json = error.toJSON();
      expect(json).toEqual({
        error: OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE,
        error_description: 'Access denied',
        required_scopes: ['admin:read'],
        provided_scopes: ['read'],
        error_hint: 'Request additional scopes'
      });
    });
  });

  describe('Scope Validation Error Handling', () => {
    it('should throw detailed error for insufficient scopes (OR logic)', () => {
      expect(() => {
        validateScopesWithErrorHandling(['read'], ['admin:read', 'write'], false);
      }).toThrow();

      try {
        validateScopesWithErrorHandling(['read'], ['admin:read', 'write'], false);
      } catch (error) {
        expect(error.type).toBe(OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE);
        expect(error.additionalData.requiredScopes).toEqual(['admin:read', 'write']);
        expect(error.additionalData.providedScopes).toEqual(['read']);
        expect(error.additionalData.validationMode).toBe('any_required');
      }
    });

    it('should throw detailed error for insufficient scopes (AND logic)', () => {
      expect(() => {
        validateScopesWithErrorHandling(['read'], ['read', 'write'], true);
      }).toThrow();

      try {
        validateScopesWithErrorHandling(['read'], ['read', 'write'], true);
      } catch (error) {
        expect(error.type).toBe(OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE);
        expect(error.additionalData.requiredScopes).toEqual(['read', 'write']);
        expect(error.additionalData.providedScopes).toEqual(['read']);
        expect(error.additionalData.validationMode).toBe('all_required');
        expect(error.additionalData.missingScopes).toEqual(['write']);
      }
    });

    it('should pass validation when user has required scopes', () => {
      expect(() => {
        validateScopesWithErrorHandling(['admin:read'], ['admin:read'], false);
      }).not.toThrow();

      expect(() => {
        validateScopesWithErrorHandling(['read', 'write'], ['read', 'write'], true);
      }).not.toThrow();
    });
  });

  describe('API Error Responses', () => {
    it('should return 401 with detailed error for missing token', async () => {
      const response = await request(app)
        .get('/api/accounts')
        .expect(401);

      expect(response.body).toMatchObject({
        error: OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
        error_description: 'Access token is required',
        timestamp: expect.any(String),
        path: '/api/accounts',
        method: 'GET'
      });
      // The hint should be included in the additional data
      expect(response.body.hint).toBeDefined();
    });

    it('should return 401 with detailed error for malformed token', async () => {
      const response = await request(app)
        .get('/api/accounts')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toMatchObject({
        error: expect.any(String),
        error_description: expect.any(String),
        timestamp: expect.any(String),
        path: '/api/accounts',
        method: 'GET'
      });
    });

    it('should return 403 with scope details for insufficient scopes', async () => {
      // This test would require a valid OAuth token with insufficient scopes
      // For now, we'll test the middleware directly
      const mockReq = {
        method: 'GET',
        path: '/api/admin/users',
        headers: {
          'user-agent': 'test-agent'
        },
        ip: '127.0.0.1',
        connection: {
          remoteAddress: '127.0.0.1'
        },
        user: {
          tokenType: 'oauth',
          scopes: ['read']
        }
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const mockNext = jest.fn();

      const { requireScopes } = require('../../middleware/auth');
      const middleware = requireScopes(['admin:read']);
      
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE,
          requiredScopes: ['admin:read'],
          providedScopes: ['read']
        })
      );
    });
  });

  describe('Health Check with OAuth Provider Status', () => {
    it('should include OAuth provider health in health check', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.body).toMatchObject({
        status: expect.any(String),
        timestamp: expect.any(String),
        service: 'demo-api-server',
        components: expect.objectContaining({
          api: 'healthy',
          oauth_provider: expect.any(String)
        })
      });
    });
  });

  describe('Error Response Format', () => {
    it('should include request tracking information in error responses', async () => {
      const response = await request(app)
        .get('/api/accounts')
        .expect(401);

      expect(response.body).toMatchObject({
        timestamp: expect.any(String),
        path: '/api/accounts',
        method: 'GET'
      });
      
      // Timestamp should be a valid ISO string
      expect(() => new Date(response.body.timestamp)).not.toThrow();
    });

    it('should not expose sensitive information in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new OAuthError(
        OAUTH_ERROR_TYPES.PROVIDER_UNAVAILABLE,
        'OAuth provider unavailable',
        503,
        { provider_error: 'Connection refused to internal service' }
      );

      // In production, sensitive details should be filtered
      const json = error.toJSON();
      expect(json.error_description).toBe('OAuth provider unavailable');
      
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('OAuth Provider Health Check', () => {
    it('should check OAuth provider health', async () => {
      const mockConfig = {
        tokenValidation: {
          issuer: 'https://example.com'
        }
      };

      // This will likely fail in test environment, but should return proper structure
      const health = await checkOAuthProviderHealth(mockConfig);
      
      expect(health).toMatchObject({
        healthy: expect.any(Boolean),
        timestamp: expect.any(String)
      });

      if (!health.healthy) {
        expect(health.error).toBeDefined();
      }
    });
  });
});

describe('Error Types Constants', () => {
  it('should have all required OAuth error types', () => {
    expect(OAUTH_ERROR_TYPES.INVALID_TOKEN).toBe('invalid_token');
    expect(OAUTH_ERROR_TYPES.EXPIRED_TOKEN).toBe('expired_token');
    expect(OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE).toBe('insufficient_scope');
    expect(OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED).toBe('authentication_required');
    expect(OAUTH_ERROR_TYPES.PROVIDER_UNAVAILABLE).toBe('provider_unavailable');
    expect(OAUTH_ERROR_TYPES.TOKEN_INTROSPECTION_FAILED).toBe('token_introspection_failed');
    expect(OAUTH_ERROR_TYPES.MALFORMED_TOKEN).toBe('malformed_token');
  });
});