import * as jose from 'jose';
import * as crypto from 'crypto';

/**
 * ID-JAG verification for the MCP Enterprise-Managed Authorization extension.
 *
 * The assertion IS the authorization: anything unverified here is
 * attacker-authored. Every check therefore fails closed, and RS256 is pinned so
 * a downgrade to an unsigned (alg:none) or symmetric assertion cannot be
 * negotiated by the presenter.
 *
 * @see https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
 */

export const ID_JAG_TYP = 'oauth-id-jag+jwt';
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const ID_JAG_GRANT_PROFILE = 'urn:ietf:params:oauth:grant-profile:id-jag';

export class IdJagError extends Error {
  public oauthError: string;

  constructor(message: string, oauthError = 'invalid_grant') {
    super(message);
    this.name = 'IdJagError';
    this.oauthError = oauthError;
  }
}

export interface IdJagClaims {
  jti: string;
  iss: string;
  sub: string;
  email?: string;
  aud: string;
  resource: string;
  client_id?: string;
  scope: string;
  exp: number;
  iat: number;
}

export interface VerifyOpts {
  idpIssuer: string;
  ownIssuer: string;
  acceptedResources: string[];
  /**
   * The client_id that authenticated at the token endpoint. The ID-JAG names the
   * client it was issued to; presenting it from any other client is refused so a
   * leaked assertion cannot be redeemed by a different registered client.
   */
  clientId?: string;
  /**
   * IdP-side client id -> this server's client id. The spec's client_id is the
   * client's identifier at the resource AS, but an IdP such as PingFederate may
   * fill it from the client the user's refresh token belongs to (a different id).
   * An entry here lets that value stand for the redeeming client; anything not
   * listed must still equal the redeeming client exactly.
   */
  clientAliases?: Record<string, string>;
  /** Only clientAliases count: an unlisted client_id is refused even if it equals clientId. */
  strictClientBinding?: boolean;
  /** Accept an ID-JAG with no client_id claim (IdP not yet emitting it). Off by default. */
  allowUnboundClient?: boolean;
  /** Resolves the verification key. Production passes a jose remote JWKS. */
  getKey: (
    protectedHeader?: jose.JWTHeaderParameters,
    token?: jose.FlattenedJWSInput,
  ) => Promise<crypto.KeyObject | jose.CryptoKey | Uint8Array>;
}

// Replay cache. Process-local by default; attachReplayStorage() makes it survive
// a restart by mirroring it into the same encrypted store the token store uses.
// That is still one replica's view: running several oauth-mcp replicas needs a
// store they all share (the k8s deployment runs exactly one).
const seenJti = new Map<string, number>();
const REPLAY_KEY = 'id-jag-replay';
let replayStorage: ReplayStorage | undefined;

/** The slice of IEncryptedTokenStorage the replay cache needs. */
export interface ReplayStorage {
  store(key: string, data: unknown): Promise<void>;
  retrieve(key: string): Promise<unknown | null>;
}

function persistReplay(): void {
  if (!replayStorage) return;
  replayStorage.store(REPLAY_KEY, Object.fromEntries(seenJti)).catch((err: unknown) => {
    console.warn(`[IdJag] could not persist replay cache: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/** Restore still-live jtis after a restart, then keep the store in step. */
export async function attachReplayStorage(storage: ReplayStorage): Promise<void> {
  replayStorage = storage;
  try {
    const saved = await storage.retrieve(REPLAY_KEY);
    if (saved && typeof saved === 'object') {
      const nowMs = Date.now();
      for (const [jti, expiresAtMs] of Object.entries(saved as Record<string, number>)) {
        if (typeof expiresAtMs === 'number' && expiresAtMs > nowMs) seenJti.set(jti, expiresAtMs);
      }
    }
  } catch (err) {
    console.warn(`[IdJag] could not read persisted replay cache: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function rememberJti(jti: string, expSeconds: number): void {
  const nowMs = Date.now();
  for (const [key, expiresAtMs] of seenJti) {
    if (expiresAtMs <= nowMs) seenJti.delete(key);
  }
  seenJti.set(jti, expSeconds * 1000);
  persistReplay();
}

/** Test-only: clears the replay cache so each test starts fresh. */
export function resetReplayCacheForTests(): void {
  seenJti.clear();
  replayStorage = undefined;
}

/**
 * Verify an ID-JAG assertion and return its claims.
 * Throws IdJagError on any failure — never returns partial claims.
 */
export async function verifyIdJag(assertion: string, opts: VerifyOpts): Promise<IdJagClaims> {
  let payload: jose.JWTPayload;
  let protectedHeader: jose.JWTHeaderParameters;

  try {
    // jose enforces iss/aud/exp and, with algorithms pinned, rejects `alg: none`.
    const result = await jose.jwtVerify(assertion, opts.getKey as jose.JWTVerifyGetKey, {
      algorithms: ['RS256'],
      issuer: opts.idpIssuer,
      audience: opts.ownIssuer,
      clockTolerance: 5,
    });
    payload = result.payload;
    protectedHeader = result.protectedHeader as jose.JWTHeaderParameters;
  } catch (err) {
    throw new IdJagError(`ID-JAG verification failed: ${(err as Error).message}`);
  }

  // draft-ietf-oauth-identity-assertion-authz-grant: iss, sub, aud, client_id, jti, exp
  // and iat are REQUIRED; jose only checks exp/iat when present. An array aud is
  // allowed only with a single element.
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
    throw new IdJagError('ID-JAG must carry numeric exp and iat');
  }
  if (Array.isArray(payload.aud) && payload.aud.length !== 1) {
    throw new IdJagError('ID-JAG aud must name exactly one authorization server');
  }

  if (protectedHeader.typ !== ID_JAG_TYP) {
    throw new IdJagError(`ID-JAG must carry typ "${ID_JAG_TYP}", got "${protectedHeader.typ}"`);
  }

  const resource = payload.resource as string | undefined;
  if (!resource || !opts.acceptedResources.includes(resource)) {
    throw new IdJagError(
      `ID-JAG resource "${resource}" is not served by this authorization server`,
      'invalid_target',
    );
  }

  // Client binding runs BEFORE the jti is consumed: a wrong-client attempt must
  // not burn a still-valid assertion for its rightful holder.
  if (opts.clientId !== undefined) {
    const boundClient = payload.client_id as string | undefined;
    if (!boundClient) {
      if (!opts.allowUnboundClient) {
        throw new IdJagError('ID-JAG carries no client_id; it cannot be bound to the redeeming client');
      }
    } else if (opts.strictClientBinding) {
      // Alias values are strings; an inherited key (e.g. "constructor") never equals clientId.
      if (opts.clientAliases?.[boundClient] !== opts.clientId) {
        throw new IdJagError('ID-JAG client_id is not assigned to this IdP');
      }
    } else if (boundClient !== opts.clientId && opts.clientAliases?.[boundClient] !== opts.clientId) {
      throw new IdJagError('ID-JAG was issued to a different client');
    }
  }

  const jti = payload.jti as string | undefined;
  if (!jti) throw new IdJagError('ID-JAG is missing jti; single-use cannot be enforced');
  if (seenJti.has(jti)) throw new IdJagError('ID-JAG already redeemed (replay rejected)');
  rememberJti(jti, payload.exp as number);

  return {
    jti,
    iss: payload.iss as string,
    sub: payload.sub as string,
    email: payload.email as string | undefined,
    aud: opts.ownIssuer,
    resource,
    client_id: payload.client_id as string | undefined,
    scope: (payload.scope as string) || '',
    exp: payload.exp as number,
    iat: payload.iat as number,
  };
}
