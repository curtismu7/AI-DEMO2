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

const PF_ISSUER = 'https://local.ping-devops.com:9031';
const PF_JWKS_URI = `${PF_ISSUER}/pf/JWKS`;
const PINGONE_JWKS_URI = 'https://auth.pingone.com/env/as/jwks';

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('TokenIntrospector — PingFederate issuer JWKS routing', () => {
  const originalEnv = { ...process.env };
  let ti: TokenIntrospector;
  let jwtVerify: jest.Mock;
  const pfKeySet = (() => {}) as any;
  const pingOneKeySet = (() => {}) as any;

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({ post: jest.fn(), get: jest.fn() } as any);
    process.env.PF_ISSUER_URI = PF_ISSUER;
    process.env.PF_JWKS_URI = PF_JWKS_URI;
    process.env.PINGONE_JWKS_URI = PINGONE_JWKS_URI;
    jwtVerify = jest.fn().mockResolvedValue(undefined);
    mockedJwks.getJose.mockResolvedValue({ jwtVerify } as any);
    mockedJwks.createJwksKeySet.mockImplementation(async (uri?: string) => {
      return uri === PF_JWKS_URI ? pfKeySet : pingOneKeySet;
    });
    ti = new TokenIntrospector(CONFIG);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('verifies a PF-issued token against PF JWKS, never PingOne JWKS', async () => {
    const token = makeJwt({
      iss: PF_ISSUER,
      sub: 'user-1',
      client_id: 'gateway-agent',
      scope: 'mcp:invoke',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await ti.validateAgentToken(token);

    expect(result.isValid).toBe(true);
    expect(result.signatureVerified).toBe(true);
    expect(mockedJwks.createJwksKeySet).toHaveBeenCalledTimes(1);
    expect(mockedJwks.createJwksKeySet).toHaveBeenCalledWith(PF_JWKS_URI);
    expect(jwtVerify).toHaveBeenCalledWith(token, pfKeySet, { issuer: PF_ISSUER });
    expect(jwtVerify).not.toHaveBeenCalledWith(token, pingOneKeySet, { issuer: PF_ISSUER });
  });

  it('does not fall back to PingOne JWKS when the PF signature fails', async () => {
    jwtVerify.mockRejectedValue(new Error('signature verification failed'));
    const token = makeJwt({ iss: PF_ISSUER, sub: 'user-1' });

    await expect((ti as any).verifyTokenSignature(token)).rejects.toBeInstanceOf(AuthenticationError);

    expect(mockedJwks.createJwksKeySet).toHaveBeenCalledTimes(1);
    expect(mockedJwks.createJwksKeySet).toHaveBeenCalledWith(PF_JWKS_URI);
    expect(jwtVerify).toHaveBeenCalledTimes(1);
    expect(jwtVerify).toHaveBeenCalledWith(token, pfKeySet, { issuer: PF_ISSUER });
  });

  it('fails closed when PF is configured without a PF JWKS URI', async () => {
    delete process.env.PF_JWKS_URI;
    const token = makeJwt({ iss: PF_ISSUER, sub: 'user-1' });

    await expect((ti as any).verifyTokenSignature(token)).rejects.toBeInstanceOf(AuthenticationError);

    expect(mockedJwks.createJwksKeySet).not.toHaveBeenCalled();
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it('fails closed when the configured PF JWKS URI cannot create a keyset', async () => {
    mockedJwks.createJwksKeySet.mockResolvedValue(null);
    const token = makeJwt({ iss: PF_ISSUER, sub: 'user-1' });

    await expect((ti as any).verifyTokenSignature(token)).rejects.toBeInstanceOf(AuthenticationError);

    expect(mockedJwks.createJwksKeySet).toHaveBeenCalledWith(PF_JWKS_URI);
    expect(jwtVerify).not.toHaveBeenCalled();
  });
});
