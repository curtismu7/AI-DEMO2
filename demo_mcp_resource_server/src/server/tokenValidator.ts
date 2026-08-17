'use strict';

import jwt from 'jsonwebtoken';

export interface DecodedToken {
  sub: string;
  act?: { sub: string };
  scope?: string;
  aud: string | string[];
  exp: number;
}

export class TokenError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TokenError';
  }
}

// Lazy-loaded jose (ESM-only in v6+) + memoised JWKS keyset — mirrors the main
// MCP server's TokenIntrospector so this server also cryptographically verifies
// inbound tokens instead of trusting an unsigned decode.
type JoseModule = typeof import('jose');
let josePromise: Promise<JoseModule> | null = null;
function getJose(): Promise<JoseModule> {
  if (!josePromise) josePromise = import('jose') as Promise<JoseModule>;
  return josePromise;
}
let jwksKeySet: Awaited<ReturnType<JoseModule['createRemoteJWKSet']>> | null = null;
async function getJwksKeySet() {
  if (jwksKeySet) return jwksKeySet;
  const jwksUri =
    process.env.PINGONE_JWKS_URI ||
    (process.env.PINGONE_ISSUER ? `${process.env.PINGONE_ISSUER}/jwks` : null) ||
    (process.env.PINGONE_BASE_URL ? `${process.env.PINGONE_BASE_URL}/jwks` : null);
  if (!jwksUri) return null;
  try {
    const { createRemoteJWKSet } = await getJose();
    jwksKeySet = createRemoteJWKSet(new URL(jwksUri));
    return jwksKeySet;
  } catch {
    return null;
  }
}

export async function decodeAndValidate(token: string, expectedAud: string): Promise<DecodedToken> {
  // SECURITY (was: critical gap) — verify the signature against PingOne's JWKS
  // BEFORE trusting any claim. Previously this used an unsigned jwt.decode, so a
  // forged JWT with the right aud/scope was accepted. Fail-closed when JWKS is
  // configured; SKIP_TOKEN_SIGNATURE_VALIDATION=true downgrades to a warning.
  const jwks = await getJwksKeySet();
  if (jwks) {
    try {
      const { jwtVerify } = await getJose();
      await jwtVerify(token, jwks);
    } catch (err) {
      if (process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true') {
        console.warn('[invest] token signature verification FAILED but SKIP_TOKEN_SIGNATURE_VALIDATION=true — accepting:', err instanceof Error ? err.message : err);
      } else {
        throw new TokenError('Token signature verification failed', 'invalid_token');
      }
    }
  } else {
    // No JWKS endpoint configured — nothing to verify the signature against.
    // STRICT_AUTH must not accept an unverifiable token (parity with the main MCP
    // server's TokenIntrospector); the local demo runs without JWKS by design, so it
    // otherwise keeps warn+accept.
    if (process.env.STRICT_AUTH === 'true') {
      throw new TokenError('Token signature cannot be verified (JWKS not configured)', 'invalid_token');
    }
    console.warn('[invest] JWKS not configured (PINGONE_JWKS_URI / PINGONE_ISSUER / PINGONE_BASE_URL) — token signature NOT verified');
  }

  let decoded: DecodedToken;
  try {
    decoded = jwt.decode(token) as DecodedToken;
  } catch {
    throw new TokenError('Malformed JWT', 'invalid_token');
  }
  if (!decoded) throw new TokenError('Empty JWT', 'invalid_token');

  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new TokenError('Token expired', 'expired_token');
  }

  // MCP_RESOURCE_SERVER_RESOURCE_URI may be a comma-separated list of accepted audiences
  // (rollout: own backend URI + gateway URI while both token shapes are live).
  const accepted = expectedAud.split(',').map((s) => s.trim()).filter(Boolean);
  const audList = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
  if (!audList.some((a) => accepted.includes(a))) {
    throw new TokenError(
      `Audience mismatch: got [${audList.join(', ')}], expected one of [${accepted.join(', ')}]`,
      'invalid_aud',
    );
  }

  return decoded;
}

export function extractScopes(decoded: DecodedToken): string[] {
  return (decoded.scope || '').split(' ').filter(Boolean);
}
