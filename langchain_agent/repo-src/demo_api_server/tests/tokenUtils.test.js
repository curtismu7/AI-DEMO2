'use strict';
/**
 * Server-side regression tests — banking_api_server
 *
 * Covers:
 *   1. tokenUtils.decodeJwt — all edge cases
 *   2. tokenUtils.sanitizePingOneResponse — strips secrets, keeps error fields
 *   3. agentMcpTokenService helpers — countJwtScopes, audMatches logic
 */

const { decodeJwt, sanitizePingOneResponse } = require('../utils/tokenUtils');

// ─── Real JWTs for testing ────────────────────────────────────────────────────
// Built with: node -e "Buffer.from(JSON.stringify({...})).toString('base64url')"

const makeJwt = (header, claims) => {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${c}.fakesig`;
};

const VALID_USER_JWT = makeJwt(
  { alg: 'RS256', typ: 'JWT' },
  {
    sub: 'user-001',
    aud: 'https://api.ping.demo',
    may_act: { sub: 'agent-001' },
    exp: 9999999999,
    iat: 1700000000,
    scope: 'openid profile banking:read',
  }
);

const VALID_MCP_JWT = makeJwt(
  { alg: 'RS256', typ: 'JWT' },
  {
    sub: 'user-001',
    aud: 'https://mcp-gateway.pingdemo.com',
    act: { sub: 'agent-001', client_id: 'bff-client' },
    exp: 9999999999,
    scope: 'banking:read banking:write',
  }
);

// ─── 1. decodeJwt ─────────────────────────────────────────────────────────────

describe('decodeJwt', () => {
  it('decodes a valid user JWT and returns header + claims', () => {
    const result = decodeJwt(VALID_USER_JWT);
    expect(result).not.toBeNull();
    expect(result.header.alg).toBe('RS256');
    expect(result.claims.sub).toBe('user-001');
    expect(result.claims.may_act).toEqual({ sub: 'agent-001' });
  });

  it('decodes a valid MCP JWT with act claim', () => {
    const result = decodeJwt(VALID_MCP_JWT);
    expect(result).not.toBeNull();
    expect(result.claims.act).toEqual({ sub: 'agent-001', client_id: 'bff-client' });
    expect(result.claims.aud).toBe('https://mcp-gateway.pingdemo.com');
  });

  it('returns null for null input', () => {
    expect(decodeJwt(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(decodeJwt(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeJwt('')).toBeNull();
  });

  it('returns null for a non-string (number)', () => {
    expect(decodeJwt(42)).toBeNull();
  });

  it('returns null for a non-string (object)', () => {
    expect(decodeJwt({ token: 'abc' })).toBeNull();
  });

  it('returns null for a JWT with only 2 parts', () => {
    expect(decodeJwt('header.payload')).toBeNull();
  });

  it('returns null for a JWT with 4 parts (JWE-style)', () => {
    expect(decodeJwt('a.b.c.d')).toBeNull();
  });

  it('returns null for a JWT with invalid base64 in header', () => {
    expect(decodeJwt('!!!.payload.sig')).toBeNull();
  });

  it('returns null for a JWT with non-JSON payload', () => {
    const badPayload = Buffer.from('not json').toString('base64url');
    expect(decodeJwt(`eyJhbGciOiJSUzI1NiJ9.${badPayload}.sig`)).toBeNull();
  });

  it('does NOT verify signature — fake sig is accepted', () => {
    // decodeJwt is display-only; sig verification is done by tokenVerificationService
    const result = decodeJwt(VALID_USER_JWT);
    expect(result).not.toBeNull(); // accepted despite fake sig
  });

  it('scope claim is accessible as a string', () => {
    const result = decodeJwt(VALID_USER_JWT);
    expect(result.claims.scope).toBe('openid profile banking:read');
  });

  it('array aud is decoded correctly', () => {
    const jwt = makeJwt({ alg: 'RS256' }, { sub: 'u1', aud: ['aud1', 'aud2'] });
    const result = decodeJwt(jwt);
    expect(result.claims.aud).toEqual(['aud1', 'aud2']);
  });
});

// ─── 2. sanitizePingOneResponse ───────────────────────────────────────────────

describe('sanitizePingOneResponse', () => {
  it('strips access_token', () => {
    const result = sanitizePingOneResponse({ access_token: 'secret.jwt.here', token_type: 'Bearer' });
    expect(result).not.toHaveProperty('access_token');
    expect(result.token_type).toBe('Bearer');
  });

  it('strips id_token', () => {
    const result = sanitizePingOneResponse({ id_token: 'id.jwt.here', expires_in: 3600 });
    expect(result).not.toHaveProperty('id_token');
    expect(result.expires_in).toBe(3600);
  });

  it('strips refresh_token', () => {
    const result = sanitizePingOneResponse({ refresh_token: 'refresh-secret', scope: 'openid' });
    expect(result).not.toHaveProperty('refresh_token');
    expect(result.scope).toBe('openid');
  });

  it('strips client_secret', () => {
    const result = sanitizePingOneResponse({ client_secret: 'super-secret', client_id: 'app123' });
    expect(result).not.toHaveProperty('client_secret');
    expect(result.client_id).toBe('app123');
  });

  it('keeps error and error_description fields for debugging', () => {
    const result = sanitizePingOneResponse({
      error: 'invalid_grant',
      error_description: 'The token has expired',
      access_token: 'leaked',
    });
    expect(result.error).toBe('invalid_grant');
    expect(result.error_description).toBe('The token has expired');
    expect(result).not.toHaveProperty('access_token');
  });

  it('strips all four sensitive fields at once', () => {
    const result = sanitizePingOneResponse({
      access_token: 'a',
      id_token: 'b',
      refresh_token: 'c',
      client_secret: 'd',
      token_type: 'Bearer',
    });
    expect(Object.keys(result)).toEqual(['token_type']);
  });

  it('returns empty object for null input', () => {
    expect(sanitizePingOneResponse(null)).toEqual({});
  });

  it('returns empty object for string input', () => {
    expect(sanitizePingOneResponse('not an object')).toEqual({});
  });

  it('returns empty object for array input', () => {
    expect(sanitizePingOneResponse([])).toEqual({});
  });

  it('handles object with no sensitive fields', () => {
    const input = { status: 'ok', code: 200 };
    expect(sanitizePingOneResponse(input)).toEqual({ status: 'ok', code: 200 });
  });
});

// ─── 3. aud matching logic (mirrors agentMcpTokenService) ────────────────────

describe('MCP token aud matching logic', () => {
  // This mirrors the exact check in agentMcpTokenService.js line ~1257:
  // const audMatches = mcpTokenAud === mcpResourceUri ||
  //   (Array.isArray(mcpTokenAud) && mcpTokenAud.includes(mcpResourceUri));
  const audMatches = (mcpTokenAud, mcpResourceUri) =>
    mcpTokenAud === mcpResourceUri ||
    (Array.isArray(mcpTokenAud) && mcpTokenAud.includes(mcpResourceUri));

  it('matches when aud is a string equal to resourceUri', () => {
    expect(audMatches('https://mcp.pingdemo.com', 'https://mcp.pingdemo.com')).toBe(true);
  });

  it('does not match when aud string differs', () => {
    expect(audMatches('https://other.com', 'https://mcp.pingdemo.com')).toBe(false);
  });

  it('matches when aud is an array containing resourceUri', () => {
    expect(audMatches(['https://api.com', 'https://mcp.pingdemo.com'], 'https://mcp.pingdemo.com')).toBe(true);
  });

  it('does not match when aud array excludes resourceUri', () => {
    expect(audMatches(['https://other1.com', 'https://other2.com'], 'https://mcp.pingdemo.com')).toBe(false);
  });

  it('does not match when aud is undefined', () => {
    expect(audMatches(undefined, 'https://mcp.pingdemo.com')).toBe(false);
  });

  it('does not match when aud is null', () => {
    expect(audMatches(null, 'https://mcp.pingdemo.com')).toBe(false);
  });
});

// ─── 4. RFC 8693 token exchange: scope counting ──────────────────────────────

describe('countJwtScopes (mirrors agentMcpTokenService logic)', () => {
  // Mirrors: function countJwtScopes(claims) in agentMcpTokenService.js
  const countJwtScopes = (claims) => {
    if (!claims?.scope || typeof claims.scope !== 'string') return 0;
    return claims.scope.trim().split(/\s+/).filter(Boolean).length;
  };

  it('counts single scope', () => {
    expect(countJwtScopes({ scope: 'openid' })).toBe(1);
  });

  it('counts multiple scopes', () => {
    expect(countJwtScopes({ scope: 'openid profile banking:read banking:write' })).toBe(4);
  });

  it('handles extra whitespace', () => {
    expect(countJwtScopes({ scope: '  openid   profile  ' })).toBe(2);
  });

  it('returns 0 for empty scope string', () => {
    expect(countJwtScopes({ scope: '' })).toBe(0);
  });

  it('returns 0 for missing scope claim', () => {
    expect(countJwtScopes({ sub: 'u1' })).toBe(0);
  });

  it('returns 0 for null claims', () => {
    expect(countJwtScopes(null)).toBe(0);
  });

  it('returns 0 when scope is an array (non-string)', () => {
    expect(countJwtScopes({ scope: ['openid', 'profile'] })).toBe(0);
  });
});
