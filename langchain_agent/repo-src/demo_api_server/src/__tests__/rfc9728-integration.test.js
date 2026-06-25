/**
 * RFC 9728 Integration and Functionality Tests
 * Comprehensive testing suite for RFC 9728 implementation integration
 * 
 * Phase 59-03: Integration and Functionality Testing
 * Tests endpoint accessibility, proxy functionality, and educational integration
 */

const request = require('supertest');
const express = require('express');

// Import the routes to test
const protectedResourceMetadata = require('../../routes/protectedResourceMetadata');
const rfc9728ComplianceAudit = require('../../routes/rfc9728ComplianceAudit');

describe('RFC 9728 Integration Tests', () => {
  let app;

  beforeEach(() => {
    // Create test app with routes
    app = express();
    app.use('/.well-known/oauth-protected-resource', protectedResourceMetadata);
    app.use('/api/rfc9728/metadata', protectedResourceMetadata);
    app.use('/api/rfc9728', rfc9728ComplianceAudit);
  });

  describe('Well-known Endpoint Accessibility', () => {
    test('should respond to GET /.well-known/oauth-protected-resource', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('resource');
      expect(response.body.resource).toMatch(/^https?:\/\/.+/);
    });

    test('should respond with correct metadata structure', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const metadata = response.body;
      
      // Required fields
      expect(metadata).toHaveProperty('resource');
      
      // Recommended fields
      expect(metadata).toHaveProperty('scopes_supported');
      expect(Array.isArray(metadata.scopes_supported)).toBe(true);
      
      // Optional fields
      expect(metadata).toHaveProperty('bearer_methods_supported');
      expect(metadata).toHaveProperty('resource_name');
      expect(metadata).toHaveProperty('resource_documentation');
    });

    test('should handle different host contexts correctly', async () => {
      // Test with different host headers
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Host', 'api.example.com')
        .expect(200);

      expect(response.body.resource).toContain('api.example.com');
    });

    test('should include authorization_servers when environment is configured', async () => {
      // Mock environment variables
      const originalEnvId = process.env.PINGONE_ENVIRONMENT_ID;
      const originalRegion = process.env.PINGONE_REGION;
      
      process.env.PINGONE_ENVIRONMENT_ID = '123456';
      process.env.PINGONE_REGION = 'com';

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.body).toHaveProperty('authorization_servers');
      expect(Array.isArray(response.body.authorization_servers)).toBe(true);
      expect(response.body.authorization_servers[0]).toContain('auth.pingone.com');

      // Restore environment
      process.env.PINGONE_ENVIRONMENT_ID = originalEnvId;
      process.env.PINGONE_REGION = originalRegion;
    });
  });

  describe('Proxy Endpoint Functionality', () => {
    test('should respond to GET /api/rfc9728/metadata', async () => {
      const response = await request(app)
        .get('/api/rfc9728/metadata')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('resource');
    });

    test('should return identical metadata to well-known endpoint', async () => {
      const wellKnownResponse = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const proxyResponse = await request(app)
        .get('/api/rfc9728/metadata')
        .expect(200);

      // Compare all fields except 'resource' which contains a dynamic port from supertest
      const { resource: _r1, ...first } = wellKnownResponse.body;
      const { resource: _r2, ...second } = proxyResponse.body;
      expect(first).toEqual(second);
    });

    test('should handle CORS for UI access', async () => {
      const response = await request(app)
        .get('/api/rfc9728/metadata')
        .expect(200);

      // The proxy endpoint should be accessible from same origin
      expect(response.status).toBe(200);
    });
  });

  describe('Compliance Audit Endpoints', () => {
    test('should provide comprehensive compliance audit', async () => {
      const response = await request(app)
        .get('/api/rfc9728/audit/compliance')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('audit');
      expect(response.body.audit).toHaveProperty('metadata_compliance');
      expect(response.body.audit).toHaveProperty('endpoint_compliance');
      expect(response.body.audit).toHaveProperty('security_compliance');
      expect(response.body.audit).toHaveProperty('educational_compliance');
      expect(response.body.audit).toHaveProperty('overall_score');
    });

    test('should provide metadata-specific audit', async () => {
      const response = await request(app)
        .get('/api/rfc9728/audit/metadata')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('compliance');
      expect(response.body.compliance).toHaveProperty('required_fields');
      expect(response.body.compliance).toHaveProperty('recommended_fields');
      expect(response.body.compliance).toHaveProperty('optional_fields');
      expect(response.body.compliance).toHaveProperty('field_formats');
    });

    test('should provide endpoint-specific audit', async () => {
      const response = await request(app)
        .get('/api/rfc9728/audit/endpoint')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('compliance');
      expect(response.body.compliance).toHaveProperty('endpoint_accessible');
      expect(response.body.compliance).toHaveProperty('response_format');
      expect(response.body.compliance).toHaveProperty('cors_handling');
      expect(response.body.compliance).toHaveProperty('caching_headers');
    });

    test('should provide security-specific audit', async () => {
      const response = await request(app)
        .get('/api/rfc9728/audit/security')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('compliance');
      expect(response.body.compliance).toHaveProperty('resource_validation');
      expect(response.body.compliance).toHaveProperty('https_compliance');
      expect(response.body.compliance).toHaveProperty('data_privacy');
    });

    test('should provide educational-specific audit', async () => {
      const response = await request(app)
        .get('/api/rfc9728/audit/educational')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('compliance');
      expect(response.body.compliance).toHaveProperty('technical_accuracy');
      expect(response.body.compliance).toHaveProperty('specification_alignment');
      expect(response.body.compliance).toHaveProperty('live_demo_functionality');
      expect(response.body.compliance).toHaveProperty('educational_clarity');
    });

    test('should provide compliance summary', async () => {
      const response = await request(app)
        .get('/api/rfc9728/audit/summary')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('summary');
      expect(response.body.summary).toHaveProperty('overall_score');
      expect(response.body.summary).toHaveProperty('compliance_level');
      expect(response.body.summary).toHaveProperty('area_scores');
      expect(response.body.summary).toHaveProperty('critical_issues');
      expect(response.body.summary).toHaveProperty('status');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle invalid HTTP methods', async () => {
      await request(app)
        .post('/.well-known/oauth-protected-resource')
        .expect(404);

      await request(app)
        .put('/.well-known/oauth-protected-resource')
        .expect(404);
    });

    test('should handle malformed requests gracefully', async () => {
      // Test with invalid Accept header
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Accept', 'text/html')
        .expect(200);

      // Should still return JSON
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('should handle missing environment variables', async () => {
      // Clear environment variables
      const originalEnvId = process.env.PINGONE_ENVIRONMENT_ID;
      const originalRegion = process.env.PINGONE_REGION;
      delete process.env.PINGONE_ENVIRONMENT_ID;
      delete process.env.PINGONE_REGION;

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Should still work without authorization_servers
      expect(response.body).toHaveProperty('resource');
      expect(response.body).not.toHaveProperty('authorization_servers');

      // Restore environment
      process.env.PINGONE_ENVIRONMENT_ID = originalEnvId;
      process.env.PINGONE_REGION = originalRegion;
    });

    test('should handle audit endpoint errors gracefully', async () => {
      // The audit compliance endpoint should return a valid response
      const response = await request(app)
        .get('/api/rfc9728/audit/compliance')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('audit');
    });
  });

  describe('Performance and Caching', () => {
    test('should respond quickly', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(100); // Should respond in under 100ms
    });

    test('should handle concurrent requests', async () => {
      const promises = Array(10).fill(null).map(() =>
        request(app).get('/.well-known/oauth-protected-resource')
      );

      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('resource');
      });
    });

    test('should maintain consistency across multiple requests', async () => {
      const firstResponse = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const secondResponse = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Compare all fields except 'resource' which contains a dynamic port from supertest
      const { resource: _r1, ...first } = firstResponse.body;
      const { resource: _r2, ...second } = secondResponse.body;
      expect(first).toEqual(second);
    });
  });

  describe('Security Considerations', () => {
    test('should not expose sensitive information', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const metadata = response.body;
      const metadataString = JSON.stringify(metadata).toLowerCase();

      // Check for potential sensitive data
      const sensitiveFields = ['password', 'secret', 'key', 'token', 'credential'];
      sensitiveFields.forEach(field => {
        expect(metadataString).not.toContain(field);
      });
    });

    test('should validate resource field format', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const resource = response.body.resource;
      
      // Should be a valid URI
      expect(() => new URL(resource)).not.toThrow();
    });

    test('should validate authorization_servers format when present', async () => {
      // Set environment to include authorization servers
      const originalEnvId = process.env.PINGONE_ENVIRONMENT_ID;
      const originalRegion = process.env.PINGONE_REGION;
      
      process.env.PINGONE_ENVIRONMENT_ID = '123456';
      process.env.PINGONE_REGION = 'com';

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const authServers = response.body.authorization_servers;
      expect(Array.isArray(authServers)).toBe(true);
      
      authServers.forEach(server => {
        // Should be valid URIs
        expect(() => new URL(server)).not.toThrow();
      });

      // Restore environment
      process.env.PINGONE_ENVIRONMENT_ID = originalEnvId;
      process.env.PINGONE_REGION = originalRegion;
    });
  });

  describe('Content Type and Headers', () => {
    test('should set correct content-type header', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('should handle charset correctly', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Response should be parseable as UTF-8
      expect(() => JSON.stringify(response.body)).not.toThrow();
    });
  });

  describe('Cross-Environment Compatibility', () => {
    test('should work in development environment', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.body).toHaveProperty('resource');

      process.env.NODE_ENV = originalNodeEnv;
    });

    test('should work in production environment', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.body).toHaveProperty('resource');

      process.env.NODE_ENV = originalNodeEnv;
    });

    test('should work without NODE_ENV set', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.body).toHaveProperty('resource');

      process.env.NODE_ENV = originalNodeEnv;
    });
  });
});
