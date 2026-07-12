import { runMcpAuthorizationPipeline } from '../src/auth/authorizeMcpRequestCore';
import type { GatewayIntrospectionClient, IntrospectionResult } from '../src/auth/GatewayIntrospectionClient';
import type { GatewayConfig } from '../src/config';

function stubIntrospectionClient(result: IntrospectionResult): GatewayIntrospectionClient {
  return { introspect: async () => result } as unknown as GatewayIntrospectionClient;
}

const config = {} as GatewayConfig;

describe('runMcpAuthorizationPipeline — introspection outcome distinction', () => {
  test('a confirmed-inactive token (active:false, no error) is "introspection_failed"', async () => {
    const client = stubIntrospectionClient({ active: false });
    const result = await runMcpAuthorizationPipeline('tok', client, config);
    expect(result.kind).toBe('introspection_failed');
  });

  test('an introspection transport/config failure (active:false + error) is "introspection_unavailable", not "introspection_failed"', async () => {
    const client = stubIntrospectionClient({ active: false, error: 'upstream_introspection_auth_error' });
    const result = await runMcpAuthorizationPipeline('tok', client, config);
    expect(result.kind).toBe('introspection_unavailable');
  });
});
