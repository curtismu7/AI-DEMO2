import { resolveJwksUri } from '../../src/auth/jwks';

/**
 * PingOne serves JWKS at `<env>/as/jwks`. The base-URL env vars disagree about
 * whether they already carry the `/as` segment — demo_mcp_server's
 * PINGONE_BASE_URL is the bare issuer, langchain_agent's is the AS base — so the
 * PINGONE_BASE_URL fallback must add `/as` only when it is absent.
 *
 * This matters because the failure is silent: an unreachable JWKS URL makes
 * TokenIntrospector log "signature NOT verified" and continue (fail-open).
 */
describe('resolveJwksUri', () => {
  const ENV_KEYS = ['PINGONE_JWKS_URI', 'PINGONE_ISSUER', 'PINGONE_BASE_URL'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  it('returns null when nothing is configured', () => {
    expect(resolveJwksUri()).toBeNull();
  });

  it('prefers an explicit PINGONE_JWKS_URI verbatim', () => {
    process.env.PINGONE_JWKS_URI = 'https://auth.pingone.com/env-1/as/jwks';
    process.env.PINGONE_BASE_URL = 'https://ignored.example.com';
    expect(resolveJwksUri()).toBe('https://auth.pingone.com/env-1/as/jwks');
  });

  it('falls back to PINGONE_ISSUER + /jwks before PINGONE_BASE_URL', () => {
    process.env.PINGONE_ISSUER = 'https://auth.pingone.com/env-1/as';
    process.env.PINGONE_BASE_URL = 'https://auth.pingone.com/env-1';
    expect(resolveJwksUri()).toBe('https://auth.pingone.com/env-1/as/jwks');
  });

  it('adds the /as segment when PINGONE_BASE_URL is the bare issuer', () => {
    process.env.PINGONE_BASE_URL = 'https://auth.pingone.com/env-1';
    expect(resolveJwksUri()).toBe('https://auth.pingone.com/env-1/as/jwks');
  });

  it('does not double the /as segment when PINGONE_BASE_URL already carries it', () => {
    process.env.PINGONE_BASE_URL = 'https://auth.pingone.com/env-1/as';
    expect(resolveJwksUri()).toBe('https://auth.pingone.com/env-1/as/jwks');
  });

  it('tolerates a trailing slash on PINGONE_BASE_URL', () => {
    process.env.PINGONE_BASE_URL = 'https://auth.pingone.com/env-1/';
    expect(resolveJwksUri()).toBe('https://auth.pingone.com/env-1/as/jwks');

    process.env.PINGONE_BASE_URL = 'https://auth.pingone.com/env-1/as/';
    expect(resolveJwksUri()).toBe('https://auth.pingone.com/env-1/as/jwks');
  });
});
