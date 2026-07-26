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
  act?: { sub?: string; client_id?: string; act?: { sub?: string; client_id?: string } };
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
    // STRICT_AUTH must verify signatures — decode-only accepts forged tokens. Also
    // caught at boot by assertProductionSecrets; this runtime guard covers a config
    // change after start. Gated on STRICT_AUTH (not NODE_ENV) because the local demo
    // runs NODE_ENV=production without JWKS by design — it keeps decode-only.
    if (process.env.STRICT_AUTH === 'true') {
      throw new TokenValidationError(
        'PINGONE_JWKS_ENDPOINT not configured — signature verification unavailable',
        'invalid_token',
      );
    }
    // F5 — omission is not permission. "No JWKS configured" previously fell straight
    // through to jwt.decode, so a gateway that was merely UNDER-CONFIGURED accepted
    // forged tokens with zero signature verification and no operator signal. Refuse
    // unless the degraded mode is asked for BY NAME; the flag is reported in the
    // /health `authz.failOpen` array (contract C3) so the bypass is never silent.
    if (process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS !== 'true') {
      throw new TokenValidationError(
        'PINGONE_JWKS_ENDPOINT not configured — refusing to validate without signature ' +
        'verification. Set PINGONE_JWKS_ENDPOINT, or set MCP_GW_ALLOW_UNVERIFIED_TOKENS=true ' +
        'to explicitly accept unverified tokens (dev only).',
        'invalid_token',
      );
    }
    // Degraded (dev) mode: no JWKS endpoint configured — skip signature verification.
    if (!_noJwksWarned) {
      _noJwksWarned = true;
      console.warn(
        '[GW] WARN: PINGONE_JWKS_ENDPOINT is not set and MCP_GW_ALLOW_UNVERIFIED_TOKENS=true — ' +
        'JWT signature verification is disabled. Set PINGONE_JWKS_ENDPOINT to enable ' +
        'fail-closed signature checking.',
      );
    }
    const decoded = jwt.decode(token) as DecodedGatewayToken;
    if (!decoded) throw new TokenValidationError('Empty JWT payload', 'invalid_token');
    return decoded;
  }

  // JWKS mode: verify signature with the matching public key.
  const kid = _getKidFromToken(token);
  let keys = await _fetchJwks(jwksEndpoint);

  // Select key by kid when present. A kid-less token may only be verified when the
  // JWKS is unambiguous (exactly one key) — falling back to ks[0] across a multi-key
  // set let an attacker strip the `kid` header and have the token tried against
  // whichever key happens to sort first, defeating key rotation. Fail closed instead.
  const selectKey = (ks: JwkKey[]): JwkKey | undefined =>
    kid ? ks.find((k) => k.kid === kid) : (ks.length === 1 ? ks[0] : undefined);
  let matchedKey = selectKey(keys);

  // Key not in cache — refresh once (key rotation).
  if (!matchedKey) {
    keys = await _fetchJwks(jwksEndpoint, true);
    matchedKey = selectKey(keys);
  }

  if (!matchedKey) {
    if (!kid && keys.length > 1) {
      throw new TokenValidationError(
        `Token has no kid header and the JWKS exposes ${keys.length} keys — ` +
        'cannot select a verification key unambiguously',
        'invalid_token',
      );
    }
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

  // F7 — parity with the IG JWKS filter (jwks-token-validation.groovy:156-181), which
  // enforces nbf and iss. Without these, a token the PingGateway path rejects is
  // accepted by the Node path: the same credential gets two different verdicts
  // depending only on which gateway the BFF happened to route through.
  const nowSec = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW_SEC = 30; // same tolerance the groovy filter applies

  // not-before: only enforced when the claim is present (matches the groovy).
  if (typeof decoded.nbf === 'number' && nowSec < decoded.nbf - CLOCK_SKEW_SEC) {
    throw new TokenValidationError('Token not yet valid (nbf)', 'token_not_yet_valid');
  }

  // issuer: enforced only when the gateway has been told who the issuer is. An
  // unset PINGONE_ISSUER_URI cannot be turned into a check — but when it IS set,
  // a missing iss is a mismatch, not a pass (fail closed).
  const expectedIss = (process.env.PINGONE_ISSUER_URI || '').trim();
  if (expectedIss && decoded.iss !== expectedIss) {
    throw new TokenValidationError(
      `Issuer mismatch: got ${decoded.iss ?? '(none)'}, expected ${expectedIss}`,
      'invalid_iss',
    );
  }

  // Audience check — FAIL CLOSED per RFC 6749.
  // expectedAud may be a comma-separated list (Node gateway + PingGateway
  // resource URIs) so Path B can accept PingGateway-minted tokens when the
  // BFF routes dual_token tools to this Node gateway.
  const audList = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
  const accepted = String(expectedAud || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!accepted.some((a) => audList.includes(a))) {
    throw new TokenValidationError(
      `Audience mismatch: got [${audList.join(', ')}], expected ${accepted.join(' | ')}`,
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
