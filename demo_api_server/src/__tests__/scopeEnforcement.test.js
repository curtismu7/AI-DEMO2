/**
 * Tests for Scope Enforcement Middleware
 */

const jwt = require('jsonwebtoken');
const {
  requireScopes,
  checkScopes,
  parseScopes,
  extractScopesFromToken,
  Scopes,
  ScopeMiddleware
} = require('../../middleware/scopeEnforcement');

jest.mock('jsonwebtoken');
jest.mock('../../utils/logger', () => {
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger: mockLogger, LOG_LEVELS: {}, LOG_CATEGORIES: {} };
});

describe('Scope Enforcement Middleware', () => {
  describe('parseScopes', () => {
    it('should parse space-separated scopes', () => {
      const result = parseScopes('openid profile email');
      expect(result).toEqual(['openid', 'profile', 'email']);
    });

    it('should handle single scope', () => {
      const result = parseScopes('openid');
      expect(result).toEqual(['openid']);
    });

    it('should handle empty string', () => {
      const result = parseScopes('');
      expect(result).toEqual([]);
    });

    it('should handle null/undefined', () => {
      expect(parseScopes(null)).toEqual([]);
      expect(parseScopes(undefined)).toEqual([]);
    });

    it('should filter out empty strings', () => {
      const result = parseScopes('openid  profile   email');
      expect(result).toEqual(['openid', 'profile', 'email']);
    });
  });

  describe('checkScopes', () => {
    it('should allow access when all required scopes present (requireAll=true)', () => {
      const tokenScopes = ['openid', 'profile', 'email', 'read'];
      const requiredScopes = ['openid', 'profile'];

      const result = checkScopes(tokenScopes, requiredScopes, true);

      expect(result.hasAccess).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should deny access when missing scopes (requireAll=true)', () => {
      const tokenScopes = ['openid', 'profile'];
      const requiredScopes = ['openid', 'profile', 'email'];

      const result = checkScopes(tokenScopes, requiredScopes, true);

      expect(result.hasAccess).toBe(false);
      expect(result.missing).toEqual(['email']);
    });

    it('should allow access when any required scope present (requireAll=false)', () => {
      const tokenScopes = ['openid', 'profile'];
      const requiredScopes = ['email', 'profile', 'admin:read'];

      const result = checkScopes(tokenScopes, requiredScopes, false);

      expect(result.hasAccess).toBe(true);
      expect(result.missing).toEqual(['email', 'admin:read']);
    });

    it('should deny access when no required scopes present (requireAll=false)', () => {
      const tokenScopes = ['openid', 'profile'];
      const requiredScopes = ['admin:read', 'write'];

      const result = checkScopes(tokenScopes, requiredScopes, false);

      expect(result.hasAccess).toBe(false);
      expect(result.missing).toEqual(['admin:read', 'write']);
    });
  });

  describe('extractScopesFromToken', () => {
    it('should extract scopes from valid token', () => {
      const mockToken = 'mock.jwt.token';
      jwt.decode.mockReturnValue({
        sub: 'user123',
        scope: 'openid profile email read'
      });

      const result = extractScopesFromToken(mockToken);

      expect(result).toEqual(['openid', 'profile', 'email', 'read']);
    });

    it('should return empty array if no scope claim', () => {
      jwt.decode.mockReturnValue({
        sub: 'user123'
      });

      const result = extractScopesFromToken('mock.token');

      expect(result).toEqual([]);
    });

    it('should return empty array if token decode fails', () => {
      jwt.decode.mockReturnValue(null);

      const result = extractScopesFromToken('invalid.token');

      expect(result).toEqual([]);
    });

    it('should handle decode errors gracefully', () => {
      jwt.decode.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const result = extractScopesFromToken('bad.token');

      expect(result).toEqual([]);
    });
  });

  describe('requireScopes middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        headers: {
          authorization: 'Bearer mock.jwt.token'
        },
        path: '/api/accounts',
        method: 'GET'
      };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      next = jest.fn();
    });

    it('should allow access with required scope', () => {
      jwt.decode.mockReturnValue({
        scope: 'openid profile read'
      });

      const middleware = requireScopes('read');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.tokenScopes).toEqual(['openid', 'profile', 'read']);
    });

    it('should deny access without required scope', () => {
      jwt.decode.mockReturnValue({
        scope: 'openid profile'
      });

      const middleware = requireScopes('write');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_SCOPE'
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should deny access if no token provided', () => {
      req.headers.authorization = null;

      const middleware = requireScopes('read');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication required',
          code: 'NO_TOKEN'
        })
      );
    });

    it('should handle array of required scopes (requireAll=true)', () => {
      jwt.decode.mockReturnValue({
        scope: 'openid profile read write'
      });

      const middleware = requireScopes(['read', 'write'], { requireAll: true });
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny if missing any scope (requireAll=true)', () => {
      jwt.decode.mockReturnValue({
        scope: 'openid profile read'
      });

      const middleware = requireScopes(['read', 'write'], { requireAll: true });
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          missing: ['write']
        })
      );
    });

    it('should allow if any scope present (requireAll=false)', () => {
      jwt.decode.mockReturnValue({
        scope: 'openid profile admin:read'
      });

      const middleware = requireScopes(['read', 'admin:read'], { requireAll: false });
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should handle malformed authorization header', () => {
      req.headers.authorization = 'InvalidFormat';

      const middleware = requireScopes('read');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('Scopes constants', () => {
    it('should have all expected scope definitions', () => {
      expect(Scopes.READ).toBe('read');
      expect(Scopes.WRITE).toBe('write');
      expect(Scopes.ADMIN).toBe('admin');
      expect(Scopes.SENSITIVE).toBe('sensitive');
      expect(Scopes.AI_AGENT).toBe('ai:agent');
      expect(Scopes.MCP_INVOKE).toBe('mcp:invoke');
    });
  });

  describe('ScopeMiddleware presets', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        headers: {
          authorization: 'Bearer mock.token'
        },
        path: '/api/test'
      };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      next = jest.fn();
    });

    it('should have readAccounts middleware', () => {
      jwt.decode.mockReturnValue({
        scope: 'read'
      });

      ScopeMiddleware.readAccounts(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should have writeAccounts middleware', () => {
      jwt.decode.mockReturnValue({
        scope: 'write'
      });

      ScopeMiddleware.writeAccounts(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should have adminOnly middleware', () => {
      jwt.decode.mockReturnValue({
        scope: 'admin'
      });

      ScopeMiddleware.adminOnly(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should have mcpTools middleware', () => {
      jwt.decode.mockReturnValue({
        scope: 'mcp:invoke'
      });

      ScopeMiddleware.mcpTools(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
