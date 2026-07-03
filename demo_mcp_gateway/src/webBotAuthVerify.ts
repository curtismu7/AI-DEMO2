/**
 * Web Bot Auth verification — the draft-meunier-web-bot-auth-architecture
 * profile of RFC 9421 HTTP Message Signatures. Pure Node `crypto` + built-in
 * fetch, zero external deps (mirrors dpopVerify.ts).
 *
 * Profile (pinned):
 *   - Algorithm: Ed25519 ("ed25519")
 *   - Covered components MUST include `@authority` and `signature-agent`
 *   - Signature params: created, expires, keyid (RFC 7638 JWK thumbprint),
 *     nonce (replay protection), tag="web-bot-auth"
 *   - `Signature-Agent` header carries the agent's origin; its key directory
 *     is a JWKS of Ed25519 (OKP) public keys served at
 *     /.well-known/http-message-signatures-directory
 *
 * Canonicalization + raw crypto live in httpMessageSignature.ts (validated
 * against the RFC 9421 Appendix B Ed25519 vectors).
 */

import {
  parseSignatureInput,
  parseSignatureHeader,
  buildSignatureBase,
  verifyEd25519Signature,
  jwkThumbprint,
  type SignatureInputEntry,
} from './httpMessageSignature';
import * as crypto from 'crypto';

export const WBA_TAG = 'web-bot-auth';
export const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';

export interface WbaVerifyResult {
  ok: boolean;
  reason?: string;
  /** RFC 7638 thumbprint of the verified key. */
  keyid?: string;
  /** Origin advertised in Signature-Agent (unquoted). */
  signatureAgent?: string;
  label?: string;
}

interface OkpJwk { kty: string; crv?: string; x?: string; kid?: string }
export type JwksFetcher = (url: string) => Promise<{ keys: OkpJwk[] }>;

// Sanity bound on expires-created. Bots sign per request; a signature valid for
// hours defeats the nonce cache (which must retain nonces until expiry).
const MAX_SIG_LIFETIME_SECS = 15 * 60;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

// In-memory caches (demo scale; multi-replica production should back the nonce
// cache with a shared store — same caveat as dpopVerify's jti cache).
const _jwksCache = new Map<string, { keys: OkpJwk[]; expiresAt: number }>();
const _seenNonces = new Map<string, number>(); // nonce -> expiry epoch ms

export function _resetWbaCachesForTest(): void {
  _jwksCache.clear();
  _seenNonces.clear();
}

