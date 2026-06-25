const {
  parseTokenScopes,
  hasRequiredScopes,
  requireScopes,
  ROUTE_SCOPE_MAP
} = require('../../middleware/auth');

// Helper function to create test tokens without JWT library
const createTestToken = (payload) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'test-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

describe('Scope-based Authorization', () => {
  describe('parseTokenScopes', () => {
    it('should parse scopes from string format', () => {
      const token = createTestToken({ scope: 'read write admin:read' });
      
      const scopes = parseTokenScopes(token);
      expect(scopes).toEqual(['read', 'write', 'admin:read']);
    });

    it('should parse scopes from array format', () => {
      const token = createTestToken({ scope: ['read', 'write', 'admin:read'] });
      
      const scopes = parseTokenScopes(token);
      expect(scopes).toEqual(['read', 'write', 'admin:read']);
    });

    it('should handle empty scope string', () => {
      const token = createTestToken({ scope: '' });
      
      const scopes = parseTokenScopes(token);
      expect(scopes).toEqual([]);
    });

    it('should handle missing scope claim', () => {
      const token = createTestToken({ sub: 'user123' });
      
      const scopes = parseTokenScopes(token);
      expect(scopes).toEqual([]);
    });

    it('should filter out empty strings from scope array', () => {
      const token = createTestToken({ scope: 'read  write   ' });
      
      const scopes = parseTokenScopes(token);
      expect(scopes).toEqual(['read', 'write']);
    });

    it('should handle invalid token gracefully', () => {
      const scopes = parseTokenScopes('invalid-token');
      expect(scopes).toEqual([]);
    });
  });

  describe('hasRequiredScopes', () => {
    const userScopes = ['read', 'write'];

    it('should return true when user has required scope (OR logic)', () => {
      const result = hasRequiredScopes(userScopes, ['read'], false);
      expect(result).toBe(true);
    });

    it('should return true when user has any of the required scopes (OR logic)', () => {
      const result = hasRequiredScopes(userScopes, ['admin:read', 'read'], false);
      expect(result).toBe(true);
    });

    it('should return false when user lacks all required scopes (OR logic)', () => {
      const result = hasRequiredScopes(userScopes, ['admin:read', 'sensitive:read'], false);
      expect(result).toBe(false);
    });

    it('should return true when user has all required scopes (AND logic)', () => {
      const result = hasRequiredScopes(userScopes, ['read'], true);
      expect(result).toBe(true);
    });

    it('should return false when user lacks some required scopes (AND logic)', () => {
      const result = hasRequiredScopes(userScopes, ['read', 'admin:read'], true);
      expect(result).toBe(false);
    });

    it('should return true when no scopes are required', () => {
      const result = hasRequiredScopes(userScopes, [], false);
      expect(result).toBe(true);
    });

    it('should handle invalid input gracefully', () => {
      expect(hasRequiredScopes(null, ['read'], false)).toBe(false);
      expect(hasRequiredScopes(userScopes, null, false)).toBe(false);
      expect(hasRequiredScopes('invalid', ['read'], false)).toBe(false);
      expect(hasRequiredScopes(userScopes, 'invalid', false)).toBe(false);
    });
  });

  describe('requireScopes middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        user: {
          id: 'user123',
          username: 'testuser',
          tokenType: 'oauth',
          scopes: ['read']
        }
      };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      next = jest.fn();
    });

    it('should call next() when user has required scope', () => {
      const middleware = requireScopes(['read']);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() when user has any of the required scopes (OR logic)', () => {
      const middleware = requireScopes(['admin:read', 'read']);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 when user lacks required scopes', () => {
      const middleware = requireScopes(['admin:read']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'insufficient_scope',
        error_description: expect.stringContaining('admin:read'),
        requiredScopes: ['admin:read'],
        providedScopes: ['read']
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', () => {
      req.user = null;
      const middleware = requireScopes(['read']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'authentication_required',
        error_description: 'Authentication required to access this resource'
      }));
      expect(next).not.toHaveBeenCalled();
    });



    it('should handle single scope string parameter', () => {
      const middleware = requireScopes('read');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should support AND logic when requireAll is true', () => {
      req.user.scopes = ['read'];
      const middleware = requireScopes(['read'], true);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 with AND logic when user lacks some required scopes', () => {
      req.user.scopes = ['read'];
      const middleware = requireScopes(['read', 'admin:read'], true);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'insufficient_scope',
        error_description: expect.stringContaining('read, admin:read'),
        requiredScopes: ['read', 'admin:read'],
        providedScopes: ['read']
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle missing scopes in user object', () => {
      delete req.user.scopes;
      const middleware = requireScopes(['read']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'insufficient_scope',
        error_description: expect.stringContaining('read'),
        requiredScopes: ['read'],
        providedScopes: []
      }));
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('ROUTE_SCOPE_MAP configuration', () => {
    it('should define scopes for account routes', () => {
      expect(ROUTE_SCOPE_MAP['GET /api/accounts']).toEqual(['read']);
      expect(ROUTE_SCOPE_MAP['POST /api/accounts']).toEqual(['write']);
      expect(ROUTE_SCOPE_MAP['GET /api/accounts/my']).toEqual(['read']);
      expect(ROUTE_SCOPE_MAP['GET /api/accounts/:id/balance']).toEqual(['read']);
    });

    it('should define scopes for transaction routes', () => {
      expect(ROUTE_SCOPE_MAP['GET /api/transactions']).toEqual(['read']);
      expect(ROUTE_SCOPE_MAP['POST /api/transactions']).toEqual(['write']);
      expect(ROUTE_SCOPE_MAP['GET /api/transactions/my']).toEqual(['read']);
    });

    it('should define scopes for admin routes', () => {
      expect(ROUTE_SCOPE_MAP['GET /api/admin/*']).toEqual(['admin:read']);
      expect(ROUTE_SCOPE_MAP['POST /api/admin/*']).toEqual(['admin:read']);
      expect(ROUTE_SCOPE_MAP['PUT /api/admin/*']).toEqual(['admin:read']);
      expect(ROUTE_SCOPE_MAP['DELETE /api/admin/*']).toEqual(['admin:read']);
    });

    it('should define scopes for user routes', () => {
      expect(ROUTE_SCOPE_MAP['GET /api/users']).toEqual(['read']);
      expect(ROUTE_SCOPE_MAP['POST /api/users']).toEqual(['write']);
      expect(ROUTE_SCOPE_MAP['GET /api/users/me']).toEqual(['read']);
    });

    it('should define write scopes for modification operations', () => {
      expect(ROUTE_SCOPE_MAP['PUT /api/accounts/:id']).toEqual(['write']);
      expect(ROUTE_SCOPE_MAP['DELETE /api/accounts/:id']).toEqual(['write']);
      expect(ROUTE_SCOPE_MAP['PUT /api/transactions/:id']).toEqual(['write']);
      expect(ROUTE_SCOPE_MAP['DELETE /api/transactions/:id']).toEqual(['write']);
    });
  });

  describe('Integration scenarios', () => {
    it('should validate read scope allows access to account and transaction read operations', () => {
      const userScopes = ['read'];
      
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['GET /api/accounts'])).toBe(true);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['GET /api/transactions'])).toBe(true);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['GET /api/users/me'])).toBe(true);
      
      // Should not allow write operations
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['POST /api/accounts'])).toBe(false);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['POST /api/transactions'])).toBe(false);
    });

    it('should validate write scope allows write operations', () => {
      const userScopes = ['write'];
      
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['POST /api/accounts'])).toBe(true);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['POST /api/transactions'])).toBe(true);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['PUT /api/accounts/:id'])).toBe(true);
      
      // Should not allow admin operations
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['GET /api/admin/*'])).toBe(false);
    });

    it('should validate admin:read scope allows all operations', () => {
      const userScopes = ['admin:read'];
      
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['GET /api/admin/*'])).toBe(true);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['POST /api/admin/*'])).toBe(true);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['DELETE /api/admin/*'])).toBe(true);
    });

    it('should validate specific scopes for granular access control', () => {
      const userScopes = ['read', 'write'];
      
      // Should allow account read operations
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['GET /api/accounts'])).toBe(true);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['GET /api/accounts/my'])).toBe(true);
      
      // Should allow transaction write operations
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['POST /api/transactions'])).toBe(true);
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['PUT /api/transactions/:id'])).toBe(true);
      
      // Should allow general read access to transactions (needs read, user has read)
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['GET /api/transactions'])).toBe(true);
      
      // Should allow account write operations (needs write, user has write)
      expect(hasRequiredScopes(userScopes, ROUTE_SCOPE_MAP['POST /api/accounts'])).toBe(true);
    });
  });
});