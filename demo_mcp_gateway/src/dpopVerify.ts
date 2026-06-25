/**
 * DPoP proof verification (RFC 9449) — pure Node `crypto`, zero external deps
 * (the gateway has no `jose`). Mirrors the BFF's dpopKeyService signing side.
 *
 * Verifies, for the inbound BFF→gateway hop, that the caller holds the private
 * key the delegated token is bound to (cnf.jkt). A stolen bearer cannot be
 * replayed without also signing a fresh, matching proof.
 */

import * as crypto from 'crypto';

export interface DpopVerifyResult {
  ok: boolean;
  jkt?: string;
  reason?: string;
}

interface EcJwk { kty: string; crv: string; x: string; y: string }

// In-memory jti replay cache (jti -> expiry epoch ms). Demo scale; for multi-replica
// production back this with a shared store (Redis) so replays are caught cross-instance.
const _seenJti = new Map<string, number>();

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function sha256b64url(s: string): string {
  return crypto.createHash('sha256').update(s).digest('base64url');
}

/** RFC 7638 JWK thumbprint (SHA-256, base64url) over the EC member set crv,kty,x,y. */
export function jwkThumbprint(jwk: EcJwk): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

/** Compare only the path of htu — robust across proxied/k8s networking where the
 * caller's origin (external gateway URL) differs from the gateway's seen host.
 * Production should pin the full origin. */
function htuPath(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

function pruneJti(nowMs: number): void {
  for (const [k, exp] of _seenJti) if (exp < nowMs) _seenJti.delete(k);
}

export function verifyDpopProof(opts: {
  proof: string;
  htu: string;
  htm: string;
  accessToken?: string;
  expectedJkt?: string;
  maxAgeSecs?: number;
}): DpopVerifyResult {
  const maxAge = opts.maxAgeSecs ?? 60;
  if (!opts.proof) return { ok: false, reason: 'missing proof' };

  const parts = opts.proof.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed proof' };

  let header: { typ?: string; alg?: string; jwk?: EcJwk };
  let payload: { htu?: string; htm?: string; iat?: number; jti?: string; ath?: string };
  try {
    header = JSON.parse(b64urlToBuf(parts[0]).toString('utf-8'));
    payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf-8'));
  } catch {
    return { ok: false, reason: 'undecodable proof' };
  }

  if (header.typ !== 'dpop+jwt') return { ok: false, reason: 'bad typ' };
  if (header.alg !== 'ES256') return { ok: false, reason: 'unsupported alg' };
  const jwk = header.jwk;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    return { ok: false, reason: 'bad jwk' };
  }

  // Signature over header.payload using the embedded public key (ES256 = raw R||S).
  let sigOk = false;
  try {
    const pub = crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
    sigOk = crypto.verify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key: pub, dsaEncoding: 'ieee-p1363' },
      b64urlToBuf(parts[2]),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: 'bad signature' };

  if (String(payload.htm || '').toUpperCase() !== String(opts.htm).toUpperCase()) {
    return { ok: false, reason: 'htm mismatch' };
  }
  if (htuPath(payload.htu || '') !== htuPath(opts.htu)) {
    return { ok: false, reason: 'htu mismatch' };
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== 'number' || Math.abs(nowSecs - payload.iat) > maxAge) {
    return { ok: false, reason: 'iat outside window' };
  }

  if (!payload.jti || typeof payload.jti !== 'string') return { ok: false, reason: 'missing jti' };
  pruneJti(Date.now());
  if (_seenJti.has(payload.jti)) return { ok: false, reason: 'jti replay' };
  _seenJti.set(payload.jti, (nowSecs + maxAge) * 1000);

  if (opts.accessToken && payload.ath !== sha256b64url(opts.accessToken)) {
    return { ok: false, reason: 'ath mismatch' };
  }

  const jkt = jwkThumbprint(jwk);
  if (opts.expectedJkt && jkt !== opts.expectedJkt) {
    return { ok: false, reason: 'jkt mismatch — token not bound to proof key' };
  }

  return { ok: true, jkt };
}
