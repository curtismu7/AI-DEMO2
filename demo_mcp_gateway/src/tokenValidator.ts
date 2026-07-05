'use strict';

/**
 * Validates inbound tokens from agent1.
 * Decodes JWT and verifies the aud claim matches the gateway's resource URI.
 *
 * Signature verification behaviour:
 *   - If PINGONE_JWKS_ENDPOINT is configured: verify the JWT signature via JWKS
 *     (fetched from the configured endpoint, cached in-process). Fails closed —
 *     a token with an invalid or unverifiable signature is rejected.
 *   - If PINGONE_JWKS_ENDPOINT is not configured: fall back to jwt.decode (no
 *     signature verification), preserving the original demo behaviour. A comment
 *     is emitted on first use to make the degraded mode visible in logs.
 */

import jwt from 'jsonwebtoken';
import * as https from 'node:https';
import * as http from 'node:http';
import * as crypto from 'node:crypto';

export interface DecodedGatewayToken {
  sub: string;
  act?: { sub: string; act?: { sub: string } };
  // may_act.sub: the actor the USER authorized. Not present on exchanged tokens; the
  // BFF bridges it via the X-May-Act-Sub header (see index.ts) for per-user may_act
  // enforcement in the authorization decision (ENFORCE_MAY_ACT).
  may_act?: { sub: string };
  scope?: string;
  // Authentication Context Class Reference — recorded in the compliance audit
  // (Scenario 5) so the report can show the auth strength (1FA / MFA) per call.
  acr?: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  iss?: string;
}

export class TokenValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TokenValidationError';
  }
}

// ---------------------------------------------------------------------------
// JWKS cache — fetched once per process, refreshed on key-not-found
// ---------------------------------------------------------------------------

interface JwkKey {
  kid?: string;
  kty: string;
  use?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
  [key: string]: unknown;
}

interface JwksResponse {
  keys: JwkKey[];
}

let _jwksCache: JwkKey[] | null = null;
let _jwksCacheTime = 0;
const _JWKS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function _fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('JWKS fetch timeout')); });
  });
}

async function _fetchJwks(endpoint: string, force = false): Promise<JwkKey[]> {
  const now = Date.now();
  if (!force && _jwksCache && now - _jwksCacheTime < _JWKS_TTL_MS) {
    return _jwksCache;
  }
  // Deduplicate concurrent cache-miss requests: all callers share one in-flight fetch.
  if (!force && _jwksFetchInFlight) return _jwksFetchInFlight;
  const inflight: Promise<JwkKey[]> = _fetchUrl(endpoint)
    .then((raw) => {
      const parsed = JSON.parse(raw) as JwksResponse;
      _jwksCache = parsed.keys || [];
      _jwksCacheTime = Date.now();
      _keyObjectCache.clear();
      return _jwksCache;
    })
    .catch((err) => {
      throw new TokenValidationError(
        `Failed to fetch JWKS from ${endpoint}: ${(err as Error).message}`,
        'jwks_fetch_failed',
      );
    })
    .finally(() => {
      if (_jwksFetchInFlight === inflight) _jwksFetchInFlight = null;
    });
  if (!force) _jwksFetchInFlight = inflight;
  return inflight;
}

function _getKidFromToken(token: string): string | undefined {
  try {
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf-8'),
    ) as { kid?: string };
    return header.kid;
  } catch {
    return undefined;
  }
}

function _jwkToPublicKey(jwk: JwkKey): crypto.KeyObject {
  return crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
}

function _getCachedPublicKey(jwk: JwkKey): crypto.KeyObject {
  const cacheKey = jwk.kid ?? `${jwk.n}:${jwk.e}:${jwk.x}:${jwk.y}`;
  const cached = _keyObjectCache.get(cacheKey);
  if (cached) return cached;
  const key = _jwkToPublicKey(jwk);
  _keyObjectCache.set(cacheKey, key);
  return key;
}

let _noJwksWarned = false;

