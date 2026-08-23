import * as crypto from 'crypto';

export interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  subject: string;
  /** The real PingOne access token obtained during federation (see
   *  OAuthRouter.handleAuthorizeCallback) — carried through to the issued
   *  token so Step 9 can present it, not the embedded AS's own self-signed
   *  JWT, which PingOne cannot recognize as a subject_token. */
  pingOneAccessToken?: string;
  expiresAt: number;
}

export interface IssuedToken {
  jti: string;
  clientId: string;
  subject: string;
  scope: string;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
  /** See AuthorizationCode.pingOneAccessToken — present only for tokens
   *  minted via a real PingOne authorization_code federation. */
  pingOneAccessToken?: string;
}

export interface PendingAuthorization {
  state: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  /** The ORIGINAL client's own `state` param — relayed back to it once the
   *  PingOne hop completes. Never sent to PingOne itself (see OAuthRouter). */
  clientState: string;
  /** PKCE verifier oauth-mcp generated for its OWN outbound hop to PingOne
   *  (distinct from `codeChallenge`, which belongs to the downstream client's
   *  PKCE against this AS). Held here so /authorize/callback can present
   *  `code_verifier` on the PingOne token exchange. */
  pingOneCodeVerifier: string;
  expiresAt: number;
}

/**
 * In-memory store for authorization codes and issued tokens.
 * Codes expire after 60s. Tokens tracked for introspection/revocation.
 */
export class TokenStore {
  private codes: Map<string, AuthorizationCode> = new Map();
  private tokens: Map<string, IssuedToken> = new Map();
  private pending: Map<string, PendingAuthorization> = new Map();

  createCode(params: Omit<AuthorizationCode, 'code' | 'expiresAt'>): string {
    const code = crypto.randomBytes(32).toString('base64url');
    this.codes.set(code, {
      ...params,
      code,
      expiresAt: Date.now() + 60_000,
    });
    return code;
  }

  consumeCode(code: string): AuthorizationCode | null {
    const entry = this.codes.get(code);
    if (!entry) return null;
    this.codes.delete(code);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }

  createPendingAuthorization(params: Omit<PendingAuthorization, 'state' | 'expiresAt'>): string {
    const state = crypto.randomBytes(32).toString('base64url');
    this.pending.set(state, {
      ...params,
      state,
      expiresAt: Date.now() + 600_000, // 10 minutes — a real PingOne login takes longer than a code exchange
    });
    return state;
  }

  consumePendingAuthorization(state: string): PendingAuthorization | null {
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }

  trackToken(token: IssuedToken): void {
    this.tokens.set(token.jti, token);
  }

  introspect(jti: string): IssuedToken | null {
    return this.tokens.get(jti) ?? null;
  }

  revoke(jti: string): boolean {
    const token = this.tokens.get(jti);
    if (!token) return false;
    token.revoked = true;
    return true;
  }

  isRevoked(jti: string): boolean {
    const token = this.tokens.get(jti);
    return token?.revoked ?? false;
  }

  /** Purge expired codes and pending authorizations periodically */
  cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) {
      if (now > v.expiresAt) this.codes.delete(k);
    }
    for (const [k, v] of this.pending) {
      if (now > v.expiresAt) this.pending.delete(k);
    }
  }
}
