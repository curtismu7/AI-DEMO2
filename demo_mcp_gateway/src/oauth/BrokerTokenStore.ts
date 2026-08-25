import * as crypto from 'crypto';

export interface PendingAuthorization {
  state: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  /** The original external client's own `state` — relayed back once the
   *  PingOne hop completes. Never sent to PingOne itself. */
  clientState: string;
  /** PKCE verifier the BROKER generated for its own hop to PingOne —
   *  distinct from `codeChallenge`, which belongs to the external client's
   *  PKCE against this broker. */
  pingOneCodeVerifier: string;
  expiresAt: number;
}

export interface IssuedCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  /** The EXTERNAL client's own PKCE challenge (from /oauth/authorize) —
   *  carried through so /oauth/token can verify the external client's
   *  code_verifier before releasing the token. Without this, the broker's
   *  own authorization code would have no PKCE protection at all. */
  codeChallenge: string;
  codeChallengeMethod: string;
  /** The real, unmodified PingOne access token — this IS the artifact the
   *  external client ultimately receives from /oauth/token. */
  pingOneAccessToken: string;
  pingOneExpiresIn: number;
  expiresAt: number;
}

const PENDING_TTL_MS = 600_000; // 10 minutes — a real PingOne login takes longer than a code exchange
const CODE_TTL_MS = 60_000;

/**
 * In-memory store bridging the external client's outer OAuth leg to the
 * broker's inner PingOne leg. No self-issued tokens live here — unlike
 * oauth-mcp's TokenStore, there is no `trackToken`/`introspect`/`revoke`,
 * because this broker never mints its own bearer; it only relays PingOne's.
 */
export class BrokerTokenStore {
  private pending: Map<string, PendingAuthorization> = new Map();
  private codes: Map<string, IssuedCode> = new Map();

  createPendingAuthorization(params: Omit<PendingAuthorization, 'state' | 'expiresAt'>): string {
    const state = crypto.randomBytes(32).toString('base64url');
    this.pending.set(state, { ...params, state, expiresAt: Date.now() + PENDING_TTL_MS });
    return state;
  }

  consumePendingAuthorization(state: string): PendingAuthorization | null {
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }

  createCode(params: Omit<IssuedCode, 'code' | 'expiresAt'>, ttlMsOverride?: number): string {
    const code = crypto.randomBytes(32).toString('base64url');
    this.codes.set(code, {
      ...params,
      code,
      expiresAt: Date.now() + (ttlMsOverride ?? CODE_TTL_MS),
    });
    return code;
  }

  consumeCode(code: string): IssuedCode | null {
    const entry = this.codes.get(code);
    if (!entry) return null;
    this.codes.delete(code);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }
}
