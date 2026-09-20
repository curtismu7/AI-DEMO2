/**
 * privilegeBridge — accept a call that arrived through the PingOne Privilege
 * AI Gateway.
 *
 * WHY THIS EXISTS. When Privilege fronts this gateway, the Authorization header
 * on its backend hop is Privilege's, not the caller's: it stamps the Static
 * Token configured on the Agentic App. Measured on the live gateway 2026-09-10
 * (privilege/CURRENT-CONFIGURATION.md, "Backend hop"):
 *
 *   - a custom request header survives the hop with its value unmodified, so
 *     the caller's own transaction token can travel in tx-token;
 *   - under Auth Mode None no Authorization arrives at all, which is why this
 *     gateway answered "Bearer token required" when probed directly.
 *
 * So the bridge credential has to be recognised BEFORE validateInboundToken,
 * which rejects a non-JWT at JWKS key selection ("Token has no kid header and
 * the JWKS exposes N keys" — measured), and the pipeline then runs on the
 * SUBJECT token so introspection, RFC 8693 exchange and PingOne Authorize all
 * see the real delegated user rather than a machine identity.
 *
 * SECURITY. The header is honoured ONLY when the bearer equals the configured
 * shared secret. From any other caller tx-token is ignored outright, so
 * it can never be used to assert an identity from outside the bridge. The
 * subject token itself is still validated normally — this module decides who
 * may present one, never whether it is genuine.
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** Header the BFF puts the caller's exchanged transaction token in. */
export const TRANSACTION_TOKEN_HEADER = 'tx-token';

/** A bearer slot is not a payload channel; refuse anything implausible for a JWT. */
const MAX_SUBJECT_TOKEN_BYTES = 8192;

/**
 * True when this request's bearer IS the configured Privilege bridge secret.
 * An unset secret disables the bridge entirely and can never match — including
 * against an empty bearer, which is the failure mode that would turn a missing
 * config into an open door.
 */
export function isPrivilegeBridgeBearer(bearer: string, secret: string): boolean {
  if (!secret || !bearer) return false;
  const a = Buffer.from(bearer, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  // timingSafeEqual throws on a length mismatch, so length is compared first.
  // Length is not itself a secret; the value is.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type TransactionTokenHeaderState = {
  present: boolean;
  value: string | null;
};

/**
 * Read the transaction header without collapsing invalid input into absence.
 * A missing header is meaningful for read-only Privilege discovery; an empty,
 * repeated, or oversized header is a malformed bridge request and must fail.
 */
export function transactionTokenHeaderState(headers: IncomingHttpHeaders): TransactionTokenHeaderState {
  const raw = headers[TRANSACTION_TOKEN_HEADER];
  if (raw === undefined) return { present: false, value: null };
  if (typeof raw !== 'string') return { present: true, value: null };
  const value = raw.trim();
  if (!value || Buffer.byteLength(value, 'utf8') > MAX_SUBJECT_TOKEN_BYTES) {
    return { present: true, value: null };
  }
  return { present: true, value };
}

/**
 * The caller's token as forwarded by Privilege, or null when absent or
 * implausible. Never throws: callers that need to distinguish malformed from
 * absent input should use transactionTokenHeaderState instead.
 */
export function transactionTokenFromHeaders(headers: IncomingHttpHeaders): string | null {
  return transactionTokenHeaderState(headers).value;
}
