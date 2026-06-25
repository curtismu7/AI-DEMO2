/**
 * validation.test.js
 *
 * Resource indicator validation tests for RFC 9728
 * Tests resource validation, binding, and security features.
 */

const resourceIndicatorService = require('../../demo_api_server/services/resourceIndicatorService');

describe('Resource Indicator Validation', () => {
  describe('Resource Format Validation', () => {
    test('should validate correct resource URI formats', () => {
      const validResources = [
        'enduser.ping.demo/',
        'mcpserver.ping.demo/',
        'https://admin-api.ping.demo/',
        'https://config-api.ping.demo/',
        'https://auth.pingone.com/env123/',
        'https://api.pingone.com/v1/'
      ];

      validResources.forEach(resource => {
        expect(resourceIndicatorService.validateResourceFormat(resource)).toBe(true);
      });
    });

    test('should reject invalid resource URI formats', () => {
      const invalidResources = [
        'invalid-resource-uri',
        'http://insecure.com',
        'ftp://protocol.com',
        'not-a-uri',
        '',
        null,
        undefined,
        'https://', // incomplete
        'https://example.com', // missing trailing slash
        'https://evil-site.com/',
        'https://phishing-site.net/'
      ];

      invalidResources.forEach(resource => {
        expect(resourceIndicatorService.validateResourceFormat(resource)).toBe(false);
      });
    });

    test('should require HTTPS protocol', () => {
      const httpResources = [
        'http://banking-api.ping.demo/',
        'http://mcp-server.pingdemo.com/',
        'http://example.com/'
      ];

      httpResources.forEach(resource => {
        expect(resourceIndicatorService.validateResourceFormat(resource)).toBe(false);
      });
    });

    test('should require trailing slash', () => {
      const resourcesWithoutSlash = [
        'enduser.ping.demo',
        'mcpserver.ping.demo',
        'https://example.com'
      ];

      resourcesWithoutSlash.forEach(resource => {
        expect(resourceIndicatorService.validateResourceFormat(resource)).toBe(false);
      });
    });
  });

  describe('Resource Selection Validation', () => {
    const testClient = 'banking-demo-client';
    const validResources = [
      'enduser.ping.demo/',
      'mcpserver.ping.demo/'
    ];

    test('should validate correct resource selection', () => {
      const validation = resourceIndicatorService.validateResourceSelection(
        testClient,
        validResources
      );

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.allowedResources).toEqual(validResources);
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

    test('should reject invalid resource formats', () => {
      const invalidResources = [
        'enduser.ping.demo/',
        'invalid-resource-uri',
        'http://insecure.com/'
      ];

      const validation = resourceIndicatorService.validateResourceSelection(
        testClient,
        invalidResources
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(error => error.includes('Invalid resource format'))).toBe(true);
    });

    test('should reject unauthorized resources', () => {
      const unauthorizedResources = [
        'https://unauthorized-api.ping.demo/',
        'https://external-service.com/'
      ];

      const validation = resourceIndicatorService.validateResourceSelection(
        testClient,
        unauthorizedResources
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(error => error.includes('not allowed for client'))).toBe(true);
    });

    test('should provide warnings for unknown resources', () => {
      const mixedResources = [
        'enduser.ping.demo/',
        'https://unknown-api.ping.demo/'
      ];

      const validation = resourceIndicatorService.validateResourceSelection(
        testClient,
        mixedResources
      );

      expect(validation.warnings.some(warning => warning.includes('Unknown resource'))).toBe(true);
    });
  });

  describe('Scope-Resource Compatibility', () => {
    test('should validate compatible banking scopes', () => {
      const scopes = ['banking:read', 'banking:write', 'transactions:read'];
      const resources = ['enduser.ping.demo/'];

      const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
        scopes,
        resources
      );

      expect(compatibility.compatible).toBe(true);
      expect(compatibility.validScopes).toEqual(scopes);
      expect(compatibility.invalidScopes).toHaveLength(0);
    });

    test('should validate compatible AI scopes', () => {
      const scopes = ['ai:act', 'ai:read', 'agent:manage'];
      const resources = ['mcpserver.ping.demo/'];

      const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
        scopes,
        resources
      );

      expect(compatibility.compatible).toBe(true);
      expect(compatibility.validScopes).toEqual(scopes);
      expect(compatibility.invalidScopes).toHaveLength(0);
    });

    test('should filter incompatible scopes', () => {
      const scopes = ['banking:read', 'admin:write', 'ai:act'];
      const resources = ['enduser.ping.demo/'];

      const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
        scopes,
        resources
      );

      expect(compatibility.compatible).toBe(false);
      expect(compatibility.validScopes).toEqual(['banking:read']);
      expect(compatibility.invalidScopes).toEqual(['admin:write', 'ai:act']);
    });

    test('should handle multiple resources with different scopes', () => {
      const scopes = ['banking:read', 'ai:act', 'admin:read'];
      const resources = [
        'enduser.ping.demo/',
        'mcpserver.ping.demo/'
      ];

      const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
        scopes,
        resources
      );

      expect(compatibility.validScopes).toEqual(['banking:read', 'ai:act']);
      expect(compatibility.invalidScopes).toEqual(['admin:read']);
    });

    test('should handle empty scopes', () => {
      const scopes = [];
      const resources = ['enduser.ping.demo/'];

      const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
        scopes,
        resources
      );

      expect(compatibility.compatible).toBe(true);
      expect(compatibility.validScopes).toHaveLength(0);
      expect(compatibility.invalidScopes).toHaveLength(0);
    });

    test('should handle empty resources', () => {
      const scopes = ['banking:read'];
      const resources = [];

      const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
        scopes,
        resources
      );

      expect(compatibility.compatible).toBe(false);
      expect(compatibility.validScopes).toHaveLength(0);
      expect(compatibility.invalidScopes).toEqual(scopes);
    });
  });

  describe('Resource Binding', () => {
    const testToken = {
      sub: 'user-123',
      client_id: 'test-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };

    const testResources = [
      'enduser.ping.demo/',
      'mcpserver.ping.demo/'
    ];

    test('should create resource binding with hash', () => {
      const boundToken = resourceIndicatorService.createResourceBinding(testToken, testResources);

      expect(boundToken.resource).toEqual(testResources);
      expect(boundToken.aud).toEqual(testResources);
      expect(boundToken.resource_binding).toBeDefined();
      expect(boundToken.resource_binding).toMatch(/^[a-f0-9]{64}$/); // SHA256 hash
    });

    test('should sort resources for consistent binding', () => {
      const unsortedResources = [
        'mcpserver.ping.demo/',
        'enduser.ping.demo/'
      ];

      const boundToken = resourceIndicatorService.createResourceBinding(testToken, unsortedResources);

      expect(boundToken.resource).toEqual([
        'enduser.ping.demo/',
        'mcpserver.ping.demo/'
      ]);
    });

    test('should handle empty resources', () => {
      const boundToken = resourceIndicatorService.createResourceBinding(testToken, []);

      expect(boundToken.resource).toBeUndefined();
      expect(boundToken.aud).toBeUndefined();
      expect(boundToken.resource_binding).toBeUndefined();
    });

    test('should validate resource binding for single resource', () => {
      const token = {
        resource: testResources[0],
        client_id: testToken.client_id
      };

      const isValid = resourceIndicatorService.validateResourceBinding(token, testResources[0]);
      expect(isValid).toBe(true);
    });

    test('should validate resource binding for multiple resources', () => {
      const token = {
        resource: testResources,
        client_id: testToken.client_id
      };

      const isValid = resourceIndicatorService.validateResourceBinding(token, testResources[0]);
      expect(isValid).toBe(true);
    });

    test('should validate resource binding using aud field', () => {
      const token = {
        aud: testResources,
        client_id: testToken.client_id
      };

      const isValid = resourceIndicatorService.validateResourceBinding(token, testResources[0]);
      expect(isValid).toBe(true);
    });

    test('should reject invalid resource binding', () => {
      const token = {
        resource: ['https://different-resource.com/'],
        client_id: testToken.client_id
      };

      const isValid = resourceIndicatorService.validateResourceBinding(token, testResources[0]);
      expect(isValid).toBe(false);
    });

    test('should handle missing resource binding', () => {
      const token = {
        client_id: testToken.client_id
      };

      const isValid = resourceIndicatorService.validateResourceBinding(token, testResources[0]);
      expect(isValid).toBe(false);
    });
  });

  describe('Cross-Resource Prevention', () => {
    test('should prevent cross-resource token usage', () => {
      const token = {
        resource: ['enduser.ping.demo/'],
        client_id: 'test-client'
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
        client_id: 'test-client'
      };

      const isValid = resourceIndicatorService.validateCrossResourceUsage(
        token,
        'enduser.ping.demo/'
      );

      expect(isValid).toBe(true);
    });

    test('should prevent subdomain crossing', () => {
      const token = {
        resource: ['https://api.ping.demo/'],
        client_id: 'test-client'
      };

      const isValid = resourceIndicatorService.validateCrossResourceUsage(
        token,
        'https://admin.pingdemo.com/'
      );

      expect(isValid).toBe(false);
    });

    test('should handle string aud field', () => {
      const token = {
        aud: 'enduser.ping.demo/',
        client_id: 'test-client'
      };

      const isValid = resourceIndicatorService.validateCrossResourceUsage(
        token,
        'enduser.ping.demo/'
      );

      expect(isValid).toBe(true);
    });

    test('should handle missing resource binding', () => {
      const token = {
        client_id: 'test-client'
      };

      const isValid = resourceIndicatorService.validateCrossResourceUsage(
        token,
        'enduser.ping.demo/'
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Resource Configuration', () => {
    test('should get available resources for client', () => {
      const resources = resourceIndicatorService.getAvailableResources('banking-demo-client');

      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThan(0);
      
      resources.forEach(resource => {
        expect(resource).toHaveProperty('uri');
        expect(resource).toHaveProperty('name');
        expect(resource).toHaveProperty('description');
        expect(resource).toHaveProperty('scopes');
        expect(resource).toHaveProperty('icon');
        expect(resource).toHaveProperty('category');
        expect(Array.isArray(resource.scopes)).toBe(true);
      });
    });

    test('should get different resources for different clients', () => {
      const bankingResources = resourceIndicatorService.getAvailableResources('banking-demo-client');
      const adminResources = resourceIndicatorService.getAvailableResources('admin-client');

      expect(bankingResources).not.toEqual(adminResources);
    });

    test('should get client resource configuration', () => {
      const config = resourceIndicatorService.getClientResourceConfig('banking-demo-client');

      expect(config).toHaveProperty('allowedResources');
      expect(config).toHaveProperty('defaultResources');
      expect(config).toHaveProperty('maxResources');
      expect(config).toHaveProperty('requireConsent');
      
      expect(Array.isArray(config.allowedResources)).toBe(true);
      expect(Array.isArray(config.defaultResources)).toBe(true);
      expect(typeof config.maxResources).toBe('number');
      expect(typeof config.requireConsent).toBe('boolean');
    });

    test('should get default resources for client', () => {
      const defaults = resourceIndicatorService.getDefaultResources('banking-demo-client');

      expect(Array.isArray(defaults)).toBe(true);
      expect(defaults.length).toBeGreaterThan(0);
      defaults.forEach(resource => {
        expect(resourceIndicatorService.validateResourceFormat(resource)).toBe(true);
      });
    });

    test('should handle unknown client gracefully', () => {
      const unknownClientConfig = resourceIndicatorService.getClientResourceConfig('unknown-client');

      expect(unknownClientConfig).toHaveProperty('allowedResources');
      expect(unknownClientConfig).toHaveProperty('defaultResources');
      expect(unknownClientConfig).toHaveProperty('maxResources');
      expect(unknownClientConfig).toHaveProperty('requireConsent');
    });
  });

  describe('Feature Flag', () => {
    test('should check if resource indicators are enabled', () => {
      const isEnabled = resourceIndicatorService.isResourceIndicatorsEnabled();
      
      expect(typeof isEnabled).toBe('boolean');
    });
  });

  describe('Resource Filtering', () => {
    test('should filter scopes by resources', () => {
      const scopes = [
        'banking:read',
        'banking:write',
        'admin:read',
        'ai:act'
      ];
      const resources = ['enduser.ping.demo/'];

      const filteredScopes = resourceIndicatorService.filterScopesByResources(scopes, resources);

      expect(filteredScopes).toEqual(['banking:read', 'banking:write']);
    });

    test('should filter scopes for multiple resources', () => {
      const scopes = [
        'banking:read',
        'admin:read',
        'ai:act',
        'config:read'
      ];
      const resources = [
        'enduser.ping.demo/',
        'mcpserver.ping.demo/'
      ];

      const filteredScopes = resourceIndicatorService.filterScopesByResources(scopes, resources);

      expect(filteredScopes).toEqual(['banking:read', 'ai:act']);
    });

    test('should return empty scopes for no resources', () => {
      const scopes = ['banking:read', 'admin:read'];
      const resources = [];

      const filteredScopes = resourceIndicatorService.filterScopesByResources(scopes, resources);

      expect(filteredScopes).toEqual([]);
    });
  });
});
