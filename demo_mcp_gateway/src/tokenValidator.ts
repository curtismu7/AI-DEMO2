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
 *   - If the token's iss claims oauth-mcp's own embedded AS (native ID-JAG
 *     redemption, MCP Enterprise-Managed Authorization), it is verified against
 *     THAT server's own JWKS instead — see isIdJagIssuedToken below. oauth-mcp
 *     signs with its own key, never PingOne's, so PingOne's JWKS could never
 *     verify it; without this branch the request fails "No matching JWKS key
 *     found" long before reaching aud/scope checks.
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
// JWKS cache — one entry per endpoint, fetched once per process and refreshed
// on key-not-found. Keyed by endpoint (not a single global) because the
// ID-JAG filter below adds a SECOND trusted JWKS source (oauth-mcp's own) —
// a single cache slot would have the two sources overwrite each other's keys.
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

interface JwksCacheEntry {
  keys: JwkKey[] | null;
  time: number;
  inFlight: Promise<JwkKey[]> | null;
}

const _jwksCaches = new Map<string, JwksCacheEntry>();
function _cacheFor(endpoint: string): JwksCacheEntry {
  let entry = _jwksCaches.get(endpoint);
  if (!entry) {
    entry = { keys: null, time: 0, inFlight: null };
    _jwksCaches.set(endpoint, entry);
  }
  return entry;
}

const _JWKS_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Unknown-kid amplification guard: minimum spacing between FORCED refreshes.
// A forced refresh bypasses the TTL (so a real key rotation is picked up
// promptly), but must not let a burst of tokens carrying random kids open one
// JWKS round-trip each. Refreshes are rate-capped to at most one per interval.
const _JWKS_MIN_REFRESH_MS = parseInt(process.env.MCP_GW_JWKS_MIN_REFRESH_MS || '10000', 10);

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
  const cache = _cacheFor(endpoint);
  const now = Date.now();
  if (!force && cache.keys && now - cache.time < _JWKS_TTL_MS) {
    return cache.keys;
  }
  // Rate-cap forced refreshes (unknown-kid path). If we refreshed within
  // _JWKS_MIN_REFRESH_MS and still hold keys, reuse them — the caller then fails
  // closed on "no matching key". A genuine rotation still refreshes once the
  // interval elapses; a burst of random kids cannot fan out to unbounded fetches.
  if (force && cache.keys && now - cache.time < _JWKS_MIN_REFRESH_MS) {
    return cache.keys;
  }
  // Deduplicate concurrent fetches: cache-miss AND forced-refresh callers share
  // one in-flight fetch, so concurrent unknown-kid tokens cannot each open one.
  if (cache.inFlight) return cache.inFlight;
  const inflight: Promise<JwkKey[]> = _fetchUrl(endpoint)
    .then((raw) => {
      const parsed = JSON.parse(raw) as JwksResponse;
      cache.keys = parsed.keys || [];
      cache.time = Date.now();
      _keyObjectCache.clear();
      return cache.keys;
    })
    .catch((err) => {
      throw new TokenValidationError(
        `Failed to fetch JWKS from ${endpoint}: ${(err as Error).message}`,
        'jwks_fetch_failed',
      );
    })
    .finally(() => {
      if (cache.inFlight === inflight) cache.inFlight = null;
    });
  cache.inFlight = inflight;
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

/**
 * Peek at the UNVERIFIED payload's iss claim, to decide which JWKS source to
 * attempt verification against. This proves nothing by itself — same as kid
 * selection below, an attacker can put any string here. Trust comes only from
 * the signature check that follows against the source THAT iss value selects;
 * a forged iss just picks the wrong (or no) key-set and verification fails.
 */
function _getUnverifiedIss(token: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
    ) as { iss?: string };
    return payload.iss;
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

// Parsed-key cache — avoids re-importing the same JWK on every request. Keyed
// by kid (or n/e/x/y fallback), which is unique across JWKS sources in
// practice — RSA/EC keys from unrelated signers don't collide on kid — so
// this one stays shared rather than per-endpoint like _jwksCaches above.
const _keyObjectCache = new Map<string, crypto.KeyObject>();

/**
 * Verify token's signature against one JWKS endpoint. Shared by the PingOne
 * path and the ID-JAG path below — same kid-selection and fail-closed rules
 * either way, only the endpoint differs.
 */
async function _verifyWithJwks(token: string, jwksEndpoint: string): Promise<DecodedGatewayToken> {
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
    return jwt.verify(token, publicKey, { algorithms: ['RS256', 'ES256'] }) as DecodedGatewayToken;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TokenValidationError(`JWT signature verification failed: ${msg}`, 'invalid_token');
  }
}

/**
 * True when this process verifies inbound signatures against a JWKS.
 *
 * Single source of truth for the endpoint lookup below, so a caller reporting
 * "this token's kid was checked" cannot drift from the code that does the
 * checking. In JWKS mode _decodeAndVerify THROWS on an unmatched kid, so any
 * token that survives validation demonstrably names a published key.
 */
export function isJwksVerificationEnabled(): boolean {
  return !!(process.env.PINGONE_JWKS_ENDPOINT || process.env.PINGONE_JWKS_URI);
}

