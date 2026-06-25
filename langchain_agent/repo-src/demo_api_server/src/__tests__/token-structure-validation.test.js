/**
 * Tests for tokenStructureValidator.js
 *
 * Validates RFC 8693 claim structure checking per §2.1, §2.2, §2.3, §3.2
 * See docs/RFC8693_MCP_VALIDATION_MATRIX.md for requirements traceability.
 */

const { validateTokenStructure } = require('../../services/tokenStructureValidator');

// Helper: create a valid token with all required claims
function makeValidToken(overrides = {}) {
  return {
    sub: 'user-123',
    aud: 'mcpserver.ping.demo',
    act: 'agent-456',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    scope: 'read write',
    ...overrides,
  };
}

describe('validateTokenStructure', () => {
  describe('valid tokens', () => {
    it('passes for a fully valid token with all claims', () => {
      const token = makeValidToken();
      const result = validateTokenStructure(token, {
        expectedAudience: 'mcpserver.ping.demo',
        expectedScopes: ['read'],
        isDelegationFlow: true,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for a single-exchange token without act claim', () => {
      const token = makeValidToken({ act: undefined });
      const result = validateTokenStructure(token, {
        expectedAudience: 'mcpserver.ping.demo',
        isDelegationFlow: false,
      });
      expect(result.valid).toBe(true);
      // Should have a warning about missing act
      expect(result.warnings.some(w => w.includes('act claim not present'))).toBe(true);
    });
  });

  describe('RFC 8693 §3.2 — sub claim (subject)', () => {
    it('fails when sub claim is missing', () => {
      const token = makeValidToken({ sub: undefined });
      const result = validateTokenStructure(token);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing sub claim'))).toBe(true);
    });

    it('fails when sub claim is empty string', () => {
      const token = makeValidToken({ sub: '   ' });
      const result = validateTokenStructure(token);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('sub claim must be a non-empty string'))).toBe(true);
    });
  });

  describe('RFC 8693 §2.3 — aud claim (audience)', () => {
    it('fails when aud claim is missing', () => {
      const token = makeValidToken({ aud: undefined });
      const result = validateTokenStructure(token);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing aud claim'))).toBe(true);
    });

    it('fails when aud does not match expected audience', () => {
      const token = makeValidToken({ aud: 'https://wrong-server.com' });
      const result = validateTokenStructure(token, {
        expectedAudience: 'mcpserver.ping.demo',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('aud claim mismatch'))).toBe(true);
    });

    it('passes when aud matches expected audience', () => {
      const token = makeValidToken();
      const result = validateTokenStructure(token, {
        expectedAudience: 'mcpserver.ping.demo',
      });
      expect(result.errors.filter(e => e.includes('aud'))).toHaveLength(0);
    });

    it('passes when aud is an array containing expected audience', () => {
      const token = makeValidToken({ aud: ['mcpserver.ping.demo', 'https://other.com'] });
      const result = validateTokenStructure(token, {
        expectedAudience: 'mcpserver.ping.demo',
      });
      expect(result.errors.filter(e => e.includes('aud'))).toHaveLength(0);
    });
  });

  describe('RFC 8693 §2.2 — act claim (actor/delegation)', () => {
    it('fails when act is missing in delegation flow', () => {
      const token = makeValidToken({ act: undefined });
      const result = validateTokenStructure(token, { isDelegationFlow: true });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing act claim'))).toBe(true);
    });

    it('fails when act is empty string in delegation flow', () => {
      const token = makeValidToken({ act: '' });
      const result = validateTokenStructure(token, { isDelegationFlow: true });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('act claim must be non-empty'))).toBe(true);
    });

    it('passes when act is an object (RFC 8693 §4.1 nested actor)', () => {
      const token = makeValidToken({ act: { sub: 'agent-456' } });
      const result = validateTokenStructure(token, { isDelegationFlow: true });
      expect(result.errors.filter(e => e.includes('act'))).toHaveLength(0);
    });

    it('warns when act is missing in non-delegation flow', () => {
      const token = makeValidToken({ act: undefined });
      const result = validateTokenStructure(token, { isDelegationFlow: false });
      expect(result.valid).toBe(true); // warning, not error
      expect(result.warnings.some(w => w.includes('act claim not present'))).toBe(true);
    });
  });

  describe('RFC 8693 §3.2 — exp claim (expiration)', () => {
    it('fails when exp is missing', () => {
      const token = makeValidToken({ exp: undefined });
      const result = validateTokenStructure(token);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing exp claim'))).toBe(true);
    });

    it('fails when token is expired', () => {
      const token = makeValidToken({ exp: Math.floor(Date.now() / 1000) - 100 });
      const result = validateTokenStructure(token);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Token expired'))).toBe(true);
    });

    it('warns when token expires within 1 minute', () => {
      const token = makeValidToken({ exp: Math.floor(Date.now() / 1000) + 30 });
      const result = validateTokenStructure(token);
      expect(result.valid).toBe(true); // valid but warning
      expect(result.warnings.some(w => w.includes('expires in < 1 minute'))).toBe(true);
    });

    it('fails when exp is not a number', () => {
      const token = makeValidToken({ exp: '2026-04-18' });
      const result = validateTokenStructure(token);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exp claim must be a number'))).toBe(true);
    });
  });

  describe('scope validation', () => {
    it('fails when required scopes are missing', () => {
      const token = makeValidToken({ scope: 'read' });
      const result = validateTokenStructure(token, {
        expectedScopes: ['read', 'write'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing required scope(s): write'))).toBe(true);
    });

    it('passes when all required scopes are present', () => {
      const token = makeValidToken({ scope: 'read write mcp:invoke' });
      const result = validateTokenStructure(token, {
        expectedScopes: ['read', 'write'],
      });
      expect(result.errors.filter(e => e.includes('scope'))).toHaveLength(0);
    });

    it('warns when no scope claim exists and no scopes expected', () => {
      const token = makeValidToken({ scope: undefined });
      const result = validateTokenStructure(token);
      expect(result.warnings.some(w => w.includes('no scope claim'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns error for null token', () => {
      const result = validateTokenStructure(null);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('null'))).toBe(true);
    });

    it('returns error for undefined token', () => {
      const result = validateTokenStructure(undefined);
      expect(result.valid).toBe(false);
    });

    it('returns error for non-object token', () => {
      const result = validateTokenStructure('not-a-token');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not an object'))).toBe(true);
    });

    it('passes with no options (default validation)', () => {
      const token = makeValidToken();
      const result = validateTokenStructure(token);
      expect(result.valid).toBe(true);
    });
  });
});
