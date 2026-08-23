/**
 * IdJagGrantHandler.test.ts — ID-JAG verification guards.
 *
 * Follows the pattern established by tests/forged-token-actor-chain.test.ts:
 * jest.config.js maps `jose` to a CJS shim whose jwtVerify always throws (jose v6
 * is ESM-only and real ESM needs --experimental-vm-modules, which this repo has
 * deliberately avoided twice). So the double below does GENUINE HMAC crypto —
 * a wrong-key or tampered assertion really fails to verify — and faithfully
 * honours jose's `algorithms` / `issuer` / `audience` / `clockTolerance` options.
 *
 * That last part is what makes the alg:none case a real guard rather than a
 * self-fulfilling one: production passes `algorithms: ['RS256']`, and if anyone
 * deletes that option the double stops rejecting `alg: none` and this suite
 * goes red.
 *
 * Only the signing algorithm and key transport are doubled. verifyIdJag itself —
 * the typ check, the resource allow-list, the jti single-use cache, the claim
 * mapping — is the real production code.
 */

import { createHmac } from 'crypto';

const SIGNING_KEY = 'correct-signing-key';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function hmacSign(signingInput: string, key: string): string {
  return createHmac('sha256', key).update(signingInput).digest('base64url');
}

jest.mock('jose', () => ({
  // Real HMAC verification with jose's option semantics.
  jwtVerify: async (
    token: string,
    keyOrResolver: unknown,
    options: {
      algorithms?: string[];
      issuer?: string;
      audience?: string;
      clockTolerance?: number;
    } = {},
  ) => {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('JWSInvalid: token is malformed');
    const [rawHeader, rawPayload, signature] = parts;

    let protectedHeader: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      protectedHeader = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'));
    } catch {
      throw new Error('JWSInvalid: token is malformed');
    }

    // jose refuses any alg outside the caller's allow-list. This is what makes
    // `alg: none` fail — NOT a special case for it.
    const alg = String(protectedHeader.alg || '');
    if (options.algorithms && !options.algorithms.includes(alg)) {
      throw new Error(`JOSEAlgNotAllowed: "alg" (${alg}) not allowed`);
    }

    const key =
      typeof keyOrResolver === 'function'
        ? await (keyOrResolver as (h: unknown) => Promise<unknown>)(protectedHeader)
        : keyOrResolver;

    if (signature !== hmacSign(`${rawHeader}.${rawPayload}`, String(key))) {
      throw new Error('JWSSignatureVerificationFailed: signature verification failed');
    }

    if (options.issuer && payload.iss !== options.issuer) {
      throw new Error('JWTClaimValidationFailed: unexpected "iss" claim value');
    }
    if (options.audience && payload.aud !== options.audience) {
      throw new Error('JWTClaimValidationFailed: unexpected "aud" claim value');
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp + (options.clockTolerance || 0) < now) {
      throw new Error('JWTExpired: "exp" claim timestamp check failed');
    }

    return { payload, protectedHeader };
  },
}));

// eslint-disable-next-line import/first
import { verifyIdJag, IdJagError, resetReplayCacheForTests } from '../IdJagGrantHandler';

const IDP_ISSUER = 'https://idp.ping.demo';
const AS_ISSUER = 'https://mcpserver.ping.demo:8080';
const RESOURCE = 'https://mcpserver.ping.demo';

const OPTS = () => ({
  idpIssuer: IDP_ISSUER,
  ownIssuer: AS_ISSUER,
  acceptedResources: [RESOURCE],
  getKey: async () => SIGNING_KEY as unknown as never,
});

let jtiCounter = 0;

function mintIdJag(
  claimOverrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
  key: string = SIGNING_KEY,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'oauth-id-jag+jwt', ...headerOverrides };
  const payload = {
    jti: `jti-${++jtiCounter}`,
    iss: IDP_ISSUER,
    sub: 'user-123',
    email: 'alice@example.com',
    aud: AS_ISSUER,
    resource: RESOURCE,
    client_id: 'demo-bff-mcp-client',
    scope: 'banking:read',
    iat: now,
    exp: now + 120,
    ...claimOverrides,
  };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  return `${signingInput}.${hmacSign(signingInput, key)}`;
}

