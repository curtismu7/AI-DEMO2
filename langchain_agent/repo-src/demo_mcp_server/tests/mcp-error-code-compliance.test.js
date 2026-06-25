/**
 * MCP Spec Error Code Compliance Test Suite
 * Tests for MCP 2025-11-25 specification compliance
 */

const request = require('supertest');
const { BankingMCPServer } = require('../src/server/BankingMCPServer');
const { MCPErrorCode } = require('../src/interfaces/mcp');

describe('MCP Spec Error Code Compliance Tests', () => {
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

  describe('HTTP Status Code Compliance', () => {
    describe('401 Unauthorized', () => {
      test('should return 401 when no token is provided', async () => {
        const response = await request(app)
          .post('/mcp')
          .send({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
          .expect(401);
        
        expect(response.headers['www-authenticate']).toContain('Bearer realm=');
        expect(response.headers['www-authenticate']).toContain('resource_metadata=');
        expect(response.body.error).toBe('unauthorized');
        expect(response.body.error_code).toBe(MCPErrorCode.UNAUTHORIZED);
      });

      test('should return 401 when invalid token is provided', async () => {
        const response = await request(app)
          .post('/mcp')
          .set('Authorization', 'Bearer invalid-token')
          .send({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
          .expect(401);
        
        expect(response.headers['www-authenticate']).toContain('Bearer realm=');
        expect(response.body.error).toBe('unauthorized');
        expect(response.body.error_code).toBe(MCPErrorCode.UNAUTHORIZED);
      });

      test('should include required scopes in WWW-Authenticate header', async () => {
        const response = await request(app)
          .post('/mcp')
          .send({ 
            jsonrpc: '2.0', 
            id: 1, 
            method: 'tools/call',
            params: { name: 'get_accounts' }
          })
          .expect(401);
        
        expect(response.headers['www-authenticate']).toContain('scope=');
        expect(response.body.required_scope).toBeDefined();
        expect(Array.isArray(response.body.required_scope.split(' '))).toBe(true);
      });

      test('should include resource_metadata in response', async () => {
        const response = await request(app)
          .post('/mcp')
          .send({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
          .expect(401);
        
        expect(response.body.resource_metadata).toContain('.well-known/oauth-protected-resource');
      });
    });

    describe('403 Forbidden/Insufficient Scope', () => {
      test('should return 403 when token lacks required scope', async () => {
        // Mock token with only read scope, trying to access write operation
        const readOnlyToken = await getMockToken(['accounts:read']);
        
        const response = await request(app)
          .post('/mcp')
          .set('Authorization', `Bearer ${readOnlyToken}`)
          .send({ 
            jsonrpc: '2.0', 
            id: 1, 
            method: 'tools/call',
            params: { name: 'create_transaction' }
          })
          .expect(403);
        
        expect(response.headers['www-authenticate']).toContain('error="insufficient_scope"');
        expect(response.body.error).toBe('insufficient_scope');
        expect(response.body.error_code).toBe(MCPErrorCode.INSUFFICIENT_SCOPE);
      });

      test('should specify required scopes in response', async () => {
        const readOnlyToken = await getMockToken(['accounts:read']);
        
        const response = await request(app)
          .post('/mcp')
          .set('Authorization', `Bearer ${readOnlyToken}`)
          .send({ 
            jsonrpc: '2.0', 
            id: 1, 
            method: 'tools/call',
            params: { name: 'create_transaction' }
          })
          .expect(403);
        
        expect(response.body.required_scope).toContain('write');
        expect(response.body.error_description).toContain('required scope(s)');
      });

      test('should include proper WWW-Authenticate format', async () => {
        const readOnlyToken = await getMockToken(['accounts:read']);
        
        const response = await request(app)
          .post('/mcp')
          .set('Authorization', `Bearer ${readOnlyToken}`)
          .send({ 
            jsonrpc: '2.0', 
            id: 1, 
            method: 'tools/call',
            params: { name: 'create_transaction' }
          })
          .expect(403);
        
        const wwwAuth = response.headers['www-authenticate'];
        expect(wwwAuth).toContain('Bearer realm=');
        expect(wwwAuth).toContain('error="insufficient_scope"');
        expect(wwwAuth).toContain('scope=');
        expect(wwwAuth).toContain('resource_metadata=');
      });
    });
  });

  describe('JSON-RPC Error Code Compliance', () => {
    describe('Standard JSON-RPC Errors', () => {
      test('should return parse error for invalid JSON', async () => {
        const response = await request(app)
          .post('/mcp')
          .send('invalid json')
          .expect(400);
        
        expect(response.body.error.code).toBe(MCPErrorCode.PARSE_ERROR);
        expect(response.body.error.message).toContain('Parse error');
        expect(response.body.error.data.type).toBe('json_rpc');
      });

      test('should return invalid request for malformed JSON-RPC', async () => {
        const response = await request(app)
          .post('/mcp')
          .send({ jsonrpc: '1.0', id: 1, method: 'tools/call' })
          .expect(400);
        
        expect(response.body.error.code).toBe(MCPErrorCode.INVALID_REQUEST);
        expect(response.body.error.message).toContain('Invalid Request');
      });

      test('should return method not found for unknown method', async () => {
        const token = await getMockToken(['accounts:read']);
        
        const response = await request(app)
          .post('/mcp')
          .set('Authorization', `Bearer ${token}`)
          .send({ jsonrpc: '2.0', id: 1, method: 'unknown_method' })
          .expect(404);
        
        expect(response.body.error.code).toBe(MCPErrorCode.METHOD_NOT_FOUND);
        expect(response.body.error.message).toContain('Method not found');
      });

      test('should return invalid params for missing parameters', async () => {
        const token = await getMockToken(['accounts:read']);
        
        const response = await request(app)
          .post('/mcp')
          .set('Authorization', `Bearer ${token}`)
          .send({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
          .expect(400);
        
        expect(response.body.error.code).toBe(MCPErrorCode.INVALID_PARAMS);
        expect(response.body.error.message).toContain('Invalid params');
      });
    });

    describe('MCP-Specific Errors', () => {
      test('should return tool not found for unknown tool', async () => {
        const token = await getMockToken(['accounts:read']);
        
        const response = await request(app)
          .post('/mcp')
          .set('Authorization', `Bearer ${token}`)
          .send({ 
            jsonrpc: '2.0', 
            id: 1, 
            method: 'tools/call',
            params: { name: 'unknown_tool' }
          })
          .expect(404);
        
        expect(response.body.error.code).toBe(MCPErrorCode.TOOL_NOT_FOUND);
        expect(response.body.error.message).toContain('Tool not found');
      });

      test('should return token expired for expired token', async () => {
        const expiredToken = await getMockToken(['accounts:read'], true); // expired
        
        const response = await request(app)
          .post('/mcp')
          .set('Authorization', `Bearer ${expiredToken}`)
          .send({ 
            jsonrpc: '2.0', 
            id: 1, 
            method: 'tools/call',
            params: { name: 'get_accounts' }
          })
          .expect(401);
        
        expect(response.body.error_code).toBe(MCPErrorCode.TOKEN_EXPIRED);
        expect(response.body.error_description).toContain('expired');
      });
    });
  });

  describe('Banking-Specific Errors', () => {
    test('should return account not found for invalid account', async () => {
      const token = await getMockToken(['accounts:read']);
      
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({ 
          jsonrpc: '2.0', 
          id: 1, 
          method: 'tools/call',
          params: { 
            name: 'get_account_balance',
            arguments: { account_id: 'invalid-account-id' }
          }
        })
        .expect(404);
      
      expect(response.body.error.code).toBe(MCPErrorCode.ACCOUNT_NOT_FOUND);
      expect(response.body.error.message).toContain('Account not found');
    });

    test('should return insufficient funds for overdraft attempt', async () => {
      const token = await getMockToken(['write']);
      
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({ 
          jsonrpc: '2.0', 
          id: 1, 
          method: 'tools/call',
          params: { 
            name: 'create_transaction',
            arguments: { 
              amount: 999999, // Very large amount
              account_id: 'test-account'
            }
          }
        })
        .expect(400);
      
      expect(response.body.error.code).toBe(MCPErrorCode.INSUFFICIENT_FUNDS);
      expect(response.body.error.message).toContain('Insufficient funds');
    });

    test('should return invalid amount for negative amounts', async () => {
      const token = await getMockToken(['write']);
      
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({ 
          jsonrpc: '2.0', 
          id: 1, 
          method: 'tools/call',
          params: { 
            name: 'create_transaction',
            arguments: { 
              amount: -100, // Negative amount
              account_id: 'test-account'
            }
          }
        })
        .expect(400);
      
      expect(response.body.error.code).toBe(MCPErrorCode.INVALID_AMOUNT);
      expect(response.body.error.message).toContain('Invalid amount');
    });
  });

  describe('Error Response Format Compliance', () => {
    test('should include all required fields in error response', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
        .expect(401);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('data');
      expect(response.body.error.data).toHaveProperty('type');
      expect(response.body.error.data).toHaveProperty('timestamp');
    });

    test('should include structured error data', async () => {
      const response = await request(app)
        .post('/mcp')
        .send('invalid json')
        .expect(400);
      
      expect(response.body.error.data.type).toBe('json_rpc');
      expect(response.body.error.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      expect(response.body.error.data.server).toBe('Demo MCP Server');
    });

    test('should include request ID in error response when provided', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 'test-request-123', method: 'unknown_method' })
        .expect(404);
      
      expect(response.body.id).toBe('test-request-123');
      expect(response.body.error.data.requestId).toBe('test-request-123');
    });
  });

  describe('Error Code to HTTP Status Mapping', () => {
    test('should map parse error to 400', async () => {
      const response = await request(app)
        .post('/mcp')
        .send('invalid json')
        .expect(400);
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(MCPErrorCode.PARSE_ERROR);
    });

    test('should map method not found to 404', async () => {
      const token = await getMockToken(['accounts:read']);
      
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({ jsonrpc: '2.0', id: 1, method: 'unknown_method' })
        .expect(404);
      
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe(MCPErrorCode.METHOD_NOT_FOUND);
    });

    test('should map insufficient scope to 403', async () => {
      const readOnlyToken = await getMockToken(['accounts:read']);
      
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ 
          jsonrpc: '2.0', 
          id: 1, 
          method: 'tools/call',
          params: { name: 'create_transaction' }
        })
        .expect(403);
      
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(MCPErrorCode.INSUFFICIENT_SCOPE);
    });

    test('should map internal error to 500', async () => {
      // This would require mocking an internal error
      const response = await request(app)
        .post('/mcp')
        .send({ 
          jsonrpc: '2.0', 
          id: 1, 
          method: 'tools/call',
          params: { name: 'trigger_internal_error' }
        })
        .expect(500);
      
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe(MCPErrorCode.INTERNAL_ERROR);
    });
  });

  describe('WWW-Authenticate Header Compliance', () => {
    test('should include proper Bearer realm format', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
        .expect(401);
      
      const wwwAuth = response.headers['www-authenticate'];
      expect(wwwAuth).toMatch(/^Bearer realm="[^"]+"/);
    });

    test('should include error parameter in 403 response', async () => {
      const readOnlyToken = await getMockToken(['accounts:read']);
      
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ 
          jsonrpc: '2.0', 
          id: 1, 
          method: 'tools/call',
          params: { name: 'create_transaction' }
        })
        .expect(403);
      
      const wwwAuth = response.headers['www-authenticate'];
      expect(wwwAuth).toContain('error="insufficient_scope"');
    });

    test('should include scope parameter when scopes are required', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({ 
          jsonrpc: '2.0', 
          id: 1, 
          method: 'tools/call',
          params: { name: 'get_accounts' }
        })
        .expect(401);
      
      const wwwAuth = response.headers['www-authenticate'];
      expect(wwwAuth).toContain('scope=');
    });

    test('should include resource_metadata parameter', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
        .expect(401);
      
      const wwwAuth = response.headers['www-authenticate'];
      expect(wwwAuth).toContain('resource_metadata=');
      expect(wwwAuth).toContain('.well-known/oauth-protected-resource');
    });
  });
});

