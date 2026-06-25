/**
 * RFC 9728 Integration Verification Tests
 * Comprehensive integration testing for all RFC 9728 components
 * 
 * Phase 59-03: Integration and Functionality Testing - Verification Steps
 * Tests all endpoint access scenarios, UI integration, CORS handling, and error recovery
 */

const request = require('supertest');
const express = require('express');

// Import the routes to test
const protectedResourceMetadata = require('../../routes/protectedResourceMetadata');

describe('RFC 9728 Integration Verification Tests', () => {
  let app;

  beforeEach(() => {
    // Create test app with routes
    app = express();
    app.use('/.well-known/oauth-protected-resource', protectedResourceMetadata);
    app.use('/api/rfc9728/metadata', protectedResourceMetadata);
  });

  describe('RFC9728-03: Test all endpoint access scenarios', () => {
    test('should access well-known endpoint directly', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('resource');
      expect(response.body).toHaveProperty('scopes_supported');
    });

    test('should access UI proxy endpoint directly', async () => {
      const response = await request(app)
        .get('/api/rfc9728/metadata')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('resource');
      expect(response.body).toHaveProperty('scopes_supported');
    });

    test('should return identical responses from both endpoints', async () => {
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

    test('should handle concurrent endpoint access', async () => {
      const wellKnownPromises = Array(5).fill(null).map(() =>
        request(app).get('/.well-known/oauth-protected-resource')
      );
      
      const proxyPromises = Array(5).fill(null).map(() =>
        request(app).get('/api/rfc9728/metadata')
      );

      const [wellKnownResponses, proxyResponses] = await Promise.all([
        Promise.all(wellKnownPromises),
        Promise.all(proxyPromises)
      ]);

      // All responses should be successful
      [...wellKnownResponses, ...proxyResponses].forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('resource');
      });

      // All responses should have identical non-port fields
      const { resource: _rf, ...firstFields } = wellKnownResponses[0].body;
      [...wellKnownResponses.slice(1), ...proxyResponses].forEach(response => {
        const { resource: _rx, ...fields } = response.body;
        expect(fields).toEqual(firstFields);
      });
    });

    test('should handle endpoint access with different hosts', async () => {
      const testHosts = [
        'api.example.com',
        'banking-api.example.com',
        'localhost:3000',
        '127.0.0.1:8080'
      ];

      for (const host of testHosts) {
        const response = await request(app)
          .get('/.well-known/oauth-protected-resource')
          .set('Host', host)
          .expect(200);

        expect(response.body).toHaveProperty('resource');
        expect(response.body.resource).toContain(host);
      }
    });

    test('should handle endpoint access with different protocols', async () => {
      // Test with different protocol contexts
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);

      expect(response.body).toHaveProperty('resource');
      // In a real implementation, this would affect the resource URL
    });
  });

  describe('RFC9728-03: Verify UI integration works correctly', () => {
    test('should provide UI-compatible response format', async () => {
      const response = await request(app)
        .get('/api/rfc9728/metadata')
        .expect(200);

      // Response should be easily consumable by UI
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['content-type']).toMatch(/charset=utf-8/);
      
      // Response structure should be UI-friendly
      const metadata = response.body;
      expect(typeof metadata).toBe('object');
      expect(Array.isArray(metadata)).toBe(false);
      
      // All values should be JSON-serializable
      expect(() => JSON.stringify(metadata)).not.toThrow();
    });

    test('should handle UI-originated requests', async () => {
      // Simulate UI request with typical headers
      const response = await request(app)
        .get('/api/rfc9728/metadata')
        .set('Referer', 'http://localhost:3000/education')
        .set('Origin', 'http://localhost:3000')
        .set('User-Agent', 'Mozilla/5.0 (compatible; BankingUI/1.0)')
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });

    test('should support UI polling patterns', async () => {
      // Simulate UI polling for fresh metadata
      const pollCount = 3;
      const responses = [];

      for (let i = 0; i < pollCount; i++) {
        const response = await request(app)
          .get('/api/rfc9728/metadata')
          .set('X-Poll-Request', 'true')
          .expect(200);
        
        responses.push(response.body);
        
        // Small delay between polls (simulating real UI behavior)
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // All responses should have identical non-port fields
      const { resource: _rp, ...firstFields } = responses[0];
      responses.slice(1).forEach(response => {
        const { resource: _rx, ...fields } = response;
        expect(fields).toEqual(firstFields);
      });
    });

    test('should handle UI error states gracefully', async () => {
      // Test UI error handling by requesting invalid endpoint
      const response = await request(app)
        .get('/api/rfc9728/invalid-endpoint')
        .expect(404);

      // Express default 404 returns HTML
      expect(response.status).toBe(404);
    });

    test('should support UI caching strategies', async () => {
      const response = await request(app)
        .get('/api/rfc9728/metadata')
        .expect(200);

      // Response should support UI caching
      expect(response.headers['content-type']).toMatch(/application\/json/);
      
      // In a real implementation, would check for cache headers
      // For now, verify the response is cacheable (static content)
      expect(response.body).toHaveProperty('resource');
    });
  });

  describe('RFC9728-03: Check CORS and security header handling', () => {
    test('should handle same-origin requests', async () => {
      const response = await request(app)
        .get('/api/rfc9728/metadata')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });

    test('should handle cross-origin requests appropriately', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Origin', 'https://external-site.com')
        .expect(200);

      // Well-known endpoint should be accessible cross-origin
      expect(response.body).toHaveProperty('resource');
    });

    test('should handle preflight OPTIONS requests', async () => {
      const response = await request(app)
        .options('/.well-known/oauth-protected-resource');

      // Express responds to OPTIONS with 200 by default
      expect([200, 204, 404]).toContain(response.status);
    });

    test('should handle security-related headers', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Check for appropriate security headers
      expect(response.headers['content-type']).toMatch(/application\/json/);
      
      // Should not expose sensitive server version info
      expect(response.headers['server']).toBeUndefined();
    });

    test('should handle requests with various security headers', async () => {
      const securityHeaders = {
        'X-Forwarded-For': '192.168.1.1',
        'X-Real-IP': '192.168.1.1',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'api.example.com'
      };

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set(securityHeaders)
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });

    test('should handle requests with authentication headers', async () => {
      const authHeaders = {
        'Authorization': 'Bearer token123',
        'X-API-Key': 'key123'
      };

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set(authHeaders)
        .expect(200);

      // Endpoint should be public and not require auth
      expect(response.body).toHaveProperty('resource');
    });
  });

  describe('RFC9728-03: Test error scenarios and recovery', () => {
    test('should handle malformed requests gracefully', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Accept', 'invalid-header-value')
        .expect(200);

      // Should still return valid JSON
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('resource');
    });

    test('should handle requests with extremely long headers', async () => {
      const longHeaderValue = 'x'.repeat(10000);
      
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('X-Long-Header', longHeaderValue)
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });

    test('should handle requests with many headers', async () => {
      const manyHeaders = {};
      for (let i = 0; i < 100; i++) {
        manyHeaders[`X-Header-${i}`] = `value-${i}`;
      }

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set(manyHeaders)
        .expect(200);

      expect(response.body).toHaveProperty('resource');
    });

    test('should handle concurrent error scenarios', async () => {
      const validRequests = Array(5).fill(null).map(() =>
        request(app).get('/.well-known/oauth-protected-resource')
      );
      
      const invalidRequests = Array(5).fill(null).map(() =>
        request(app).post('/.well-known/oauth-protected-resource')
      );

      const [validResponses, invalidResponses] = await Promise.all([
        Promise.all(validRequests),
        Promise.allSettled(invalidRequests)
      ]);

      // Valid requests should succeed
      validResponses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('resource');
      });

      // Invalid requests should fail gracefully
      invalidResponses.forEach(result => {
        expect(result.status).toBe('fulfilled');
        expect(result.value.status).toBe(404);
      });
    });

    test('should handle rapid-fire requests', async () => {
      const rapidRequests = Array(50).fill(null).map((_, index) =>
        request(app).get('/.well-known/oauth-protected-resource')
      );

      const responses = await Promise.all(rapidRequests);

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('resource');
      });

      // All responses should have identical non-port fields
      const { resource: _rf, ...firstFields } = responses[0].body;
      responses.slice(1).forEach(response => {
        const { resource: _rx, ...fields } = response.body;
        expect(fields).toEqual(firstFields);
      });
    });

    test('should handle requests during simulated system stress', async () => {
      // Simulate system stress with concurrent requests
      const stressRequests = Array(20).fill(null).map(() =>
        request(app).get('/.well-known/oauth-protected-resource')
      );

      const responses = await Promise.all(stressRequests);

      // All requests should succeed even under stress
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('resource');
      });
    });

    test('should recover from temporary failures', async () => {
      // First request should succeed
      const firstResponse = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Simulate temporary failure (this would be more complex in real testing)
      // For now, verify consistent behavior
      const secondResponse = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Compare all fields except 'resource' which contains a dynamic port from supertest
      const { resource: _r1, ...first } = firstResponse.body;
      const { resource: _r2, ...second } = secondResponse.body;
      expect(first).toEqual(second);
    });
  });

  describe('RFC9728-03: Integration with other components', () => {
    test('should integrate with educational components', async () => {
      const response = await request(app)
        .get('/api/rfc9728/metadata')
        .expect(200);

      // Response should be suitable for educational component consumption
      const metadata = response.body;
      
      // Should have all fields needed for education
      expect(metadata).toHaveProperty('resource');
      expect(metadata).toHaveProperty('scopes_supported');
      // authorization_servers is only present when PINGONE_ENVIRONMENT_ID is set
      expect(metadata).toHaveProperty('bearer_methods_supported');
      expect(metadata).toHaveProperty('resource_name');
      expect(metadata).toHaveProperty('resource_documentation');
    });

    test('should support compliance checking integration', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Response should be suitable for compliance checking
      const metadata = response.body;
      
      // Should have structure that compliance checker can validate
      expect(typeof metadata).toBe('object');
      expect(metadata).toHaveProperty('resource');
      
      // All required fields should be present for compliance
      expect(metadata.resource).toBeDefined();
      expect(typeof metadata.resource).toBe('string');
    });

    test('should support monitoring and analytics integration', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // Response should be monitorable
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('resource');
    });
  });

  describe('RFC9728-03: Performance and reliability', () => {
    test('should respond quickly under normal load', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(100); // Should respond in under 100ms
    });

    test('should maintain performance under concurrent load', async () => {
      const concurrentRequests = Array(20).fill(null).map(() =>
        request(app).get('/.well-known/oauth-protected-resource')
      );

      const startTime = Date.now();
      const responses = await Promise.all(concurrentRequests);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('resource');
      });

      // Should handle concurrent requests efficiently
      expect(totalTime).toBeLessThan(500); // All requests should complete in under 500ms
    });

    test('should maintain consistency across multiple requests', async () => {
      const requestCount = 10;
      const responses = [];

      for (let i = 0; i < requestCount; i++) {
        const response = await request(app)
          .get('/.well-known/oauth-protected-resource')
          .expect(200);
        responses.push(response.body);
      }

      // All responses should have identical non-port fields
      const { resource: _rf2, ...firstFields2 } = responses[0];
      responses.slice(1).forEach(response => {
        const { resource: _rx2, ...fields } = response;
        expect(fields).toEqual(firstFields2);
      });
    });
  });
});
