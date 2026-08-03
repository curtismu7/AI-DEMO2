import * as crypto from 'crypto';

export interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  subject: string;
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
}

/**
 * In-memory store for authorization codes and issued tokens.
 * Codes expire after 60s. Tokens tracked for introspection/revocation.
 */
export class TokenStore {
  private codes: Map<string, AuthorizationCode> = new Map();
  private tokens: Map<string, IssuedToken> = new Map();

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

  /** Purge expired codes periodically */
  cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) {
      if (now > v.expiresAt) this.codes.delete(k);
    }
  }
}
