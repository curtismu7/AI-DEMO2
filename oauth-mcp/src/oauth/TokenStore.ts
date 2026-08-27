import * as crypto from 'crypto';
import { IEncryptedTokenStorage } from '../storage/interfaces';

const PERSISTED_TOKENS_KEY = 'oauth-issued-tokens';

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
  private storage?: IEncryptedTokenStorage;

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
    // Fire-and-forget: a storage failure must not fail an otherwise valid
    // issuance. persistTokens() logs and swallows.
    void this.persistTokens();
  }

  introspect(jti: string): IssuedToken | null {
    return this.tokens.get(jti) ?? null;
  }

  revoke(jti: string): boolean {
    const token = this.tokens.get(jti);
    if (!token) return false;
    token.revoked = true;
    void this.persistTokens();
    return true;
  }

  /**
   * Attach durable storage and restore any tokens issued before the last
   * restart. Without this, a `kubectl rollout restart` (or any process
   * restart) silently orphans every in-flight external-door session: the
   * client's self-issued bearer stays valid (the embedded signing key
   * persists across restarts) but the real PingOne access token stashed
   * against its jti — the only thing that makes Step 9 work for a
   * federated login — vanishes, forcing a fresh login to test anything.
   * Safe to skip entirely — without it TokenStore behaves exactly as
   * before (in-memory only).
   */
  async attachStorage(storage: IEncryptedTokenStorage): Promise<void> {
    this.storage = storage;
    let saved: unknown;
    try {
      saved = await storage.retrieve(PERSISTED_TOKENS_KEY);
    } catch (err) {
      console.warn(`[TokenStore] could not read persisted tokens: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!Array.isArray(saved)) return;
    const now = Date.now();
    let restored = 0;
    for (const token of saved as IssuedToken[]) {
      if (!token?.jti || token.revoked) continue;
      // expiresAt is seconds-since-epoch (mirrors the JWT exp claim
      // convention) — see TokenResolver.ts's matching comment.
      if (now >= token.expiresAt * 1000) continue;
      this.tokens.set(token.jti, token);
      restored += 1;
    }
    if (restored > 0) console.log(`[TokenStore] restored ${restored} issued token(s)`);
  }

  private async persistTokens(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.store(PERSISTED_TOKENS_KEY, [...this.tokens.values()]);
    } catch (err) {
      console.warn(`[TokenStore] could not persist tokens: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  isRevoked(jti: string): boolean {
    const token = this.tokens.get(jti);
    return token?.revoked ?? false;
  }

  /** Purge expired codes, pending authorizations, and issued tokens periodically */
  cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) {
      if (now > v.expiresAt) this.codes.delete(k);
    }
    for (const [k, v] of this.pending) {
      if (now > v.expiresAt) this.pending.delete(k);
    }
    let tokensChanged = false;
    for (const [k, v] of this.tokens) {
      if (now >= v.expiresAt * 1000) {
        this.tokens.delete(k);
        tokensChanged = true;
      }
    }
    // Only persisted tokens need cleanup here — pruning expired entries
    // keeps the on-disk copy from growing unbounded.
    if (tokensChanged) void this.persistTokens();
  }
}
