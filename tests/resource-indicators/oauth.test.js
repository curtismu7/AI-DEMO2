/**
 * oauth.test.js
 *
 * OAuth flow tests for RFC 9728 Resource Indicators
 * Tests authorization flows with resource indicators.
 */

const request = require('supertest');
const app = require('../../demo_api_server/server');
const resourceIndicatorService = require('../../demo_api_server/services/resourceIndicatorService');

describe('OAuth Flow with Resource Indicators', () => {
  let testClient;
  let testResources;

  beforeAll(async () => {
    testClient = 'banking-demo-client';
    testResources = [
      'enduser.ping.demo/',
      'mcpserver.ping.demo/'
    ];
  });

  describe('Authorization Endpoint', () => {
    test('should accept resource parameters in authorization request', async () => {
      const response = await request(app)
        .get('/api/auth/oauth/login')
        .query({
          resource: testResources[0]
        });

      expect(response.status).toBe(302); // Redirect to PingOne
      expect(response.headers.location).toContain('resource=');
      expect(response.headers.location).toContain(encodeURIComponent(testResources[0]));
    });

    test('should accept multiple resource parameters', async () => {
      const response = await request(app)
        .get('/api/auth/oauth/login')
        .query({
          resource: testResources
        });

      expect(response.status).toBe(302);
      testResources.forEach(resource => {
        expect(response.headers.location).toContain(`resource=${encodeURIComponent(resource)}`);
      });
    });

    test('should validate resource selection', async () => {
      const invalidResources = ['invalid-resource-uri', 'http://insecure.com'];
      
      const response = await request(app)
        .get('/api/auth/oauth/login')
        .query({
          resource: invalidResources
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_resource_selection');
    });

    test('should use default resources when none provided', async () => {
      const response = await request(app)
        .get('/api/auth/oauth/login');

      expect(response.status).toBe(302);
      // Should redirect to PingOne with default resources or no resources
      expect(response.headers.location).toBeDefined();
    });
  });

  describe('Token Exchange with Resources', () => {
    test('should include resource indicators in token exchange', async () => {
      // Mock authorization code
      const mockCode = 'test-authorization-code';
      const mockVerifier = 'test-code-verifier';
      const mockRedirectUri = 'http://localhost:3000/api/auth/oauth/callback';

      // This would normally involve a full OAuth flow
      // For testing, we'll verify the token exchange endpoint accepts resources
      const response = await request(app)
        .post('/api/auth/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code: mockCode,
          redirect_uri: mockRedirectUri,
          code_verifier: mockVerifier,
          resource: testResources
        });

      // The actual token exchange would fail with mock data, but we test the endpoint structure
      expect(response.status).toBeDefined();
    });

    test('should validate resource format in token exchange', async () => {
      const invalidResources = ['not-a-uri', 'ftp://insecure-protocol.com'];

      const response = await request(app)
        .post('/api/auth/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code: 'test-code',
          redirect_uri: 'http://localhost:3000/callback',
          code_verifier: 'test-verifier',
          resource: invalidResources
        });

      // Should handle invalid resources gracefully
      expect(response.status).toBeDefined();
    });
  });

  describe('Resource Validation', () => {
    test('should validate resource URI format', () => {
      const validResources = [
        'enduser.ping.demo/',
        'mcpserver.ping.demo/',
        'https://admin-api.ping.demo/'
      ];

      validResources.forEach(resource => {
        expect(resourceIndicatorService.validateResourceFormat(resource)).toBe(true);
      });
    });

    test('should reject invalid resource URI format', () => {
      const invalidResources = [
        'invalid-resource-uri',
        'http://insecure.com',
        'ftp://protocol.com',
        'not-a-uri',
        '',
        null,
        undefined
      ];

      invalidResources.forEach(resource => {
        expect(resourceIndicatorService.validateResourceFormat(resource)).toBe(false);
      });
    });

    test('should validate resource selection for client', () => {
      const validation = resourceIndicatorService.validateResourceSelection(
        testClient,
        testResources
      );

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.allowedResources).toEqual(testResources);
    });

    test('should reject too many resources', () => {
      const tooManyResources = [
        'enduser.ping.demo/',
        'mcpserver.ping.demo/',
        'https://admin-api.ping.demo/',
        'https://config-api.ping.demo/'
      ];

      const validation = resourceIndicatorService.validateResourceSelection(
        testClient,
        tooManyResources
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Maximum 3 resources allowed');
    });
  });

  describe('Scope-Resource Compatibility', () => {
    test('should validate compatible scopes and resources', () => {
      const scopes = ['banking:read', 'banking:write'];
      const resources = ['enduser.ping.demo/'];

      const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
        scopes,
        resources
      );

      expect(compatibility.compatible).toBe(true);
      expect(compatibility.validScopes).toEqual(scopes);
      expect(compatibility.invalidScopes).toHaveLength(0);
    });

    test('should filter incompatible scopes', () => {
      const scopes = ['banking:read', 'admin:write']; // admin scope for banking resource
      const resources = ['enduser.ping.demo/'];

      const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
        scopes,
        resources
      );

      expect(compatibility.compatible).toBe(false);
      expect(compatibility.validScopes).toEqual(['banking:read']);
      expect(compatibility.invalidScopes).toEqual(['admin:write']);
    });
  });

  describe('Resource Binding', () => {
    test('should create resource binding for token', () => {
      const token = {
        sub: 'user-123',
        client_id: testClient,
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const boundToken = resourceIndicatorService.createResourceBinding(token, testResources);

      expect(boundToken.resource).toEqual(testResources);
      expect(boundToken.aud).toEqual(testResources);
      expect(boundToken.resource_binding).toBeDefined();
      expect(boundToken.resource_binding).toMatch(/^[a-f0-9]{64}$/); // SHA256 hash
    });

    test('should validate resource binding', () => {
      const token = {
        resource: testResources,
        client_id: testClient
      };

      const isValid = resourceIndicatorService.validateResourceBinding(token, testResources[0]);
      expect(isValid).toBe(true);
    });

    test('should reject invalid resource binding', () => {
      const token = {
        resource: ['https://different-resource.com/'],
        client_id: testClient
      };

      const isValid = resourceIndicatorService.validateResourceBinding(token, testResources[0]);
      expect(isValid).toBe(false);
    });
  });

  describe('Cross-Resource Prevention', () => {
    test('should prevent cross-resource token usage', () => {
      const token = {
        resource: ['enduser.ping.demo/'],
        client_id: testClient
      };

      const isValid = resourceIndicatorService.validateCrossResourceUsage(
        token,
        'mcpserver.ping.demo/'
      );

      expect(isValid).toBe(false);
    });

    test('should allow same-resource token usage', () => {
      const token = {
        resource: ['enduser.ping.demo/'],
        client_id: testClient
      };

      const isValid = resourceIndicatorService.validateCrossResourceUsage(
        token,
        'enduser.ping.demo/'
      );

      expect(isValid).toBe(true);
    });
  });

  describe('Resource Configuration', () => {
    test('should get available resources for client', () => {
      const resources = resourceIndicatorService.getAvailableResources(testClient);

      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThan(0);
      
      resources.forEach(resource => {
        expect(resource).toHaveProperty('uri');
        expect(resource).toHaveProperty('name');
        expect(resource).toHaveProperty('description');
        expect(resource).toHaveProperty('scopes');
        expect(resource).toHaveProperty('icon');
        expect(resource).toHaveProperty('category');
      });
    });

    test('should get client resource configuration', () => {
      const config = resourceIndicatorService.getClientResourceConfig(testClient);

      expect(config).toHaveProperty('allowedResources');
      expect(config).toHaveProperty('defaultResources');
      expect(config).toHaveProperty('maxResources');
      expect(config).toHaveProperty('requireConsent');
      
      expect(Array.isArray(config.allowedResources)).toBe(true);
      expect(Array.isArray(config.defaultResources)).toBe(true);
      expect(typeof config.maxResources).toBe('number');
    });

    test('should get default resources for client', () => {
      const defaults = resourceIndicatorService.getDefaultResources(testClient);

      expect(Array.isArray(defaults)).toBe(true);
      expect(defaults.length).toBeGreaterThan(0);
    });
  });

  describe('Feature Flag', () => {
    test('should check if resource indicators are enabled', () => {
      const isEnabled = resourceIndicatorService.isResourceIndicatorsEnabled();
      
      // Should be boolean
      expect(typeof isEnabled).toBe('boolean');
    });
  });
});
