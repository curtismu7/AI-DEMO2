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
  /** Ledger correlation id for this authorize, so the `oauth.authorize` hop and
   *  the `oauth.callback` hop that follows a PingOne round trip land on ONE
   *  record. Deliberately not `state`: that is a single-use CSRF token and the
   *  ledger is a readable audit surface. */
  correlationId?: string;
  /** RFC 8707 `resource` the client asked for. Names the façade door, which is
   *  how the callback knows to chain the Privilege gateway sign-in. */
  resource?: string;
  /** Browser-bound nonce for the Privilege link: set when this authorize will
   *  chain the BFF gateway sign-in, echoed by the browser's cookie at
   *  /oauth/resume so a link URL mailed to someone else cannot commit. */
  linkNonce?: string;
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

/** An authorization parked mid-flight while the BFF signs the browser in to
 *  the Privilege AI Gateway — everything /oauth/resume needs to issue the
 *  broker's own code once the browser comes back. */
export interface ResumableAuthorization {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientState: string;
  pingOneAccessToken: string;
  pingOneExpiresIn: number;
  correlationId?: string;
  /** The nonce /oauth/resume must see in the browser's cookie before committing. */
  linkNonce?: string;
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
  private resumable: Map<string, ResumableAuthorization> = new Map();

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

  createResume(params: Omit<ResumableAuthorization, 'id' | 'expiresAt'>, ttlMsOverride?: number): string {
    const id = crypto.randomBytes(32).toString('base64url');
    this.resumable.set(id, { ...params, id, expiresAt: Date.now() + (ttlMsOverride ?? PENDING_TTL_MS) });
    return id;
  }

  consumeResume(id: string): ResumableAuthorization | null {
    const entry = this.resumable.get(id);
    if (!entry) return null;
    this.resumable.delete(id);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }
}
