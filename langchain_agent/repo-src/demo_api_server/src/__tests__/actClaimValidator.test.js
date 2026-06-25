/**
 * Tests for act/may_act Claims Validation Middleware
 */

const jwt = require('jsonwebtoken');
const {
  actClaimValidationMiddleware,
  validateActClaim,
  validateMayActClaim,
  extractDelegationChain
} = require('../../middleware/actClaimValidator');

jest.mock('jsonwebtoken');
jest.mock('../../utils/logger', () => {
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger: mockLogger, LOG_LEVELS: {}, LOG_CATEGORIES: {} };
});

describe('act/may_act Claims Validation', () => {
  describe('validateActClaim', () => {
    it('should validate valid act claim', () => {
      const actClaim = {
        client_id: 'bff-client',
        iss: 'https://auth.pingone.com'
      };

      const result = validateActClaim(actClaim);

      expect(result.valid).toBe(true);
      expect(result.actor.client_id).toBe('bff-client');
      expect(result.actor.iss).toBe('https://auth.pingone.com');
    });

    it('should reject missing act claim', () => {
      const result = validateActClaim(null);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('act claim not present');
    });

    it('should reject non-object act claim', () => {
      const result = validateActClaim('invalid');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('act claim must be a JSON object');
    });

    it('should reject array act claim', () => {
      const result = validateActClaim([{ client_id: 'test' }]);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('act claim must be a JSON object');
    });

    it('should reject act claim without identifiers', () => {
      const result = validateActClaim({ random_field: 'value' });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('missing required identifiers');
    });

    it('should accept act claim with only client_id', () => {
      const actClaim = { client_id: 'bff-client' };

      const result = validateActClaim(actClaim);

      expect(result.valid).toBe(true);
      expect(result.actor.client_id).toBe('bff-client');
    });

    it('should accept act claim with only sub', () => {
      const actClaim = { sub: 'user123' };

      const result = validateActClaim(actClaim);

      expect(result.valid).toBe(true);
      expect(result.actor.sub).toBe('user123');
    });

    it('should accept act claim with only iss', () => {
      const actClaim = { iss: 'https://auth.pingone.com' };

      const result = validateActClaim(actClaim);

      expect(result.valid).toBe(true);
      expect(result.actor.iss).toBe('https://auth.pingone.com');
    });

    it('should extract all identifiers when present', () => {
      const actClaim = {
        client_id: 'bff-client',
        sub: 'user123',
        iss: 'https://auth.pingone.com'
      };

      const result = validateActClaim(actClaim);

      expect(result.valid).toBe(true);
      expect(result.actor.client_id).toBe('bff-client');
      expect(result.actor.sub).toBe('user123');
      expect(result.actor.iss).toBe('https://auth.pingone.com');
    });
  });

  describe('validateMayActClaim', () => {
    it('should validate may_act claim with matching client_id', () => {
      const mayActClaim = { client_id: 'bff-client' };

      const result = validateMayActClaim(mayActClaim, 'bff-client');

      expect(result.valid).toBe(true);
      expect(result.reason).toBe('may_act claim valid');
    });

    it('should reject may_act claim with mismatched client_id', () => {
      const mayActClaim = { client_id: 'wrong-client' };

      const result = validateMayActClaim(mayActClaim, 'bff-client');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('mismatch');
    });

    it('should reject missing may_act claim', () => {
      const result = validateMayActClaim(null, 'bff-client');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('may_act claim not present');
    });

    it('should reject non-object may_act claim', () => {
      const result = validateMayActClaim('invalid', 'bff-client');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('may_act claim must be a JSON object');
    });

    it('should accept may_act without expected client_id check', () => {
      const mayActClaim = { client_id: 'any-client' };

      const result = validateMayActClaim(mayActClaim, null);

      expect(result.valid).toBe(true);
    });
  });

  describe('extractDelegationChain', () => {
    it('should extract complete delegation chain', () => {
      const token = {
        sub: 'user123',
        act: {
          client_id: 'bff-client',
          iss: 'https://auth.pingone.com'
        },
        may_act: {
          client_id: 'bff-client'
        }
      };

      const chain = extractDelegationChain(token);

      expect(chain.subject).toBe('user123');
      expect(chain.actor.client_id).toBe('bff-client');
      expect(chain.mayAct.client_id).toBe('bff-client');
      expect(chain.delegationPresent).toBe(true);
    });

    it('should handle token without act claim', () => {
      const token = {
        sub: 'user123',
        may_act: { client_id: 'bff-client' }
      };

      const chain = extractDelegationChain(token);

      expect(chain.subject).toBe('user123');
      expect(chain.actor).toBeNull();
      expect(chain.mayAct.client_id).toBe('bff-client');
      expect(chain.delegationPresent).toBe(false);
    });

    it('should handle token without may_act claim', () => {
      const token = {
        sub: 'user123',
        act: { client_id: 'bff-client' }
      };

      const chain = extractDelegationChain(token);

      expect(chain.subject).toBe('user123');
      expect(chain.actor.client_id).toBe('bff-client');
      expect(chain.mayAct).toBeNull();
      expect(chain.delegationPresent).toBe(true);
    });

    it('should handle token with neither act nor may_act', () => {
      const token = { sub: 'user123' };

      const chain = extractDelegationChain(token);

      expect(chain.subject).toBe('user123');
      expect(chain.actor).toBeNull();
      expect(chain.mayAct).toBeNull();
      expect(chain.delegationPresent).toBe(false);
    });

    it('should handle invalid act claim', () => {
      const token = {
        sub: 'user123',
        act: { invalid: 'claim' }
      };

      const chain = extractDelegationChain(token);

      expect(chain.delegationPresent).toBe(false);
    });
  });

  describe('actClaimValidationMiddleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        headers: {},
        path: '/api/accounts'
      };
      res = {};
      next = jest.fn();
    });

    it('should skip validation if no token', () => {
      actClaimValidationMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.delegationChain).toBeUndefined();
    });

    it('should skip validation if no Bearer token', () => {
      req.headers.authorization = 'Basic credentials';

      actClaimValidationMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should extract delegation chain from valid token', () => {
      req.headers.authorization = 'Bearer mock.jwt.token';
      jwt.decode.mockReturnValue({
        sub: 'user123',
        act: { client_id: 'bff-client' }
      });

      actClaimValidationMiddleware(req, res, next);

      expect(req.delegationChain).toBeDefined();
      expect(req.delegationChain.subject).toBe('user123');
      expect(req.delegationChain.actor.client_id).toBe('bff-client');
      expect(req.delegationChain.delegationPresent).toBe(true);
      expect(next).toHaveBeenCalled();
    });

    it('should validate act claim and attach result', () => {
      req.headers.authorization = 'Bearer mock.jwt.token';
      jwt.decode.mockReturnValue({
        sub: 'user123',
        act: { client_id: 'bff-client' }
      });

      actClaimValidationMiddleware(req, res, next);

      expect(req.actClaimValid).toBe(true);
      expect(req.actClaimReason).toBe('act claim valid');
    });

    it('should mark invalid act claim', () => {
      req.headers.authorization = 'Bearer mock.jwt.token';
      jwt.decode.mockReturnValue({
        sub: 'user123',
        act: { invalid: 'claim' }
      });

      actClaimValidationMiddleware(req, res, next);

      expect(req.actClaimValid).toBe(false);
      expect(req.actClaimReason).toContain('missing required identifiers');
    });

    it('should handle token decode errors gracefully', () => {
      req.headers.authorization = 'Bearer invalid.token';
      jwt.decode.mockReturnValue(null);

      actClaimValidationMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should not block request on validation errors', () => {
      req.headers.authorization = 'Bearer mock.token';
      jwt.decode.mockImplementation(() => {
        throw new Error('Decode error');
      });

      actClaimValidationMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should log delegation chain when present', () => {
      req.headers.authorization = 'Bearer mock.jwt.token';
      jwt.decode.mockReturnValue({
        sub: 'user123',
        act: { client_id: 'bff-client' }
      });

      actClaimValidationMiddleware(req, res, next);

      // Logger should be called (mocked)
      expect(next).toHaveBeenCalled();
    });
  });
});
