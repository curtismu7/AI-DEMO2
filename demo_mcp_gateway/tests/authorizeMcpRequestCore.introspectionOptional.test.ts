import { runMcpAuthorizationPipeline } from '../src/auth/authorizeMcpRequestCore';
import type { GatewayIntrospectionClient, IntrospectionResult } from '../src/auth/GatewayIntrospectionClient';
import type { GatewayConfig } from '../src/config';

/**
 * GW_INTROSPECTION_ENABLED=false — why it exists, and the two things it must
 * never do.
 *
 * PingOne scopes RFC 7662 introspection to the ISSUING client. This gateway
 * receives tokens minted by the Token Exchanger AND five A2A specialist
 * clients; probed live 2026-07-27, a specialist's token introspected by the
 * exchanger returns active:false. So no single GW_INTROSPECTION_CLIENT_ID can
 * cover them, and pointing introspection at real PingOne blocks every A2A call
 * at the first filter. JWKS verifies anything PingOne signed regardless of
 * issuer — the property introspection lacks here.
 *
 * The hazard is that "skip introspection" is one edit away from "validate
 * nothing and return PERMIT".
 */
function stubIntrospectionClient(result: IntrospectionResult): GatewayIntrospectionClient {
  return { introspect: async () => result } as unknown as GatewayIntrospectionClient;
}

/** Throws if called — proves the pipeline did not silently introspect anyway. */
function forbiddenIntrospectionClient(): GatewayIntrospectionClient {
  return {
    introspect: async () => { throw new Error('introspect() must not be called when disabled'); },
  } as unknown as GatewayIntrospectionClient;
}

const JWKS_VARS = ['PINGONE_JWKS_ENDPOINT', 'PINGONE_JWKS_URI'] as const;

describe('runMcpAuthorizationPipeline — optional introspection', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { JWKS_VARS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; }); });
  afterEach(() => {
    JWKS_VARS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  test('default is ON — an undefined flag must not disable introspection', async () => {
    // The whole point of defaulting true: deployments that never set the var
    // keep the behaviour they had before it existed.
    const client = stubIntrospectionClient({ active: false });
    const result = await runMcpAuthorizationPipeline('tok', client, {} as GatewayConfig);
    expect(result.kind).toBe('introspection_failed');
  });

  test('disabled WITHOUT a JWKS endpoint refuses — never validates nothing', async () => {
    // Both checks off would leave the pipeline asserting nothing while still
    // able to return PERMIT. Omission is not permission.
    const config = { introspectionEnabled: false } as unknown as GatewayConfig;
    const result = await runMcpAuthorizationPipeline('tok', forbiddenIntrospectionClient(), config);
    expect(result.kind).toBe('introspection_unavailable');
    expect(result.audit.introspection?.error).toMatch(/no JWKS endpoint/i);
  });

  test('disabled WITH a JWKS endpoint skips introspection and does not call it', async () => {
    process.env.PINGONE_JWKS_ENDPOINT = 'https://auth.pingone.com/env/as/jwks';
    const config = { introspectionEnabled: false } as unknown as GatewayConfig;
    // Malformed token: it must get PAST introspection and fail later, proving
    // the skip happened rather than the request being rejected at step 0.
    const result = await runMcpAuthorizationPipeline('not-a-jwt', forbiddenIntrospectionClient(), config);
    expect(result.kind).not.toBe('introspection_failed');
    expect(result.kind).not.toBe('introspection_unavailable');
  });

  test('a skipped introspection audits as NOT PERFORMED, never as active', async () => {
    // The regression that matters most: rendering a check that did not run as a
    // check that passed. audit.introspection must be null, never {active:true}.
    process.env.PINGONE_JWKS_URI = 'https://auth.pingone.com/env/as/jwks';
    const config = { introspectionEnabled: false } as unknown as GatewayConfig;
    const result = await runMcpAuthorizationPipeline('not-a-jwt', forbiddenIntrospectionClient(), config);
    expect(result.audit.introspection).toBeNull();
  });

  test('PINGONE_JWKS_URI alone satisfies the guard — it is the name this stack sets', async () => {
    // The gateway container carries PINGONE_JWKS_URI and nothing sets
    // PINGONE_JWKS_ENDPOINT, so accepting only the latter kept signature
    // verification permanently off.
    process.env.PINGONE_JWKS_URI = 'https://auth.pingone.com/env/as/jwks';
    const config = { introspectionEnabled: false } as unknown as GatewayConfig;
    const result = await runMcpAuthorizationPipeline('not-a-jwt', forbiddenIntrospectionClient(), config);
    expect(result.kind).not.toBe('introspection_unavailable');
  });
});