/**
 * oauth-mcp's own issuer + JWKS for tokens minted via native ID-JAG redemption
 * (MCP Enterprise-Managed Authorization). Defaults match oauth-mcp's own
 * defaults (embeddedIssuer.ts resolveEmbeddedIssuer(), and its /jwks route
 * reachable in-network at mcp-server:8080) so this works without new compose
 * wiring in the common case; both are overridable per deployment.
 */
function _idJagIssuer(): string {
  return process.env.OAUTH_MCP_ID_JAG_ISSUER || 'https://localhost:8080';
}
function _idJagJwksEndpoint(): string {
  return process.env.OAUTH_MCP_ID_JAG_JWKS_URL || 'http://mcp-server:8080/jwks';
}

/**
 * True when a token's (already signature-verified) iss is oauth-mcp's own
 * embedded-AS issuer — i.e. this token demonstrably came from native ID-JAG
 * redemption, not from PingOne. Only meaningful to call AFTER _decodeAndVerify
 * has verified the signature; on an unverified/undecoded payload iss proves
 * nothing (see _getUnverifiedIss above).
 *
 * Exported for GatewayTokenPolicy's D-05 anti-bypass check: an ID-JAG-redeemed
 * token legitimately carries the OLB server's own audience (that's what native
 * ID-JAG mints it for), which is otherwise indistinguishable from the token
 * D-05 exists to block. This lets that ONE exemption be conditioned on a
 * cryptographically verified issuer instead of the bare aud claim — a token
 * merely claiming iss=oauth-mcp without a valid oauth-mcp signature never
 * reaches this function returning true, because it never passes
 * _decodeAndVerify to begin with.
 */
export function isIdJagIssuedToken(decoded: DecodedGatewayToken): boolean {
  return decoded.iss === _idJagIssuer();
}

async function _decodeAndVerify(token: string): Promise<DecodedGatewayToken> {
  // ID-JAG filter: a token whose (unverified, for now) iss names oauth-mcp's
  // own embedded AS is checked against oauth-mcp's OWN JWKS, never PingOne's
  // — oauth-mcp signs with its own key, so PingOne's JWKS could never verify
  // it. This branch is fully additive: it only ever fires for tokens claiming
  // this specific iss, so PingOne-issued tokens (the overwhelming majority)
  // take the exact same path as before, unchanged.
  const unverifiedIss = _getUnverifiedIss(token);
  if (unverifiedIss === _idJagIssuer()) {
    return _verifyWithJwks(token, _idJagJwksEndpoint());
  }

  // PINGONE_JWKS_URI is accepted as an alias because it is the name this stack
  // actually SETS. The gateway container carries
  // PINGONE_JWKS_URI=https://auth.pingone.com/<env>/as/jwks and nothing anywhere
  // sets PINGONE_JWKS_ENDPOINT — so this lookup was always undefined and the
  // gateway has NEVER verified a signature, falling through to decode-only with
  // MCP_GW_ALLOW_UNVERIFIED_TOKENS=true. The correct URL was present the whole
  // time under the other name. Same orphan-name class as PINGGATEWAY_URL in
  // pingGatewayClient: reading a variable nothing writes fails silently, and
  // "no JWKS configured" is indistinguishable from "JWKS misnamed".
  const jwksEndpoint = process.env.PINGONE_JWKS_ENDPOINT || process.env.PINGONE_JWKS_URI;

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

  return _verifyWithJwks(token, jwksEndpoint);
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

  // F-iat — mirrors decision.js Rule 0d (demo_authz_server/routes/decision.js:396-409):
  // iat must not be in the future and must not be older than the max-age ceiling.
  // Only enforced when the claim is present (same posture as nbf above).
  const IAT_MAX_AGE_SEC = parseInt(process.env.MCP_GW_IAT_MAX_AGE_SECONDS || '7200', 10);
  if (typeof decoded.iat === 'number') {
    if (decoded.iat > nowSec + CLOCK_SKEW_SEC) {
      throw new TokenValidationError('Token issued in the future (iat)', 'invalid_iat');
    }
    if (nowSec - decoded.iat > IAT_MAX_AGE_SEC) {
      throw new TokenValidationError(
        `Token too old: issued ${nowSec - decoded.iat}s ago (max ${IAT_MAX_AGE_SEC}s)`,
        'token_too_old',
      );
    }
  }

  // issuer: enforced only when the gateway has been told who the issuer is. An
  // unset PINGONE_ISSUER_URI cannot be turned into a check — but when it IS set,
  // a missing iss is a mismatch, not a pass (fail closed). ID-JAG-issued tokens
  // are exempt: they were already verified above against oauth-mcp's own JWKS
  // (a different, deliberately different, issuer), and enforcing PingOne's
  // expected issuer against a genuinely non-PingOne token would reject every
  // native ID-JAG call this same check exists to let through.
  const expectedIss = (process.env.PINGONE_ISSUER_URI || '').trim();
  if (expectedIss && !isIdJagIssuedToken(decoded) && decoded.iss !== expectedIss) {
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
