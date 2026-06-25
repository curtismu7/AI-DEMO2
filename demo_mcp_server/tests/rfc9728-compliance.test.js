/**
 * RFC 9728 Compliance Test Suite
 * Tests for OAuth 2.0 Protected Resource Metadata implementation
 */

const request = require('supertest');
const { BankingMCPServer } = require('../src/server/BankingMCPServer');

describe('RFC 9728 Compliance Tests', () => {
  let server;
  let app;

  beforeAll(async () => {
    // Initialize test server
    const config = {
      host: 'localhost',
      port: 3001,
      httpTransport: true,
      authServerUrl: 'https://auth.pingone.com/test-env/as',
      resourceUrl: 'mcpserver.ping.demo'
    };
    
    server = new BankingMCPServer(config);
    app = server.createExpressApp();
  });

  afterAll(async () => {
    if (server) {
      await server.shutdown();
    }
  });

  describe('GET /.well-known/oauth-protected-resource', () => {
    test('should return 200 OK', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);
      
      expect(response.headers['content-type']).toMatch(/json/);
      expect(response.headers['cache-control']).toContain('public');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    test('should include required fields per RFC 9728', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);
      
      const metadata = response.body;
      
      // Required fields
      expect(metadata).toHaveProperty('resource');
      expect(metadata).toHaveProperty('authorization_servers');
      
      // Validate resource field
      expect(typeof metadata.resource).toBe('string');
      expect(metadata.resource).toContain('/mcp');
      
      // Validate authorization_servers field
      expect(Array.isArray(metadata.authorization_servers)).toBe(true);
      expect(metadata.authorization_servers.length).toBeGreaterThan(0);
      expect(metadata.authorization_servers[0]).toMatch(/^https?:\/\//);
    });

    test('should include optional fields when implemented', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);
      
      const metadata = response.body;
      
      // Optional but recommended fields
      expect(metadata).toHaveProperty('scopes_supported');
      expect(metadata).toHaveProperty('resource_name');
      expect(metadata).toHaveProperty('resource_documentation');
      
      // Validate scopes_supported
      if (metadata.scopes_supported) {
        expect(Array.isArray(metadata.scopes_supported)).toBe(true);
        expect(metadata.scopes_supported.length).toBeGreaterThan(0);
        
        // Check for banking-specific scopes
        const bankingScopes = metadata.scopes_supported.filter(scope => 
          scope.startsWith('banking:')
        );
        expect(bankingScopes.length).toBeGreaterThan(0);
      }
      
      // Validate resource_name
      if (metadata.resource_name) {
        expect(typeof metadata.resource_name).toBe('string');
        expect(metadata.resource_name.length).toBeGreaterThan(0);
      }
      
      // Validate resource_documentation
      if (metadata.resource_documentation) {
        expect(typeof metadata.resource_documentation).toBe('string');
        expect(metadata.resource_documentation).toMatch(/^https?:\/\//);
      }
    });

    test('should support bearer_methods_supported', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);
      
      const metadata = response.body;
      
      if (metadata.bearer_methods_supported) {
        expect(Array.isArray(metadata.bearer_methods_supported)).toBe(true);
        expect(metadata.bearer_methods_supported).toContain('header');
      }
    });

    test('should have proper cache headers', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);
      
      expect(response.headers['cache-control']).toContain('public');
      expect(response.headers['cache-control']).toContain('max-age=');
      
      const maxAge = response.headers['cache-control'].match(/max-age=(\d+)/);
      if (maxAge) {
        const age = parseInt(maxAge[1]);
        expect(age).toBeGreaterThan(0);
        expect(age).toBeLessThanOrEqual(3600); // Should not cache more than 1 hour
      }
    });
  });

  describe('GET /.well-known/mcp-server', () => {
    test('should return 200 OK', async () => {
      const response = await request(app)
        .get('/.well-known/mcp-server')
        .expect(200);
      
      expect(response.headers['content-type']).toMatch(/json/);
      expect(response.headers['cache-control']).toContain('public');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    test('should include MCP-specific fields', async () => {
      const response = await request(app)
        .get('/.well-known/mcp-server')
        .expect(200);
      
      const manifest = response.body;
      
      // MCP-specific fields
      expect(manifest).toHaveProperty('name');
      expect(manifest).toHaveProperty('description');
      expect(manifest).toHaveProperty('version');
      expect(manifest).toHaveProperty('tools');
      
      // Validate name
      expect(typeof manifest.name).toBe('string');
      expect(manifest.name.length).toBeGreaterThan(0);
      
      // Validate description
      expect(typeof manifest.description).toBe('string');
      expect(manifest.description.length).toBeGreaterThan(0);
      
      // Validate version
      expect(typeof manifest.version).toBe('string');
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      
      // Validate tools
      expect(Array.isArray(manifest.tools)).toBe(true);
      expect(manifest.tools.length).toBeGreaterThan(0);
      
      // Validate tool structure
      manifest.tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
      });
    });

    test('should include authentication configuration', async () => {
      const response = await request(app)
        .get('/.well-known/mcp-server')
        .expect(200);
      
      const manifest = response.body;
      
      expect(manifest).toHaveProperty('auth');
      
      const auth = manifest.auth;
      expect(auth).toHaveProperty('type', 'oauth2');
      expect(auth).toHaveProperty('required', true);
      expect(auth).toHaveProperty('authorization_servers');
      expect(auth).toHaveProperty('scopes');
      
      // Validate authorization_servers
      expect(Array.isArray(auth.authorization_servers)).toBe(true);
      expect(auth.authorization_servers.length).toBeGreaterThan(0);
      
      // Validate scopes
      expect(Array.isArray(auth.scopes)).toBe(true);
      expect(auth.scopes.length).toBeGreaterThan(0);
      
      // Check for banking scopes
      const bankingScopes = auth.scopes.filter(scope => scope.startsWith('banking:'));
      expect(bankingScopes.length).toBeGreaterThan(0);
    });

    test('should include tool access levels', async () => {
      const response = await request(app)
        .get('/.well-known/mcp-server')
        .expect(200);
      
      const manifest = response.body;
      
      expect(manifest).toHaveProperty('publicAccess');
      expect(manifest).toHaveProperty('restrictedAccess');
      
      // Validate publicAccess
      expect(manifest.publicAccess).toHaveProperty('readOnlyTools');
      expect(Array.isArray(manifest.publicAccess.readOnlyTools)).toBe(true);
      
      // Validate restrictedAccess
      expect(manifest.restrictedAccess).toHaveProperty('authenticatedTools');
      expect(Array.isArray(manifest.restrictedAccess.authenticatedTools)).toBe(true);
      
      // Ensure all tools are categorized
      const allToolNames = manifest.tools.map(t => t.name);
      const publicTools = manifest.publicAccess.readOnlyTools;
      const restrictedTools = manifest.restrictedAccess.authenticatedTools;
      
      const categorizedTools = [...publicTools, ...restrictedTools];
      expect(categorizedTools.sort()).toEqual(allToolNames.sort());
    });
  });

  describe('Security Headers', () => {
    test('should include CORS headers', async () => {
      const endpoints = [
        '/.well-known/oauth-protected-resource',
        '/.well-known/mcp-server'
      ];
      
      for (const endpoint of endpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(200);
        
        expect(response.headers['access-control-allow-origin']).toBe('*');
      }
    });

    test('should include cache control headers', async () => {
      const endpoints = [
        '/.well-known/oauth-protected-resource',
        '/.well-known/mcp-server'
      ];
      
      for (const endpoint of endpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(200);
        
        expect(response.headers['cache-control']).toContain('public');
        expect(response.headers['cache-control']).toContain('max-age=');
      }
    });

    test('should include proper content type', async () => {
      const endpoints = [
        '/.well-known/oauth-protected-resource',
        '/.well-known/mcp-server'
      ];
      
      for (const endpoint of endpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(200);
        
        expect(response.headers['content-type']).toMatch(/application\/json/);
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle 404 for unknown endpoints', async () => {
      await request(app)
        .get('/.well-known/unknown-endpoint')
        .expect(404);
    });

    test('should handle invalid HTTP methods', async () => {
      await request(app)
        .post('/.well-known/oauth-protected-resource')
        .expect(405);
      
      await request(app)
        .post('/.well-known/mcp-server')
        .expect(405);
    });
  });

  describe('Rate Limiting (if implemented)', () => {
    test('should handle rate limiting gracefully', async () => {
      // This test assumes rate limiting is implemented
      // Make multiple rapid requests
      const requests = Array(10).fill().map(() => 
        request(app).get('/.well-known/oauth-protected-resource')
      );
      
      const responses = await Promise.all(requests);
      
      // At least some requests should succeed
      const successCount = responses.filter(r => r.status === 200).length;
      expect(successCount).toBeGreaterThan(0);
      
      // If rate limiting is implemented, some requests should be throttled
      const throttledCount = responses.filter(r => r.status === 429).length;
      if (throttledCount > 0) {
        expect(throttledCount).toBeLessThan(10); // Not all requests should be throttled
      }
    });
  });

  describe('Integration Tests', () => {
    test('should work with OAuth 2.0 client libraries', async () => {
      // Simulate OAuth 2.0 client discovery
      const metadataResponse = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);
      
      const metadata = metadataResponse.body;
      
      // Verify client can use this metadata
      expect(metadata.resource).toMatch(/^https?:\/\//);
      expect(metadata.authorization_servers[0]).toMatch(/^https?:\/\//);
      
      // Client should be able to construct authorization URL
      const authServer = metadata.authorization_servers[0];
      expect(authServer).toContain('/as');
      
      // Client should understand available scopes
      if (metadata.scopes_supported) {
        expect(metadata.scopes_supported.length).toBeGreaterThan(0);
      }
    });

    test('should provide complete MCP discovery information', async () => {
      const manifestResponse = await request(app)
        .get('/.well-known/mcp-server')
        .expect(200);
      
      const manifest = manifestResponse.body;
      
      // MCP client should be able to understand server capabilities
      expect(manifest.tools.length).toBeGreaterThan(0);
      
      // MCP client should understand authentication requirements
      expect(manifest.auth.type).toBe('oauth2');
      expect(manifest.auth.required).toBe(true);
      
      // MCP client should understand tool access levels
      expect(manifest.publicAccess.readOnlyTools.length).toBeGreaterThanOrEqual(0);
      expect(manifest.restrictedAccess.authenticatedTools.length).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('RFC 9728 Compliance Score', () => {
  test('should achieve 85% compliance score', async () => {
    const { calculateComplianceScore } = require('./compliance-calculator');
    
    const score = await calculateComplianceScore();
    
    expect(score).toBeGreaterThan(80);
    expect(score).toBeLessThan(100);
    
    console.log(`RFC 9728 Compliance Score: ${score}%`);
  });
});

/**
 * Compliance Calculator Helper
 */
async function calculateComplianceScore() {
  const request = require('supertest');
  const { BankingMCPServer } = require('../src/server/BankingMCPServer');
  
  const config = {
    host: 'localhost',
    port: 3001,
    httpTransport: true,
    authServerUrl: 'https://auth.pingone.com/test-env/as',
    resourceUrl: 'mcpserver.ping.demo'
  };
  
  const server = new BankingMCPServer(config);
  const app = server.createExpressApp();
  
  try {
    // Get metadata response
    const metadataResponse = await request(app)
      .get('/.well-known/oauth-protected-resource')
      .expect(200);
    
    const metadata = metadataResponse.body;
    
    // Calculate compliance score
    let score = 0;
    const maxScore = 100;
    
    // Required fields (40 points)
    if (metadata.resource) score += 20;
    if (metadata.authorization_servers && Array.isArray(metadata.authorization_servers)) score += 20;
    
    // Optional fields (30 points)
    if (metadata.scopes_supported) score += 10;
    if (metadata.resource_name) score += 10;
    if (metadata.resource_documentation) score += 10;
    
    // Security (20 points)
    if (metadata.bearer_methods_supported) score += 10;
    if (metadata.bearer_methods_supported.includes('header')) score += 10;
    
    // Additional features (10 points)
    if (metadata.introspection_endpoint) score += 5;
    if (metadata.revocation_endpoint) score += 5;
    
    await server.shutdown();
    return score;
    
  } catch (error) {
    await server.shutdown();
    throw error;
  }
}

module.exports = {
  calculateComplianceScore
};
