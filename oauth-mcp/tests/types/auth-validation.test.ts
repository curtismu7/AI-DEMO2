/**
 * Unit tests for authentication model validation
 */

import {
  validateAgentTokenInfo,
  validateUserTokens,
  validateAuthorizationRequest,
  isTokenExpired,
  validateTokenFormat,
  validateScopeFormat,
  validateSessionIdFormat
} from '../../src/types/validation';
import { AgentTokenInfo, UserTokens, AuthorizationRequest } from '../../src/interfaces/auth';

describe('Authentication Model Validation', () => {
  describe('validateAgentTokenInfo', () => {
    const validAgentTokenInfo: AgentTokenInfo = {
      tokenHash: 'abc123hash',
      clientId: 'client-123',
      scopes: ['read', 'write'],
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      isValid: true
    };

    it('should validate a correct AgentTokenInfo', () => {
      expect(validateAgentTokenInfo(validAgentTokenInfo)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateAgentTokenInfo(null)).toBe(false);
      expect(validateAgentTokenInfo(undefined)).toBe(false);
    });

    it('should reject non-object values', () => {
      expect(validateAgentTokenInfo('string')).toBe(false);
      expect(validateAgentTokenInfo(123)).toBe(false);
      expect(validateAgentTokenInfo([])).toBe(false);
    });

    it('should reject invalid tokenHash', () => {
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, tokenHash: '' })).toBe(false);
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, tokenHash: 123 })).toBe(false);
    });

    it('should reject invalid clientId', () => {
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, clientId: '' })).toBe(false);
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, clientId: null })).toBe(false);
    });

    it('should reject invalid scopes', () => {
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, scopes: 'not-array' })).toBe(false);
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, scopes: [123, 'valid'] })).toBe(false);
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, scopes: [] })).toBe(true); // Empty array is valid
    });

    it('should reject invalid expiresAt', () => {
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, expiresAt: 'not-date' })).toBe(false);
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, expiresAt: new Date('invalid') })).toBe(false);
    });

    it('should reject invalid isValid', () => {
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, isValid: 'true' })).toBe(false);
      expect(validateAgentTokenInfo({ ...validAgentTokenInfo, isValid: 1 })).toBe(false);
    });
  });

  describe('validateUserTokens', () => {
    const validUserTokens: UserTokens = {
      accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      refreshToken: 'refresh-token-123',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'read write',
      issuedAt: new Date()
    };

    it('should validate a correct UserTokens', () => {
      expect(validateUserTokens(validUserTokens)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateUserTokens(null)).toBe(false);
      expect(validateUserTokens(undefined)).toBe(false);
    });

    it('should reject invalid accessToken', () => {
      expect(validateUserTokens({ ...validUserTokens, accessToken: '' })).toBe(false);
      expect(validateUserTokens({ ...validUserTokens, accessToken: 123 })).toBe(false);
    });

    it('should reject invalid refreshToken', () => {
      expect(validateUserTokens({ ...validUserTokens, refreshToken: '' })).toBe(false);
      expect(validateUserTokens({ ...validUserTokens, refreshToken: null })).toBe(false);
    });

    it('should reject invalid tokenType', () => {
      expect(validateUserTokens({ ...validUserTokens, tokenType: '' })).toBe(false);
      expect(validateUserTokens({ ...validUserTokens, tokenType: 123 })).toBe(false);
    });

    it('should reject invalid expiresIn', () => {
      expect(validateUserTokens({ ...validUserTokens, expiresIn: 0 })).toBe(false);
      expect(validateUserTokens({ ...validUserTokens, expiresIn: -1 })).toBe(false);
      expect(validateUserTokens({ ...validUserTokens, expiresIn: 'string' })).toBe(false);
    });

    it('should reject invalid scope', () => {
      expect(validateUserTokens({ ...validUserTokens, scope: '' })).toBe(false);
      expect(validateUserTokens({ ...validUserTokens, scope: 123 })).toBe(false);
    });

    it('should reject invalid issuedAt', () => {
      expect(validateUserTokens({ ...validUserTokens, issuedAt: 'not-date' })).toBe(false);
      expect(validateUserTokens({ ...validUserTokens, issuedAt: new Date('invalid') })).toBe(false);
    });
  });

  describe('validateAuthorizationRequest', () => {
    const validAuthRequest: AuthorizationRequest = {
      authorizationUrl: 'https://auth.example.com/oauth/authorize?client_id=123&scope=banking',
      state: 'random-state-123',
      scope: 'read write',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      expiresAt: new Date(Date.now() + 600000) // 10 minutes from now
    };

    it('should validate a correct AuthorizationRequest', () => {
      expect(validateAuthorizationRequest(validAuthRequest)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateAuthorizationRequest(null)).toBe(false);
      expect(validateAuthorizationRequest(undefined)).toBe(false);
    });

    it('should reject invalid authorizationUrl', () => {
      expect(validateAuthorizationRequest({ ...validAuthRequest, authorizationUrl: '' })).toBe(false);
      expect(validateAuthorizationRequest({ ...validAuthRequest, authorizationUrl: 'not-a-url' })).toBe(false);
      expect(validateAuthorizationRequest({ ...validAuthRequest, authorizationUrl: 123 })).toBe(false);
    });

    it('should reject invalid state', () => {
      expect(validateAuthorizationRequest({ ...validAuthRequest, state: '' })).toBe(false);
      expect(validateAuthorizationRequest({ ...validAuthRequest, state: null })).toBe(false);
    });

    it('should reject invalid scope', () => {
      expect(validateAuthorizationRequest({ ...validAuthRequest, scope: '' })).toBe(false);
      expect(validateAuthorizationRequest({ ...validAuthRequest, scope: 123 })).toBe(false);
    });

    it('should reject invalid sessionId', () => {
      expect(validateAuthorizationRequest({ ...validAuthRequest, sessionId: '' })).toBe(false);
      expect(validateAuthorizationRequest({ ...validAuthRequest, sessionId: null })).toBe(false);
    });

    it('should reject invalid expiresAt', () => {
      expect(validateAuthorizationRequest({ ...validAuthRequest, expiresAt: 'not-date' })).toBe(false);
      expect(validateAuthorizationRequest({ ...validAuthRequest, expiresAt: new Date('invalid') })).toBe(false);
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for expired tokens', () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      expect(isTokenExpired(expiredDate)).toBe(true);
    });

    it('should return false for valid tokens', () => {
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      expect(isTokenExpired(futureDate)).toBe(false);
    });

    it('should return true for current time', () => {
      const now = new Date();
      expect(isTokenExpired(now)).toBe(true);
    });
  });

  describe('validateTokenFormat', () => {
    it('should validate correct JWT format', () => {
      const validJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      expect(validateTokenFormat(validJWT)).toBe(true);
    });

    it('should reject invalid token formats', () => {
      expect(validateTokenFormat('')).toBe(false);
      expect(validateTokenFormat('invalid')).toBe(false);
      expect(validateTokenFormat('part1.part2')).toBe(false);
      expect(validateTokenFormat('part1.part2.part3.part4')).toBe(false);
      expect(validateTokenFormat('part1..part3')).toBe(false);
    });

    it('should reject non-string tokens', () => {
      expect(validateTokenFormat(123 as any)).toBe(false);
      expect(validateTokenFormat(null as any)).toBe(false);
      expect(validateTokenFormat(undefined as any)).toBe(false);
    });
  });

  describe('validateScopeFormat', () => {
    it('should validate correct scope formats', () => {
      expect(validateScopeFormat('read')).toBe(true);
      expect(validateScopeFormat('read write')).toBe(true);
      expect(validateScopeFormat('scope1 scope2 scope3')).toBe(true);
      expect(validateScopeFormat('accounts:read')).toBe(true);
      expect(validateScopeFormat('banking_read')).toBe(true);
      expect(validateScopeFormat('banking-read')).toBe(true);
    });

    it('should reject invalid scope formats', () => {
      expect(validateScopeFormat('')).toBe(false);
      expect(validateScopeFormat('scope with invalid chars!')).toBe(false);
      expect(validateScopeFormat('scope  double-space')).toBe(false);
      expect(validateScopeFormat(' leading-space')).toBe(false);
      expect(validateScopeFormat('trailing-space ')).toBe(false);
    });

    it('should reject non-string scopes', () => {
      expect(validateScopeFormat(123 as any)).toBe(false);
      expect(validateScopeFormat(null as any)).toBe(false);
      expect(validateScopeFormat(undefined as any)).toBe(false);
    });
  });

  describe('validateSessionIdFormat', () => {
    it('should validate correct UUID v4 format', () => {
      expect(validateSessionIdFormat('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(validateSessionIdFormat('6ba7b810-9dad-41d4-80b4-00c04fd430c8')).toBe(true);
      expect(validateSessionIdFormat('6ba7b811-9dad-41d4-89b4-00c04fd430c8')).toBe(true);
    });

    it('should reject invalid UUID formats', () => {
      expect(validateSessionIdFormat('')).toBe(false);
      expect(validateSessionIdFormat('not-a-uuid')).toBe(false);
      expect(validateSessionIdFormat('550e8400-e29b-41d4-a716')).toBe(false);
      expect(validateSessionIdFormat('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
      expect(validateSessionIdFormat('550e8400-e29b-31d4-a716-446655440000')).toBe(false); // Not v4
    });

    it('should reject non-string session IDs', () => {
      expect(validateSessionIdFormat(123 as any)).toBe(false);
      expect(validateSessionIdFormat(null as any)).toBe(false);
      expect(validateSessionIdFormat(undefined as any)).toBe(false);
    });
  });
});