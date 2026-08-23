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
  /** Resolves the verification key. Production passes a jose remote JWKS. */
  getKey: (
    protectedHeader?: jose.JWTHeaderParameters,
    token?: jose.FlattenedJWSInput,
  ) => Promise<crypto.KeyObject | jose.CryptoKey | Uint8Array>;
}

// ponytail: in-memory replay cache, single-process. A shared store is needed
// only if oauth-mcp is scaled to multiple replicas.
const seenJti = new Map<string, number>();

function rememberJti(jti: string, expSeconds: number): void {
  const nowMs = Date.now();
  for (const [key, expiresAtMs] of seenJti) {
    if (expiresAtMs <= nowMs) seenJti.delete(key);
  }
  seenJti.set(jti, expSeconds * 1000);
}

/** Test-only: clears the replay cache so each test starts fresh. */
export function resetReplayCacheForTests(): void {
  seenJti.clear();
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
