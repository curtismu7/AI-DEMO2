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
