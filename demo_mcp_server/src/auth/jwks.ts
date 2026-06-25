/**
 * Shared JWKS / jose helpers for token signature verification.
 *
 * jose v6+ is ESM-only; loaded via dynamic import() to stay compatible with CJS
 * compilation. Both the inbound trust boundary (TokenIntrospector) and the
 * sensitive-tool claim verifier (JwtClaimVerifier) use these so the JWKS-URI
 * precedence and jose loading live in exactly one place.
 *
 * Each caller memoises the returned keyset on its own field — createRemoteJWKSet
 * maintains its own internal key cache, so a per-caller memo is enough.
 */

// Lazy-loaded jose module — resolved once per process.
export type JoseModule = typeof import('jose');
let josePromise: Promise<JoseModule> | null = null;
export function getJose(): Promise<JoseModule> {
  if (!josePromise) josePromise = import('jose') as Promise<JoseModule>;
  return josePromise;
}

/**
 * Resolve PingOne's JWKS endpoint from env. Precedence:
 *   PINGONE_JWKS_URI  →  PINGONE_ISSUER + /jwks  →  PINGONE_BASE_URL + /jwks
 * Returns null when none is configured.
 */
export function resolveJwksUri(): string | null {
  return (
    process.env.PINGONE_JWKS_URI ||
    (process.env.PINGONE_ISSUER ? `${process.env.PINGONE_ISSUER}/jwks` : null) ||
    (process.env.PINGONE_BASE_URL ? `${process.env.PINGONE_BASE_URL}/jwks` : null)
  );
}

/**
 * Create a remote JWKS keyset for the configured PingOne endpoint, or null when
 * no JWKS endpoint is configured / the URL is invalid. Callers should memoise.
 */
export async function createJwksKeySet(): Promise<Awaited<ReturnType<JoseModule['createRemoteJWKSet']>> | null> {
  const jwksUri = resolveJwksUri();
  if (!jwksUri) return null;
  try {
    const { createRemoteJWKSet } = await getJose();
    return createRemoteJWKSet(new URL(jwksUri));
  } catch {
    return null;
  }
}
