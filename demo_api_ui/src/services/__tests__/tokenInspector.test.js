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
      expect(result.signature).toBe('TEST_SIGNATURE');
    });

    // Real PingOne tokens are base64url-encoded (RFC 7515): `-`/`_`, no padding.
    // `atob()` only accepts the standard base64 alphabet (`+`/`/`), so any
    // segment whose base64url form contains `-` or `_` used to throw
    // "Invalid character" and decodeJWT would report isValid:false for a
    // perfectly valid token. This payload's `picture` claim query string
    // (`?size=128`) lands on a byte boundary that produces a literal `_` in
    // the base64url-encoded payload segment, reproducing the real failure.
    const pingOneShapedToken =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjlmOGU3ZDZjLTViNGEtM2MyZC0xZTBmLWExYjJjM2Q0ZTVmNiJ9' +
      '.' +
      'eyJpc3MiOiJodHRwczovL2F1dGgucGluZ29uZS5jb20vOGYzYjJjMWEtNGQ1ZS02ZjcwLTgxOTItYTNiNGM1ZDZlN2Y4L2FzIiwic3ViIjoiYjJjM2Q0ZTUtZjYwNy00ODM5LWEwYjEtYzJkM2U0ZjUwNjE3IiwiYXVkIjoiYmFua2luZy11aS1jbGllbnQiLCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIGFjY2Vzc19yZXNvdXJjZSByZWFkX2FjY291bnRzIiwiY2xpZW50X2lkIjoiYmFua2luZy11aS1jbGllbnQiLCJuYW1lIjoiSm9yZGFuIFJpdmVyYSIsInBpY3R1cmUiOiJodHRwczovL2Nkbi5waW5naWRlbnRpdHkuY29tL2F2YXRhcnMvZGVmYXVsdC5wbmc_c2l6ZT0xMjgiLCJleHAiOjk5OTk5OTk5OTksImlhdCI6MTcwMDAwMDAwMCwianRpIjoiYjdlMWMyZDMtNGY1YS02YjdjLThkOWUtMGYxYTJiM2M0ZDVlIn0' +
      '.TEST_SIGNATURE_VALUE';

    it('confirms the payload segment contains base64url-only characters (- or _)', () => {
      const payloadSegment = pingOneShapedToken.split('.')[1];
      expect(/[-_]/.test(payloadSegment)).toBe(true);
    });

    it('decodes a realistic PingOne-shaped token whose segments contain base64url `-`/`_`', () => {
      const result = decodeJWT(pingOneShapedToken);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.header.alg).toBe('RS256');
      expect(result.payload.sub).toBe('b2c3d4e5-f607-4839-a0b1-c2d3e4f50617');
      expect(result.payload.picture).toBe(
        'https://cdn.pingidentity.com/avatars/default.png?size=128'
      );
      expect(result.payload.scope).toBe('openid profile email access_resource read_accounts');
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