/** Test hook: pre-seed the directory cache so tests avoid live fetches. */
export function _primeJwksCacheForTest(url: string, keys: OkpJwk[]): void {
  _jwksCache.set(url, { keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
}

function pruneNonces(nowMs: number): void {
  for (const [k, exp] of _seenNonces) if (exp < nowMs) _seenNonces.delete(k);
}

async function defaultFetchJwks(url: string): Promise<{ keys: OkpJwk[] }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { accept: 'application/http-message-signatures-directory+json, application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { keys: OkpJwk[] };
}

async function getDirectoryKeys(url: string, fetcher: JwksFetcher): Promise<OkpJwk[]> {
  const cached = _jwksCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const jwks = await fetcher(url);
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  _jwksCache.set(url, { keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
  return keys;
}

function firstHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

/** Unquote an sf-string Signature-Agent value; tolerate a bare origin. */
function parseSignatureAgent(raw: string): string {
  if (raw.startsWith('"')) {
    // minimal sf-string unquote (no interior escapes expected in an origin)
    const m = /^"((?:[^"\\]|\\["\\])*)"$/.exec(raw);
    if (!m) throw new Error('malformed Signature-Agent value');
    return m[1].replace(/\\(["\\])/g, '$1');
  }
  return raw;
}

export async function verifyWebBotAuth(opts: {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  /** host[:port] of the target URI; defaults to the Host header. */
  authority?: string;
  /** Epoch seconds "now" override (tests). */
  now?: number;
  /** Allowed clock skew in seconds (default 60). */
  skewSecs?: number;
  fetchJwks?: JwksFetcher;
}): Promise<WbaVerifyResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = opts.skewSecs ?? 60;
  const fetcher = opts.fetchJwks ?? defaultFetchJwks;

  try {
    // ── 1. Locate the agent's advertised key directory ──────────────────────
    const sigAgentRaw = firstHeader(opts.headers, 'signature-agent');
    if (!sigAgentRaw) return { ok: false, reason: 'missing Signature-Agent header' };
    let agentOrigin: string;
    try {
      agentOrigin = parseSignatureAgent(sigAgentRaw);
      const u = new URL(agentOrigin);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return { ok: false, reason: 'Signature-Agent must be an http(s) URL' };
      }
    } catch {
      return { ok: false, reason: 'Signature-Agent is not a valid URL' };
    }

    // ── 2. Parse Signature-Input / Signature; select the web-bot-auth member ─
    const sigInputRaw = firstHeader(opts.headers, 'signature-input');
    if (!sigInputRaw) return { ok: false, reason: 'missing Signature-Input header' };
    const sigRaw = firstHeader(opts.headers, 'signature');
    if (!sigRaw) return { ok: false, reason: 'missing Signature header' };

    let entries: SignatureInputEntry[];
    let signatures: Map<string, Buffer>;
    try {
      entries = parseSignatureInput(sigInputRaw);
      signatures = parseSignatureHeader(sigRaw);
    } catch (e) {
      return { ok: false, reason: `malformed signature headers: ${(e as Error).message}` };
    }

    const entry = entries.find((en) => en.params.tag === WBA_TAG);
    if (!entry) return { ok: false, reason: `no signature tagged "${WBA_TAG}"` };
    const signature = signatures.get(entry.label);
    if (!signature) return { ok: false, reason: `no Signature member for label "${entry.label}"` };

    // ── 3. Profile checks: covered components + signature params ────────────
    const names = entry.components.map((c) => c.name);
    if (!names.includes('@authority')) return { ok: false, reason: 'covered components must include @authority' };
    if (!names.includes('signature-agent')) return { ok: false, reason: 'covered components must include signature-agent' };

    const { created, expires, keyid, nonce } = entry.params;
    if (typeof created !== 'number') return { ok: false, reason: 'missing created param' };
    if (typeof expires !== 'number') return { ok: false, reason: 'missing expires param' };
    if (!keyid) return { ok: false, reason: 'missing keyid param' };
    if (!nonce) return { ok: false, reason: 'missing nonce param' };
    if (created > now + skew) return { ok: false, reason: 'created is in the future' };
    if (expires < now - skew) return { ok: false, reason: 'signature expired' };
    if (expires - created > MAX_SIG_LIFETIME_SECS) {
      return { ok: false, reason: `signature lifetime exceeds ${MAX_SIG_LIFETIME_SECS}s` };
    }

    // ── 4. Resolve the key from the agent's published JWKS directory ────────
    const directoryUrl = new URL(DIRECTORY_PATH, agentOrigin).toString();
    let keys: OkpJwk[];
    try {
      keys = await getDirectoryKeys(directoryUrl, fetcher);
    } catch (e) {
      return { ok: false, reason: `key directory fetch failed (${directoryUrl}): ${(e as Error).message}` };
    }
    const jwk = keys.find((k) => {
      if (k?.kty !== 'OKP' || k?.crv !== 'Ed25519' || !k?.x) return false;
      try { return jwkThumbprint(k as { kty: string; crv: string; x: string }) === keyid; } catch { return false; }
    });
    if (!jwk) return { ok: false, reason: 'keyid does not match any Ed25519 key in the agent directory' };

    // ── 5. Rebuild the signature base from THIS request and verify ──────────
    const authority = opts.authority ?? firstHeader(opts.headers, 'host');
    if (!authority) return { ok: false, reason: 'cannot determine request authority' };
    let base: string;
    try {
      base = buildSignatureBase(entry, {
        method: opts.method,
        path: opts.path,
        authority,
        headers: opts.headers,
      });
    } catch (e) {
      return { ok: false, reason: `signature base error: ${(e as Error).message}` };
    }
    const pub = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x } as crypto.JsonWebKey, format: 'jwk' });
    if (!verifyEd25519Signature(pub, base, signature)) {
      return { ok: false, reason: 'invalid signature' };
    }

    // ── 6. Nonce replay check (after crypto passes, mirroring dpopVerify) ───
    pruneNonces(Date.now());
    if (_seenNonces.has(nonce)) return { ok: false, reason: 'nonce replay' };
    _seenNonces.set(nonce, (expires + skew) * 1000);

    return { ok: true, keyid, signatureAgent: agentOrigin, label: entry.label };
  } catch (e) {
    return { ok: false, reason: `verification error: ${(e as Error).message}` };
  }
}