// Parsed-key cache — avoids re-importing the same JWK on every request.
const _keyObjectCache = new Map<string, crypto.KeyObject>();
// In-flight JWKS fetch — deduplicates concurrent cache-miss requests.
let _jwksFetchInFlight: Promise<JwkKey[]> | null = null;

/**
 * Verify the JWT signature against the configured JWKS endpoint.
 * Returns a decoded payload on success; throws TokenValidationError on failure.
 * When PINGONE_JWKS_ENDPOINT is not set, falls back to jwt.decode (no sig check)
 * and emits a one-time console warning.
 */
async function _decodeAndVerify(token: string): Promise<DecodedGatewayToken> {
  const jwksEndpoint = process.env.PINGONE_JWKS_ENDPOINT;

  if (!jwksEndpoint) {
    // Production must verify signatures — decode-only accepts forged tokens. This is
    // also caught at boot by assertProductionSecrets; the runtime guard covers a
    // config change after start. Dev keeps decode-only so the local demo runs.
    if (process.env.NODE_ENV === 'production') {
      throw new TokenValidationError(
        'PINGONE_JWKS_ENDPOINT not configured — signature verification unavailable',
        'invalid_token',
      );
    }
    // Degraded (dev) mode: no JWKS endpoint configured — skip signature verification.
    if (!_noJwksWarned) {
      _noJwksWarned = true;
      console.warn(
        '[GW] WARN: PINGONE_JWKS_ENDPOINT is not set — JWT signature verification is disabled. ' +
        'Set PINGONE_JWKS_ENDPOINT to enable fail-closed signature checking.',
      );
    }
    const decoded = jwt.decode(token) as DecodedGatewayToken;
    if (!decoded) throw new TokenValidationError('Empty JWT payload', 'invalid_token');
    return decoded;
  }

  // JWKS mode: verify signature with the matching public key.
  const kid = _getKidFromToken(token);
  let keys = await _fetchJwks(jwksEndpoint);

  // Select key by kid when present; fall back to the first key.
  const selectKey = (ks: JwkKey[]): JwkKey | undefined =>
    kid ? ks.find((k) => k.kid === kid) : ks[0];
  let matchedKey = selectKey(keys);

  // Key not in cache — refresh once (key rotation).
  if (!matchedKey) {
    matchedKey = selectKey(await _fetchJwks(jwksEndpoint, true));
  }

  if (!matchedKey) {
    throw new TokenValidationError(
      `No matching JWKS key found${kid ? ` for kid=${kid}` : ''}`,
      'invalid_token',
    );
  }

  let publicKey: crypto.KeyObject;
  try {
    publicKey = _getCachedPublicKey(matchedKey);
  } catch (err) {
    throw new TokenValidationError(
      `Failed to import JWKS key: ${(err as Error).message}`,
      'invalid_token',
    );
  }

  try {
    const verified = jwt.verify(token, publicKey, { algorithms: ['RS256', 'ES256'] }) as DecodedGatewayToken;
    return verified;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TokenValidationError(`JWT signature verification failed: ${msg}`, 'invalid_token');
  }
}

export async function validateInboundToken(
  token: string,
  expectedAud: string,
): Promise<DecodedGatewayToken> {
  if (!token) throw new TokenValidationError('Missing bearer token', 'missing_token');

  let decoded: DecodedGatewayToken;
  try {
    decoded = await _decodeAndVerify(token);
  } catch (err) {
    if (err instanceof TokenValidationError) throw err;
    throw new TokenValidationError('Malformed JWT', 'invalid_token');
  }

  // Expiry check
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new TokenValidationError('Token expired', 'expired_token');
  }

  // Audience check — FAIL CLOSED per RFC 6749
  const audList = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
  if (!audList.includes(expectedAud)) {
    throw new TokenValidationError(
      `Audience mismatch: got [${audList.join(', ')}], expected ${expectedAud}`,
      'invalid_aud',
    );
  }

  return decoded;
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}
