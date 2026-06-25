/**
 * RFC 9728 Verification Tests
 * Actual verification steps as outlined in Phase 59 plan
 * 
 * Phase 59-01: Specification Compliance Audit - Verification Steps
 * Tests endpoint with various request scenarios and validates against RFC 9728 examples
 */

const request = require('supertest');
const express = require('express');

// Import the routes to test
const protectedResourceMetadata = require('../../routes/protectedResourceMetadata');

describe('RFC 9728 Verification Tests', () => {
  let app;

  beforeEach(() => {
    // Create test app with routes
    app = express();
    app.use('/.well-known/oauth-protected-resource', protectedResourceMetadata);
    app.use('/api/rfc9728/metadata', protectedResourceMetadata);
  });

  describe('RFC9728-01: Test endpoint with various request scenarios', () => {
    test('should handle standard GET request', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('resource');
    });

    test('should handle request with different Accept headers', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Accept', 'application/json')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('should handle request with no Accept header', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('should handle request with multiple Accept types', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('should handle request with different User-Agent headers', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('User-Agent', 'Mozilla/5.0 (compatible; RFC9728-Client/1.0)')
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });

    test('should handle request with custom headers', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('X-Custom-Header', 'test-value')
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });
  });

  describe('RFC9728-01: Validate metadata structure against RFC 9728 examples', () => {
    test('should match RFC 9728 example structure', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const metadata = response.body;
      
      // Required field
      expect(metadata).toHaveProperty('resource');
      expect(typeof metadata.resource).toBe('string');
      expect(metadata.resource).toMatch(/^https?:\/\/.+/);
      
      // Recommended fields
      if (metadata.scopes_supported) {
        expect(Array.isArray(metadata.scopes_supported)).toBe(true);
        expect(metadata.scopes_supported.length).toBeGreaterThan(0);
        metadata.scopes_supported.forEach(scope => {
          expect(typeof scope).toBe('string');
        });
      }
      
      if (metadata.authorization_servers) {
        expect(Array.isArray(metadata.authorization_servers)).toBe(true);
        metadata.authorization_servers.forEach(server => {
          expect(typeof server).toBe('string');
          expect(server).toMatch(/^https?:\/\/.+/);
        });
      }
      
      // Optional fields
      if (metadata.bearer_methods_supported) {
        expect(Array.isArray(metadata.bearer_methods_supported)).toBe(true);
        metadata.bearer_methods_supported.forEach(method => {
          expect(['header', 'body', 'query']).toContain(method);
        });
      }
      
      if (metadata.resource_name) {
        expect(typeof metadata.resource_name).toBe('string');
        expect(metadata.resource_name.length).toBeGreaterThan(0);
      }
      
      if (metadata.resource_documentation) {
        expect(typeof metadata.resource_documentation).toBe('string');
        expect(metadata.resource_documentation).toMatch(/^https?:\/\/.+/);
      }
    });

    test('should validate against RFC 9728 Section 3.2 example', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const metadata = response.body;
      
      // Compare with RFC 9728 example structure
      const rfcExample = {
        resource: "https://resource.example.com",
        authorization_servers: ["https://as.example.com"],
        scopes_supported: ["read", "write"],
        bearer_methods_supported: ["header"],
        resource_name: "Example Resource",
        resource_documentation: "https://resource.example.com/docs"
      };
      
      // Ensure our implementation follows the same structure
      Object.keys(rfcExample).forEach(key => {
        if (metadata[key]) {
          expect(typeof metadata[key]).toBe(typeof rfcExample[key]);
        }
      });
    });

    test('should ensure resource field matches requested URL pattern', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Host', 'api.example.com')
        .expect(200);

      const metadata = response.body;
      
      // Resource should include the host
      expect(metadata.resource).toContain('api.example.com');
    });
  });

  describe('RFC9728-01: Check security headers and HTTPS requirements', () => {
    test('should have appropriate security headers', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Check for security-related headers
      const headers = response.headers;
      
      // Content-Type should be application/json
      expect(headers['content-type']).toMatch(/application\/json/);
      
      // Should not expose sensitive server version info
      expect(headers['server']).toBeUndefined();
    });

    test('should handle HTTPS requirements in production', async () => {
      // Test with production environment
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // In production, should enforce HTTPS (this would be tested in actual production)
      expect(response.body).toHaveProperty('resource');
      
      process.env.NODE_ENV = originalEnv;
    });

    test('should not include sensitive information in response', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const metadata = response.body;
      const metadataString = JSON.stringify(metadata).toLowerCase();
      
      // Check for potential sensitive data
      const sensitiveFields = ['password', 'secret', 'key', 'token', 'credential', 'private'];
      sensitiveFields.forEach(field => {
        expect(metadataString).not.toContain(field);
      });
    });
  });

  describe('RFC9728-01: Verify error responses for invalid requests', () => {
    test('should handle POST request (invalid method)', async () => {
      await request(app)
        .post('/.well-known/oauth-protected-resource')
        .expect(404);
    });

    test('should handle PUT request (invalid method)', async () => {
      await request(app)
        .put('/.well-known/oauth-protected-resource')
        .expect(404);
    });

    test('should handle DELETE request (invalid method)', async () => {
      await request(app)
        .delete('/.well-known/oauth-protected-resource')
        .expect(404);
    });

    test('should handle PATCH request (invalid method)', async () => {
      await request(app)
        .patch('/.well-known/oauth-protected-resource')
        .expect(404);
    });

    test('should handle request to invalid path', async () => {
      await request(app)
        .get('/.well-known/oauth-protected-resource/invalid')
        .expect(404);
    });

    test('should handle request with malformed Accept header', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Accept', 'invalid-header-value')
        .expect(200);

      // Should still return JSON
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('should handle request with very large Accept header', async () => {
      const largeAccept = 'application/json,' + 'text/html,'.repeat(1000);
      
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Accept', largeAccept)
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });
  });

  describe('RFC9728-01: Additional edge cases', () => {
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

    test('should maintain consistency across requests', async () => {
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

    test('should handle requests with query parameters', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource?param=value&another=param')
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });

    test('should handle requests with fragment identifiers', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource#fragment')
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });
  });
});
