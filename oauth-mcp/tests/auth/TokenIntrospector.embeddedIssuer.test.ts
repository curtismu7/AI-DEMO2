/**
 * A token whose `iss` matches oauth-mcp's own embedded AS must verify against
 * the embedded AS's local RSA key (no network), not PingOne's remote JWKS —
 * and must NOT be rejected just because PINGONE_JWKS_URI/PINGONE_ISSUER/
 * PINGONE_BASE_URL happen to be unset or unreachable.
 */
import axios from 'axios';
import { TokenIntrospector } from '../../src/auth/TokenIntrospector';
import { AuthenticationError } from '../../src/interfaces/auth';
import * as jwksModule from '../../src/auth/jwks';
import { getEmbeddedSigningKeyManager, resolveEmbeddedIssuer, resetEmbeddedSigningKeyManagerForTests } from '../../src/oauth/embeddedIssuer';

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

function makeJwt(claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.sig`;
}

describe('TokenIntrospector — embedded-issuer tokens verify locally', () => {
  const ORIG = { ...process.env };
  let ti: TokenIntrospector;
  let jwtVerify: jest.Mock;

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({ post: jest.fn(), get: jest.fn() } as any);
    jwtVerify = jest.fn();
    mockedJwks.getJose.mockResolvedValue({ jwtVerify } as any);
    // No PingOne JWKS configured — proves the embedded path doesn't need it.
    mockedJwks.createJwksKeySet.mockResolvedValue(null);
    delete process.env.STRICT_AUTH;
    delete process.env.MCP_SERVER_RESOURCE_URI;
    resetEmbeddedSigningKeyManagerForTests();
    ti = new TokenIntrospector(CONFIG);
  });
  afterEach(() => {
    process.env = { ...ORIG };
    jest.clearAllMocks();
    resetEmbeddedSigningKeyManagerForTests();
  });

  it('verifies a self-issued token against the embedded key, not PingOne JWKS', async () => {
    const issuer = resolveEmbeddedIssuer();
    jwtVerify.mockResolvedValue(undefined);
    const token = makeJwt({ sub: 'c1', client_id: 'c1', iss: issuer, exp: Math.floor(Date.now() / 1000) + 3600 });

    const result = await ti.validateAgentToken(token);

    expect(result.isValid).toBe(true);
    // Verified against the embedded manager's real public key, not a remote JWKS resolver.
    const embedded = await getEmbeddedSigningKeyManager();
    expect(jwtVerify).toHaveBeenCalledWith(token, embedded.getPublicKey());
  });

  it('rejects a self-issued-shaped token with a bad signature', async () => {
    const issuer = resolveEmbeddedIssuer();
    jwtVerify.mockRejectedValue(new Error('signature verification failed'));
    const token = makeJwt({ sub: 'c1', client_id: 'c1', iss: issuer, exp: Math.floor(Date.now() / 1000) + 3600 });

    await expect(ti.validateAgentToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('a token whose iss does NOT match the embedded issuer still goes through the PingOne path unchanged', async () => {
    const token = makeJwt({ sub: 'u1', client_id: 'other', iss: 'https://auth.pingone.com/env/as', exp: Math.floor(Date.now() / 1000) + 3600 });

    // No JWKS configured (createJwksKeySet → null) → existing decode-only warn+accept fallback.
    const result = await ti.validateAgentToken(token);
    expect(result.isValid).toBe(true);
    expect(jwtVerify).not.toHaveBeenCalled();
  });
});
