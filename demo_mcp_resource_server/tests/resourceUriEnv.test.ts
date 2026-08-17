// This server's accepted-audience list must come from its OWN env var.
//
// `MCP_SERVER_RESOURCE_URI` means "the banking MCP server's accepted-audience
// list" everywhere else in the repo, and k8s/02-configmap.yaml sets it to that
// banking value in the shared `ai-demo-config` map that
// k8s/63-mcp-resource-server-deployment.yaml pulls in wholesale via envFrom.
// Reading that name here made this server's audience list a side effect of
// another service's config (TECH_DEBT 2026-08-16, T4). It now reads
// MCP_RESOURCE_SERVER_RESOURCE_URI, and only falls back to the old name so a
// container or .env pinned before the rename keeps working.
import {
  LEGACY_RESOURCE_URI_ENV,
  RESOURCE_URI_ENV,
  resolveResourceUriEnv,
} from '../src/server/acceptedAudiences';

describe('resolveResourceUriEnv', () => {
  it('prefers this server’s own var over the shared banking one', () => {
    const got = resolveResourceUriEnv({
      [RESOURCE_URI_ENV]: 'mcp-invest.ping.demo,mcpgateway.ping.demo',
      [LEGACY_RESOURCE_URI_ENV]: 'mcpserver.ping.demo,mcpgateway.ping.demo',
    });
    expect(got.value).toBe('mcp-invest.ping.demo,mcpgateway.ping.demo');
    expect(got.source).toBe(RESOURCE_URI_ENV);
  });

  it('falls back to the legacy name so a pre-rename env keeps working', () => {
    const got = resolveResourceUriEnv({
      [LEGACY_RESOURCE_URI_ENV]: 'mcp-invest.ping.demo,mcpgateway.ping.demo',
    });
    expect(got.value).toBe('mcp-invest.ping.demo,mcpgateway.ping.demo');
    expect(got.source).toBe(LEGACY_RESOURCE_URI_ENV);
  });

  it('reports no source when neither name is set', () => {
    expect(resolveResourceUriEnv({})).toEqual({ value: undefined, source: undefined });
  });

  it('treats an empty value as unset rather than as an empty audience list', () => {
    const got = resolveResourceUriEnv({
      [RESOURCE_URI_ENV]: '',
      [LEGACY_RESOURCE_URI_ENV]: 'mcp-invest.ping.demo',
    });
    expect(got.value).toBe('mcp-invest.ping.demo');
    expect(got.source).toBe(LEGACY_RESOURCE_URI_ENV);
  });

  // The whole point of the rename: the banking value must not silently become
  // this server's list. It still resolves (legacy fallback) but the caller can
  // see it came from the shared name and warn.
  it('surfaces the legacy source when only the shared banking value is present', () => {
    const got = resolveResourceUriEnv({
      [LEGACY_RESOURCE_URI_ENV]: 'mcpserver.ping.demo,mcpgateway.ping.demo',
    });
    expect(got.source).toBe(LEGACY_RESOURCE_URI_ENV);
  });
});
