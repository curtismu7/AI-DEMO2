/**
 * Static broker clients exist so a SERVER-SIDE relay can hold a scope no
 * dynamic client may have. The DCR controls they bypass (loopback redirects,
 * pinned mcp:invoke scope) protect an UNAUTHENTICATED endpoint; server config
 * is a different trust level. These tests pin that the bypass is available to
 * config only, and never leaks back into /oauth/register.
 */
import { ClientRegistry } from '../oauth/ClientRegistry';

const ENV_KEYS = [
  'MCP_GW_OAUTH_STATIC_CLIENT_ID',
  'MCP_GW_OAUTH_STATIC_CLIENT_NAME',
  'MCP_GW_OAUTH_STATIC_REDIRECT_URIS',
  'MCP_GW_OAUTH_STATIC_SCOPE',
];

describe('ClientRegistry — operator-configured static client', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  it('seeds nothing when unconfigured', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(new ClientRegistry().getClient('anything')).toBeUndefined();
  });

  it('accepts a NON-loopback redirect — the case DCR must refuse', () => {
    process.env.MCP_GW_OAUTH_STATIC_CLIENT_ID = 'ai-demo-bff-audit';
    process.env.MCP_GW_OAUTH_STATIC_REDIRECT_URIS =
      'https://local.ping-devops.com:4000/api/privilege-mcp/auth/callback';
    const client = new ClientRegistry().getClient('ai-demo-bff-audit');
    expect(client?.redirect_uris).toEqual([
      'https://local.ping-devops.com:4000/api/privilege-mcp/auth/callback',
    ]);
  });

  it('may hold a scope no dynamic client can obtain', () => {
    process.env.MCP_GW_OAUTH_STATIC_CLIENT_ID = 'ai-demo-bff-audit';
    process.env.MCP_GW_OAUTH_STATIC_REDIRECT_URIS = 'https://example.test/cb';
    process.env.MCP_GW_OAUTH_STATIC_SCOPE = 'audit:read';
    expect(new ClientRegistry().getClient('ai-demo-bff-audit')?.scope).toBe('audit:read');
  });

  it('does NOT relax the rules for dynamic registration', () => {
    // The whole point: configuring a static client must not make /oauth/register
    // any more permissive. Both controls must still bite.
    process.env.MCP_GW_OAUTH_STATIC_CLIENT_ID = 'ai-demo-bff-audit';
    process.env.MCP_GW_OAUTH_STATIC_REDIRECT_URIS = 'https://example.test/cb';
    process.env.MCP_GW_OAUTH_STATIC_SCOPE = 'audit:read';
    const registry = new ClientRegistry();

    expect(() =>
      registry.registerClient({ redirect_uris: ['https://evil.test/cb'] } as never),
    ).toThrow(/loopback/i);

    const dynamic = registry.registerClient({
      redirect_uris: ['http://127.0.0.1:7777/callback'],
    } as never);
    expect(dynamic.scope).not.toBe('audit:read');
  });

  it('multiple redirect URIs are supported for multi-host deploys', () => {
    process.env.MCP_GW_OAUTH_STATIC_CLIENT_ID = 'ai-demo-bff-audit';
    process.env.MCP_GW_OAUTH_STATIC_REDIRECT_URIS =
      'https://local.ping-devops.com:4000/cb, https://ai-demo.ping-devops.com/cb';
    expect(new ClientRegistry().getClient('ai-demo-bff-audit')?.redirect_uris).toHaveLength(2);
  });
});
