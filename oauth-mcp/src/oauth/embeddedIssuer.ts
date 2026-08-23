import { SigningKeyManager } from './SigningKeyManager';

/**
 * Single source of truth for the embedded OAuth AS's issuer string, shared by
 * TokenIssuer (signs with it) and the token-verification path (checks against
 * it) so a self-issued token's `iss` claim and the value that authenticates
 * it never drift apart.
 */
export function resolveEmbeddedIssuer(): string {
  return (
    process.env.OAUTH_ISSUER ||
    `https://${process.env.OAUTH_HOSTNAME || 'localhost'}:${process.env.MCP_SERVER_PORT || '8080'}`
  );
}

/**
 * The authorization server this instance advertises in its RFC 9728 metadata
 * (`authorization_servers`) — the AS a client is told to go and get a token from.
 *
 * Normally that is PingOne: the gateway fronts this server, the token on the
 * wire is PingOne-issued, and the embedded AS is an internal detail.
 *
 * Setting OAUTH_ISSUER inverts that. It is only ever set on an instance whose
 * embedded AS is externally addressable — the external door that ChatGPT and
 * Claude register against — and on such an instance advertising PingOne would
 * send the client somewhere it cannot dynamically register, stranding it before
 * it ever asks for a token. Naming the embedded AS instead keeps discovery,
 * registration, /token and the audience of the resulting JWT on one origin.
 *
 * Unset (every gateway-fronted deployment), `pingOneFallback` is returned and
 * nothing changes.
 */
export function resolveAdvertisedAuthServer(pingOneFallback: string): string {
  return process.env.OAUTH_ISSUER || pingOneFallback;
}

let signingKeyManagerPromise: Promise<SigningKeyManager> | null = null;

/**
 * Lazily creates and memoises the embedded AS's RSA signing key. OAuthRouter
 * (via TokenIssuer) signs with it; TokenIntrospector verifies with it — both
 * must resolve the exact same key pair, which is why this isn't just
 * `new SigningKeyManager()` at each call site.
 */
export function getEmbeddedSigningKeyManager(): Promise<SigningKeyManager> {
  if (!signingKeyManagerPromise) {
    signingKeyManagerPromise = (async () => {
      const manager = new SigningKeyManager();
      await manager.initialize();
      return manager;
    })();
  }
  return signingKeyManagerPromise;
}

/** Test-only: clears the memoised singleton so each test starts fresh. */
export function resetEmbeddedSigningKeyManagerForTests(): void {
  signingKeyManagerPromise = null;
}
