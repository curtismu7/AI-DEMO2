/**
 * H2 regression — agent-token signature verification must FAIL CLOSED when the
 * JWKS endpoint is unreachable, instead of silently accepting an unverifiable
 * (possibly forged) token. Verifies the last-known-good fallback, the
 * ALLOW_JWKS_FAILOPEN opt-in, and that a real signature mismatch always rejects.
 */

import axios from 'axios';
import { TokenIntrospector } from '../../src/auth/TokenIntrospector';
import { AuthenticationError } from '../../src/interfaces/auth';
import * as jwksModule from '../../src/auth/jwks';

jest.mock('axios');
jest.mock('../../src/auth/jwks');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedJwks = jwksModule as jest.Mocked<typeof jwksModule>;

const CONFIG = {
  baseUrl: 'https://as.example.com',
  clientId: 'cid',
  clientSecret: 'secret',
  tokenIntrospectionEndpoint: 'https://as.example.com/introspect',
  authorizationEndpoint: 'https://as.example.com/authorize',
  tokenEndpoint: 'https://as.example.com/token',
} as any;

// Recognised by isJwksUnavailableError → treated as an outage, not a forged sig.
const OUTAGE_ERR = new Error('fetch failed');
// A real crypto failure → must fail closed regardless of opt-in.
const MISMATCH_ERR = new Error('signature verification failed');

function makeJwt(claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.sig`;
}

describe('TokenIntrospector — JWKS outage fails closed (H2)', () => {
  const ORIG = { ...process.env };
  let ti: TokenIntrospector;
  let jwtVerify: jest.Mock;

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({ post: jest.fn(), get: jest.fn() } as any);
    // A truthy fake resolver so verifyTokenSignature enters the verify path.
    mockedJwks.createJwksKeySet.mockResolvedValue((() => {}) as any);
    jwtVerify = jest.fn();
    mockedJwks.getJose.mockResolvedValue({ jwtVerify } as any);
    delete process.env.STRICT_AUTH;
    delete process.env.ALLOW_JWKS_FAILOPEN;
    delete process.env.SKIP_TOKEN_SIGNATURE_VALIDATION;
    ti = new TokenIntrospector(CONFIG);
  });
  afterEach(() => { process.env = { ...ORIG }; jest.clearAllMocks(); });

  const verify = (tok: string) => (ti as any).verifyTokenSignature(tok) as Promise<void>;

  it('outage + no opt-in → fail closed (rejects)', async () => {
    jwtVerify.mockRejectedValue(OUTAGE_ERR); // primary + retry both fail
    await expect(verify(makeJwt({ sub: 'a' }))).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('outage + ALLOW_JWKS_FAILOPEN=true → accepts (resolves)', async () => {
    process.env.ALLOW_JWKS_FAILOPEN = 'true';
    jwtVerify.mockRejectedValue(OUTAGE_ERR);
    await expect(verify(makeJwt({ sub: 'a' }))).resolves.toBeUndefined();
  });

  it('outage + STRICT_AUTH=true → fail closed even with opt-in set', async () => {
    process.env.STRICT_AUTH = 'true';
    process.env.ALLOW_JWKS_FAILOPEN = 'true';
    jwtVerify.mockRejectedValue(OUTAGE_ERR);
    await expect(verify(makeJwt({ sub: 'a' }))).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('real signature mismatch → fail closed regardless of opt-in', async () => {
    process.env.ALLOW_JWKS_FAILOPEN = 'true';
    jwtVerify.mockRejectedValue(MISMATCH_ERR);
    await expect(verify(makeJwt({ sub: 'a' }))).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('last-known-good: after a success, an outage verifies against the cached keyset', async () => {
    // 1st verify succeeds → caches last-known-good
    jwtVerify.mockResolvedValueOnce(undefined);
    await expect(verify(makeJwt({ sub: 'ok' }))).resolves.toBeUndefined();

    // 2nd verify: primary + retry hit the outage, but last-known-good verifies
    jwtVerify
      .mockRejectedValueOnce(OUTAGE_ERR)  // primary
      .mockRejectedValueOnce(OUTAGE_ERR)  // retry (fresh resolver)
      .mockResolvedValueOnce(undefined);  // last-known-good keyset
    await expect(verify(makeJwt({ sub: 'ok2' }))).resolves.toBeUndefined();
  });

  it('last-known-good present but token is forged → fail closed', async () => {
    jwtVerify.mockResolvedValueOnce(undefined); // seed last-known-good
    await verify(makeJwt({ sub: 'ok' }));

    jwtVerify
      .mockRejectedValueOnce(OUTAGE_ERR)   // primary
      .mockRejectedValueOnce(OUTAGE_ERR)   // retry
      .mockRejectedValueOnce(MISMATCH_ERR); // last-known-good rejects a forged sig
    await expect(verify(makeJwt({ sub: 'forged' }))).rejects.toBeInstanceOf(AuthenticationError);
  });
});
