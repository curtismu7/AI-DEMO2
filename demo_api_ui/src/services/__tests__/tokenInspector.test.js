import { describe, it, expect } from 'vitest';
import { decodeJWT, extractScopes, formatTokenDisplay } from '../tokenInspector';

describe('tokenInspector', () => {
  const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImFjY2Vzc19yZXNvdXJjZSIsImF1ZCI6ImFwaS5leGFtcGxlIiwic3ViIjoidGVzdC11c2VyLWlkIiwiZXhwIjo5OTk5OTk5OTk5fQ.TEST_SIGNATURE'; // gitleaks:allow

  describe('decodeJWT', () => {
    it('returns valid structure for valid token', () => {
      const result = decodeJWT(validToken);
      expect(result.isValid).toBe(true);
      expect(result.header).toBeDefined();
      expect(result.payload).toBeDefined();
      expect(result.payload.scope).toBe('access_resource');
    });

    it('handles invalid token format', () => {
      const result = decodeJWT('invalid');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBe('Invalid JWT format');
    });

    it('handles null token', () => {
      const result = decodeJWT(null);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('handles non-string token', () => {
      const result = decodeJWT(123);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('handles malformed base64', () => {
      const result = decodeJWT('!!!.!!!.!!!');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('extracts all three parts', () => {
      const result = decodeJWT(validToken);
      expect(result.header.alg).toBe('HS256');
      expect(result.header.typ).toBe('JWT');
      expect(result.signature).toBe('TEST');
    });
  });

  describe('extractScopes', () => {
    it('parses space-delimited scopes', () => {
      const scopes = extractScopes({ scope: 'read write delete' });
      expect(scopes).toEqual(['read', 'write', 'delete']);
    });

    it('handles single scope', () => {
      const scopes = extractScopes({ scope: 'read' });
      expect(scopes).toEqual(['read']);
    });

    it('handles empty scope string', () => {
      const scopes = extractScopes({ scope: '' });
      expect(scopes).toEqual([]);
    });

    it('handles scp field', () => {
      const scopes = extractScopes({ scp: 'admin user' });
      expect(scopes).toEqual(['admin', 'user']);
    });

    it('returns empty array for no payload', () => {
      const scopes = extractScopes(null);
      expect(scopes).toEqual([]);
    });

    it('returns empty array for non-object payload', () => {
      const scopes = extractScopes('invalid');
      expect(scopes).toEqual([]);
    });

    it('filters out empty scope strings', () => {
      const scopes = extractScopes({ scope: 'read  write' });
      expect(scopes).toEqual(['read', 'write']);
    });

    it('handles array scopes', () => {
      const scopes = extractScopes({ scope: ['read', 'write'] });
      expect(scopes).toEqual(['read', 'write']);
    });
  });

  describe('formatTokenDisplay', () => {
    it('returns structured display for valid payload', () => {
      const payload = {
        scope: 'read write',
        aud: 'api.demo',
        sub: '12345',
        exp: 9999999999,
        iss: 'https://auth.example.com'
      };
      const display = formatTokenDisplay(payload);
      expect(display.scopes).toContain('read');
      expect(display.scopes).toContain('write');
      expect(display.aud).toBe('api.demo');
      expect(display.sub).toBe('12345');
      expect(display.iss).toBe('https://auth.example.com');
      expect(display.exp).toBeDefined();
    });

    it('converts exp timestamp to ISO string', () => {
      const payload = { exp: 1704067200 }; // 2024-01-01 00:00:00 UTC
      const display = formatTokenDisplay(payload);
      expect(display.exp).toContain('2024-01-01');
    });

    it('handles missing optional fields', () => {
      const payload = { sub: '12345' };
      const display = formatTokenDisplay(payload);
      expect(display.aud).toBeNull();
      expect(display.exp).toBeNull();
      expect(display.iss).toBeNull();
      expect(display.jti).toBeNull();
    });

    it('handles alternative field names', () => {
      const payload = {
        audience: 'api.demo',
        subject: 'user-123',
        issuer: 'https://auth.example.com'
      };
      const display = formatTokenDisplay(payload);
      expect(display.aud).toBe('api.demo');
      expect(display.sub).toBe('user-123');
      expect(display.iss).toBe('https://auth.example.com');
    });

    it('includes jti field', () => {
      const payload = { jti: 'unique-id-123' };
      const display = formatTokenDisplay(payload);
      expect(display.jti).toBe('unique-id-123');
    });

    it('includes raw payload', () => {
      const payload = { scope: 'read', custom: 'value' };
      const display = formatTokenDisplay(payload);
      expect(display.raw).toEqual(payload);
    });

    it('returns default structure for null payload', () => {
      const display = formatTokenDisplay(null);
      expect(display.scopes).toEqual([]);
      expect(display.aud).toBeNull();
      expect(display.exp).toBeNull();
      expect(display.sub).toBeNull();
      expect(display.iss).toBeNull();
    });

    it('returns default structure for non-object payload', () => {
      const display = formatTokenDisplay('invalid');
      expect(display.scopes).toEqual([]);
      expect(display.aud).toBeNull();
    });
  });
});
