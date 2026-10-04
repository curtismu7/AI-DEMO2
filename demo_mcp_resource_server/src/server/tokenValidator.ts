'use strict';

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export interface DecodedToken {
  sub: string;
  iss?: string;
  act?: { sub: string };
  scope?: string | string[];
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
let pfJwksKeySet: Awaited<ReturnType<JoseModule['createRemoteJWKSet']>> | null = null;
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

// Secondary issuer (PingFederate, 2026-09-22 A2A-under-PF): tokens whose iss
// matches PF_ISSUER_URI verify against PF_JWKS_URI instead. Unset = PingOne-only.
const PF_ISSUER = process.env.PF_ISSUER || process.env.PF_ISSUER_URI || '';
const PF_JWKS_URI = process.env.PF_JWKS_URI || (PF_ISSUER ? `${PF_ISSUER}/JWKS` : null) || '';
async function getJwksKeySetFor(iss: string | undefined) {
  if (PF_ISSUER && iss === PF_ISSUER) {
    if (pfJwksKeySet) return pfJwksKeySet;
    if (!PF_JWKS_URI) return null;
    try {
      const { createRemoteJWKSet } = await getJose();
      pfJwksKeySet = createRemoteJWKSet(new URL(PF_JWKS_URI));
      return pfJwksKeySet;
    } catch {
      return null;
    }
  }
  return getJwksKeySet();
}

// Privilege AI Gateway "Static Token" auth mode sends one fixed bearer on every
// backend call. It is not a JWT and names no user, so it is treated like a
// sub-less machine token limited to MCP_RESOURCE_SERVER_GATEWAY_STATIC_SCOPES
// (default: read). Off unless a token of at least 32 characters is configured.
const GATEWAY_STATIC_TOKEN_MIN_LENGTH = 32;
export function isGatewayStaticToken(token: string): boolean {
  const expected = (process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_TOKEN || '').trim();
  if (expected.length < GATEWAY_STATIC_TOKEN_MIN_LENGTH || !token) return false;
  const digest = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest();
  return crypto.timingSafeEqual(digest(token), digest(expected));
}

export async function decodeAndValidate(token: string, expectedAud: string): Promise<DecodedToken> {
  if (isGatewayStaticToken(token)) {
    // ponytail: every gateway caller shares this one identity; use the gateway's
    // Pass Agent Token or User Token mode if per-caller identity is ever needed.
    return {
      sub: '',
      aud: expectedAud,
      scope: (process.env.MCP_RESOURCE_SERVER_GATEWAY_STATIC_SCOPES || 'read').trim(),
      exp: 0,
    };
  }

  // SECURITY (was: critical gap) — verify the signature against PingOne's JWKS
  // BEFORE trusting any claim. Previously this used an unsigned jwt.decode, so a
  // forged JWT with the right aud/scope was accepted. Fail-closed when JWKS is
  // configured; SKIP_TOKEN_SIGNATURE_VALIDATION=true downgrades to a warning.
  // Pre-decode iss (unverified) only to SELECT the trust anchor — the actual
  // verification below still validates signature/claims against that key set.
  let issHint: string | undefined;
  try {
    issHint = (jwt.decode(token) as DecodedToken | null)?.iss;
  } catch {
    issHint = undefined;
  }
  const jwks = await getJwksKeySetFor(issHint);
  if (jwks) {
    try {
      const { jwtVerify } = await getJose();
      await jwtVerify(token, jwks);
    } catch (err) {
      if (process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true') {
        console.warn('[invest] token signature verification FAILED but SKIP_TOKEN_SIGNATURE_VALIDATION=true — accepting:', err instanceof Error ? err.message : err);
      } else {
        console.error('[invest] jwtVerify error:', err instanceof Error ? err.message : err);
        throw new TokenError('Token signature verification failed: ' + (err instanceof Error ? err.message : err), 'invalid_token');
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
  // PingFederate ATM emits scope as a JSON array when multiple requested
  // scopes are granted; PingOne emits a space-delimited string.
  if (Array.isArray(decoded.scope)) return decoded.scope.map(String).filter(Boolean);
  return (decoded.scope || '').split(' ').filter(Boolean);
}