/**
 * Helper Functions
 */

async function getMockToken(scopes = ['accounts:read'], expired = false) {
  // Mock token generation for testing
  const payload = {
    sub: 'test-user',
    exp: expired ? Math.floor(Date.now() / 1000) - 3600 : Math.floor(Date.now() / 1000) + 3600,
    scope: scopes.join(' '),
    client_id: 'test-client',
    iss: 'https://auth.pingone.com/test-env/as'
  };
  
  return `mock.jwt.token.${btoa(JSON.stringify(payload))}`;
}

describe('MCP Spec Compliance Score Calculation', () => {
  test('should achieve 95%+ compliance score', async () => {
    const { calculateComplianceScore } = require('./compliance-calculator');
    
    const score = await calculateComplianceScore();
    
    expect(score).toBeGreaterThan(95);
    expect(score).toBeLessThan(100);
    
    console.log(`MCP Spec Compliance Score: ${score}%`);
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
    let score = 0;
    const maxScore = 100;
    
    // Test HTTP error codes (30 points)
    try {
      await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/call' }).expect(401);
      score += 10; // 401 compliance
    } catch (e) {
      // 401 not compliant
    }
    
    try {
      const readOnlyToken = await getMockToken(['accounts:read']);
      await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_transaction' } })
        .expect(403);
      score += 10; // 403 compliance
    } catch (e) {
      // 403 not compliant
    }
    
    // Test JSON-RPC error codes (30 points)
    try {
      await request(app).post('/mcp').send('invalid json').expect(400);
      score += 6; // Parse error
    } catch (e) {
      // Parse error not compliant
    }
    
    try {
      await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'unknown_method' }).expect(404);
      score += 6; // Method not found
    } catch (e) {
      // Method not found not compliant
    }
    
    try {
      await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/call' }).expect(400);
      score += 6; // Invalid params
    } catch (e) {
      // Invalid params not compliant
    }
    
    // Test error response format (20 points)
    try {
      const response = await request(app).post('/mcp').send('invalid json');
      if (response.body.error && response.body.error.data && response.body.error.data.type) {
        score += 10; // Error response format
      }
    } catch (e) {
      // Error response format not compliant
    }
    
    // Test WWW-Authenticate headers (20 points)
    try {
      const response = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/call' });
      if (response.headers['www-authenticate'] && response.headers['www-authenticate'].includes('Bearer realm=')) {
        score += 10; // WWW-Authenticate format
      }
    } catch (e) {
      // WWW-Authenticate not compliant
    }
    
    await server.shutdown();
    return score;
    
  } catch (error) {
    await server.shutdown();
    throw error;
  }
}

module.exports = {
  calculateComplianceScore,
  getMockToken
};
