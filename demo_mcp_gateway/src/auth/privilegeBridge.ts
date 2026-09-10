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
 *     the caller's own token can travel in X-Subject-Token;
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
 * shared secret. From any other caller X-Subject-Token is ignored outright, so
 * it can never be used to assert an identity from outside the bridge. The
 * subject token itself is still validated normally — this module decides who
 * may present one, never whether it is genuine.
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** Header the BFF puts the caller's exchanged token in (mcpGatewayTransport.js). */
export const SUBJECT_TOKEN_HEADER = 'x-subject-token';

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

/**
 * The caller's token as forwarded by Privilege, or null when absent or
 * implausible. Never throws: a malformed header is simply "no subject".
 */
export function subjectTokenFromHeaders(headers: IncomingHttpHeaders): string | null {
  const raw = headers[SUBJECT_TOKEN_HEADER];
  // A repeated header arrives as an array. Joining it would let a caller smuggle
  // two identities into one slot, so refuse instead of guessing which is meant.
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (Buffer.byteLength(value, 'utf8') > MAX_SUBJECT_TOKEN_BYTES) return null;
  return value;
}
