import { JwtClaimVerifier } from '../../src/tools/JwtClaimVerifier';
import { Logger, createDefaultLoggerConfig } from '../../src/utils/Logger';
import { AuthenticationError } from '../../src/interfaces/auth';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

describe('JwtClaimVerifier', () => {
  let logger: Logger;
  const originalEnv = { ...process.env };
  beforeEach(() => { logger = Logger.getInstance(createDefaultLoggerConfig()); });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('isSensitiveHandler true for the four sensitive handlers', () => {
    const v = new JwtClaimVerifier(logger);
    expect(v.isSensitiveHandler('executeGetSensitiveAccountDetails')).toBe(true);
    expect(v.isSensitiveHandler('executeCreateTransfer')).toBe(true);
    expect(v.isSensitiveHandler('executeCreateWithdrawal')).toBe(true);
    expect(v.isSensitiveHandler('executeCreateDeposit')).toBe(true);
  });

  it('isSensitiveHandler false for non-sensitive handlers', () => {
    const v = new JwtClaimVerifier(logger);
    expect(v.isSensitiveHandler('executeGetMyAccounts')).toBe(false);
    expect(v.isSensitiveHandler('executeSequentialThink')).toBe(false);
  });

  it('decodePayload returns claims for valid JWT', () => {
    const v = new JwtClaimVerifier(logger);
    expect(v.decodePayload(makeJwt({ sub: 'u123', scope: 'read' }))).toEqual({ sub: 'u123', scope: 'read' });
  });

  it('decodePayload returns null for opaque token', () => {
    const v = new JwtClaimVerifier(logger);
    expect(v.decodePayload('opaque-token-no-dots')).toBeNull();
  });

  it('assertClaims throws AuthenticationError when token expired', async () => {
    delete process.env.PINGONE_JWKS_URI;
    delete process.env.PINGONE_ISSUER;
    delete process.env.PINGONE_BASE_URL;
    const v = new JwtClaimVerifier(logger);
    const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60, iss: 'x' });
    await expect(v.assertClaims(expired, 'tool')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('assertClaims is a no-op for opaque tokens', async () => {
    const v = new JwtClaimVerifier(logger);
    await expect(v.assertClaims('opaque', 'tool')).resolves.toBeUndefined();
  });
});
