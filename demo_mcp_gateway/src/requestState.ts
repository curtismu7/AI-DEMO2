'use strict';

/**
 * MCP spec 2026-07-28 MRTR: signed, self-contained `requestState`.
 *
 * A Modern caller has no Mcp-Session-Id, so the elicitation record can no
 * longer hang off a session in memory. The state the client echoes on its
 * retry is instead an HMAC-signed token that carries what the gateway must
 * re-check: the tool, the authenticated principal, a digest of the tool
 * arguments that were put to the human, an expiry, and a one-time id. Any
 * replica holding the same secret can verify it.
 *
 * Spec (basic/patterns/mrtr): requestState is attacker-controlled input and,
 * because it influences authorization here, MUST be integrity-protected and
 * rejected when verification fails; it SHOULD carry the principal, a short
 * TTL and a request identifier; and single-use "MUST" be enforced
 * server-side — the signature does not do that, so redeemed ids are
 * remembered until they expire.
 *
 * Secret: GW_REQUEST_STATE_SECRET. Unset, a random per-process secret is used —
 * safe, but a token minted by one replica fails on another and does not
 * survive a restart. The redeemed-id memory is in-process either way, so across
 * replicas a token can be redeemed once per replica inside its TTL (TECH_DEBT).
 */

import * as crypto from 'crypto';

const PREFIX = 'gw1';
const DEFAULT_TTL_MS = 120_000;

export interface RequestStateBinding {
  tool: string;
  /** Authenticated principal (token `sub`). */
  sub: string;
  /** digestToolArgs() of the arguments the human was asked about. */
  argsDigest: string;
}

let secret: Buffer | undefined;
function getSecret(): Buffer {
  if (!secret) {
    const configured = process.env.GW_REQUEST_STATE_SECRET;
    secret = configured && configured.length >= 16
      ? Buffer.from(configured, 'utf-8')
      : crypto.randomBytes(32);
  }
  return secret;
}

function sign(data: string): string {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

/** key-order-independent JSON, so the same arguments always digest the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function digestToolArgs(args: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(args ?? {})).digest('base64url');
}

/** jti -> expiry (ms). Redeemed tokens stay here until they would have expired anyway. */
const redeemed = new Map<string, number>();

function pruneRedeemed(now: number): void {
  for (const [jti, exp] of redeemed) if (exp <= now) redeemed.delete(jti);
}

export function mintRequestState(binding: RequestStateBinding, ttlMs = DEFAULT_TTL_MS): string {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    jti: crypto.randomUUID(),
    tool: binding.tool,
    sub: binding.sub,
    ad: binding.argsDigest,
    exp: Date.now() + ttlMs,
  })).toString('base64url');
  const body = `${PREFIX}.${payload}`;
  return `${body}.${sign(body)}`;
}

/**
 * Verify and redeem. True only when the signature holds, the token has not
 * expired, it was minted for exactly this tool + principal + arguments, and it
 * has not been redeemed before. Any failure returns false and redeems nothing.
 */
export function consumeRequestState(token: string, expected: RequestStateBinding): boolean {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  const body = `${parts[0]}.${parts[1]}`;
  const given = Buffer.from(parts[2], 'base64url');
  const want = Buffer.from(sign(body), 'base64url');
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false;

  let p: { v?: number; jti?: string; tool?: string; sub?: string; ad?: string; exp?: number };
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')); } catch { return false; }
  const now = Date.now();
  if (p.v !== 1 || typeof p.jti !== 'string' || typeof p.exp !== 'number' || p.exp <= now) return false;
  if (p.tool !== expected.tool || p.sub !== expected.sub || p.ad !== expected.argsDigest) return false;

  pruneRedeemed(now);
  if (redeemed.has(p.jti)) return false;
  redeemed.set(p.jti, p.exp);
  return true;
}

export function _resetRequestStateForTest(): void {
  redeemed.clear();
  secret = undefined;
}