beforeEach(() => resetReplayCacheForTests());

describe('verifyIdJag', () => {
  it('accepts a well-formed assertion and returns its claims', async () => {
    const claims = await verifyIdJag(mintIdJag(), OPTS());
    expect(claims.sub).toBe('user-123');
    expect(claims.email).toBe('alice@example.com');
    expect(claims.resource).toBe(RESOURCE);
    expect(claims.scope).toBe('banking:read');
  });

  it('rejects alg:none — an unsigned assertion is attacker-authored', async () => {
    const header = b64url({ alg: 'none', typ: 'oauth-id-jag+jwt' });
    const payload = b64url({
      jti: 'forged', iss: IDP_ISSUER, sub: 'user-123', aud: AS_ISSUER,
      resource: RESOURCE, scope: 'banking:read', exp: Math.floor(Date.now() / 1000) + 120,
    });
    await expect(verifyIdJag(`${header}.${payload}.`, OPTS())).rejects.toThrow(IdJagError);
  });

  // THE guard on algorithm pinning. The alg:none case above cannot prove it:
  // an alg:none token carries an empty signature, so it is rejected by the
  // signature check whether or not `algorithms` is pinned — the two reasons are
  // indistinguishable. This assertion is signed CORRECTLY, and is rejected only
  // because HS256 is not in the allow-list. Delete `algorithms: ['RS256']` from
  // verifyIdJag and this is the test that goes red. Verified by reverting.
  it('rejects a correctly-signed assertion using a non-allowed algorithm', async () => {
    await expect(verifyIdJag(mintIdJag({}, { alg: 'HS256' }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects a signature made with the wrong key', async () => {
    await expect(verifyIdJag(mintIdJag({}, {}, 'attacker-key'), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects a tampered payload', async () => {
    const good = mintIdJag();
    const [h, , s] = good.split('.');
    const tampered = b64url({ jti: 'x', iss: IDP_ISSUER, sub: 'admin', aud: AS_ISSUER, resource: RESOURCE, exp: Math.floor(Date.now() / 1000) + 120 });
    await expect(verifyIdJag(`${h}.${tampered}.${s}`, OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects a wrong typ header', async () => {
    await expect(verifyIdJag(mintIdJag({}, { typ: 'JWT' }), OPTS())).rejects.toThrow(/typ/i);
  });

  it('rejects an assertion from an unknown issuer', async () => {
    await expect(verifyIdJag(mintIdJag({ iss: 'https://evil.example' }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects an assertion audienced at another AS', async () => {
    await expect(verifyIdJag(mintIdJag({ aud: 'https://other.as' }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects a resource this server does not serve', async () => {
    await expect(verifyIdJag(mintIdJag({ resource: 'https://evil.example' }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects an expired assertion', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyIdJag(mintIdJag({ exp: now - 60 }), OPTS())).rejects.toThrow(IdJagError);
  });

  it('rejects replay of the same jti', async () => {
    const assertion = mintIdJag({ jti: 'replay-me' });
    await expect(verifyIdJag(assertion, OPTS())).resolves.toBeTruthy();
    await expect(verifyIdJag(assertion, OPTS())).rejects.toThrow(/replay|already/i);
  });

  it('rejects an assertion with no jti — single-use cannot be enforced', async () => {
    await expect(verifyIdJag(mintIdJag({ jti: undefined }), OPTS())).rejects.toThrow(/jti/i);
  });

  it('reports invalid_target for a bad resource so the client can tell it apart', async () => {
    await expect(verifyIdJag(mintIdJag({ resource: 'https://evil.example' }), OPTS()))
      .rejects.toMatchObject({ oauthError: 'invalid_target' });
  });
});
