/**
 * Test Token Scenarios Test Suite
 * Comprehensive tests for token validation demonstration scenarios
 * 
 * Phase 158: Add Token Validation Test Scenarios
 */

const {
  generateTestToken,
  generateWrongScopeToken,
  generateWrongAudToken,
  generateMissingActToken,
  generateAgentToken,
  generateExpiredToken,
  decodeTestToken,
  TEST_SECRET
} = require('../../middleware/testTokenGenerator');

describe('Token Test Scenarios - Token Generator', () => {
  
  describe('generateTestToken base function', () => {
    it('should generate a valid JWT token', () => {
      const token = generateTestToken();
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);  // JWT has 3 parts
    });

    it('should generate token with correct structure', () => {
      const token = generateTestToken({
        sub: 'test-user',
        aud: 'test-audience',
        scope: ['scope1', 'scope2']
      });
      
      const decoded = decodeTestToken(token);
      expect(decoded.sub).toBe('test-user');
      expect(decoded.aud).toBe('test-audience');
      expect(decoded.scope).toBe('scope1 scope2');  // Scopes joined with space
    });

    it('should include _test_token marker', () => {
      const token = generateTestToken();
      const decoded = decodeTestToken(token);
      expect(decoded._test_token).toBe(true);
    });

    it('should set expiration correctly', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = generateTestToken({ expiresIn: 7200 });
      const decoded = decodeTestToken(token);
      
      expect(decoded.exp).toBeGreaterThan(now);
      expect(decoded.exp).toBeLessThanOrEqual(now + 7200 + 1);  // +1 for rounding
    });

    it('should support custom expiration time', () => {
      const fixedExp = Math.floor(Date.now() / 1000) + 5000;
      const token = generateTestToken({ exp: fixedExp });
      const decoded = decodeTestToken(token);
      
      expect(decoded.exp).toBe(fixedExp);
    });

    it('should support RFC 8693 act claim', () => {
      const actClaim = {
        client_id: 'mcp-agent',
        sub: 'user-123'
      };
      const token = generateTestToken({ act: actClaim });
      const decoded = decodeTestToken(token);
      
      expect(decoded.act).toEqual(actClaim);
    });
  });

  describe('Scenario 1: Wrong Scope Token', () => {
    it('should generate token without agent scopes', () => {
      const token = generateWrongScopeToken();
      const decoded = decodeTestToken(token);
      
      expect(decoded).toBeTruthy();
      const scopes = decoded.scope.split(' ');
      
      expect(scopes).toContain('profile');
      expect(scopes).toContain('email');
      expect(scopes).not.toContain('agent:invoke');
      expect(scopes).not.toContain('mcp:invoke');
    });

    it('should have valid structure but wrong scopes', () => {
      const token = generateWrongScopeToken();
      const decoded = decodeTestToken(token);
      
      expect(decoded.sub).toBeTruthy();
      expect(decoded.aud).toBe('https://mcp-server.banking-demo.com');
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('Scenario 2: Wrong Audience Token', () => {
    it('should generate token with wrong audience', () => {
      const token = generateWrongAudToken();
      const decoded = decodeTestToken(token);
      
      expect(decoded.aud).toBe('https://banking-bff.banking-demo.com');  // BFF instead of MCP
      expect(decoded.aud).not.toBe('https://mcp-server.banking-demo.com');
    });

    it('should have correct scopes but wrong audience', () => {
      const token = generateWrongAudToken();
      const decoded = decodeTestToken(token);

      const scopes = decoded.scope.split(' ');
      // generateWrongAudToken uses ['read', 'write', 'agent'] — 'agent' not 'agent:invoke'
      expect(scopes).toContain('agent');
      expect(decoded.aud).not.toMatch(/mcp/i);
    });
  });

  describe('Scenario 3: Missing Act Token', () => {
    it('should generate token without act claim', () => {
      const token = generateMissingActToken();
      const decoded = decodeTestToken(token);
      
      expect(decoded.act).toBeUndefined();
    });

    it('should have valid auth but no delegation', () => {
      const token = generateMissingActToken();
      const decoded = decodeTestToken(token);
      
      expect(decoded.sub).toBeTruthy();
      expect(decoded.scope).toBeTruthy();
      expect(decoded.act).toBeUndefined();
    });
  });

  describe('Scenario 4: Agent Token', () => {
    it('should generate token with agent-only scopes', () => {
      const token = generateAgentToken();
      const decoded = decodeTestToken(token);

      const scopes = decoded.scope.split(' ');
      // generateAgentToken uses ['agent', 'mcp:invoke'] — 'agent' not 'agent:invoke'
      expect(scopes).toContain('agent');
      expect(scopes).toContain('mcp:invoke');
      expect(scopes).not.toContain('read');
      expect(scopes).not.toContain('write');
    });

    it('should include act claim with agent delegation', () => {
      const token = generateAgentToken();
      const decoded = decodeTestToken(token);
      
      expect(decoded.act).toBeTruthy();
      expect(decoded.act.client_id).toBe('mcp-agent');
      expect(decoded.act.sub).toBe('test-user-123');
    });
  });

  describe('Scenario 5: Expired Token', () => {
    it('should generate token with past expiration', () => {
      const token = generateExpiredToken();
      const decoded = decodeTestToken(token);
      const now = Math.floor(Date.now() / 1000);
      
      expect(decoded.exp).toBeLessThan(now);
    });

    it('should be expired by at least 15 minutes', () => {
      const token = generateExpiredToken();
      const decoded = decodeTestToken(token);
      const now = Math.floor(Date.now() / 1000);
      
      expect(now - decoded.exp).toBeGreaterThanOrEqual(900);  // At least 15 minutes
    });

    it('should be a valid JWT otherwise', () => {
      const token = generateExpiredToken();
      const decoded = decodeTestToken(token);
      
      expect(decoded.sub).toBeTruthy();
      expect(decoded.aud).toBeTruthy();
      expect(decoded.scope).toBeTruthy();
    });
  });

});

describe('Token Decoding and Validation', () => {
  
  it('should decode test token correctly', () => {
    const token = generateTestToken({
      sub: 'user-xyz',
      aud: 'audience-xyz',
      scope: ['scope:one', 'scope:two']
    });
    
    const decoded = decodeTestToken(token);
    expect(decoded.sub).toBe('user-xyz');
    expect(decoded.aud).toBe('audience-xyz');
    expect(decoded.scope).toBe('scope:one scope:two');
  });

  it('should return null for invalid token', () => {
    const decoded = decodeTestToken('invalid.jwt.token');
    expect(decoded).toBeNull();
  });

  it('should handle empty token gracefully', () => {
    const decoded = decodeTestToken('');
    expect(decoded).toBeNull();
  });

  it('should extract all standard claims', () => {
    const token = generateTestToken();
    const decoded = decodeTestToken(token);
    
    expect(decoded.sub).toBeTruthy();
    expect(decoded.aud).toBeTruthy();
    expect(decoded.scope).toBeTruthy();
    expect(decoded.iat).toBeTruthy();
    expect(decoded.exp).toBeTruthy();
    expect(decoded.jti).toBeTruthy();
  });

});

describe('Scope Formatting', () => {
  
  it('should format scopes as space-separated string', () => {
    const token = generateTestToken({
      scope: ['scope1', 'scope2', 'scope3']
    });
    
    const decoded = decodeTestToken(token);
    expect(decoded.scope).toBe('scope1 scope2 scope3');
  });

  it('should handle single scope', () => {
    const token = generateTestToken({
      scope: ['single-scope']
    });
    
    const decoded = decodeTestToken(token);
    expect(decoded.scope).toBe('single-scope');
  });

  it('should handle empty scope array', () => {
    const token = generateTestToken({
      scope: []
    });
    
    const decoded = decodeTestToken(token);
    expect(decoded.scope).toBe('');
  });

});

describe('JWT Structure Validation', () => {
  
  it('should generate tokens with proper JWT structure', () => {
    const token = generateTestToken();
    const parts = token.split('.');
    
    expect(parts.length).toBe(3);  // Header.Payload.Signature
    
    // Header should be valid Base64
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
  });

  it('should include jti claim in each token', () => {
    const token = generateTestToken();
    const decoded = decodeTestToken(token);
    
    expect(decoded.jti).toBeTruthy();
    expect(typeof decoded.jti).toBe('string');
  });

});
