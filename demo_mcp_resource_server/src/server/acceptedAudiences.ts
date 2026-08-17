// Accepted-audience resolution for demo_mcp_resource_server.
//
// The value may be a comma-separated accepted-audience list (RFC 8693 rollout).
// The FIRST entry is this server's canonical resource URI (RFC 9728 metadata,
// health, logs); the full list feeds aud validation.
//
// This server's own canonical audience is ALWAYS accepted, even when the env
// carries another service's list — see resolveResourceUriEnv below for why that
// happens.

export const OWN_AUDIENCE = 'mcp-invest.ping.demo';

/** This server's own accepted-audience env var. */
export const RESOURCE_URI_ENV = 'MCP_RESOURCE_SERVER_RESOURCE_URI';

/**
 * Pre-rename name. Everywhere else in the repo it means "the BANKING MCP
 * server's accepted-audience list", and `k8s/02-configmap.yaml` sets it to that
 * banking value in the shared `ai-demo-config` map — which
 * `k8s/63-mcp-resource-server-deployment.yaml` pulls in wholesale via `envFrom`.
 * Reading it here made this server's audience list a side effect of another
 * service's config (TECH_DEBT 2026-08-16, T4).
 */
export const LEGACY_RESOURCE_URI_ENV = 'MCP_SERVER_RESOURCE_URI';

/**
 * Resolve the accepted-audience env value, preferring this server's own var.
 *
 * The legacy fallback is deliberate: a container created — or a `.env` pinned —
 * before the rename would otherwise drop to the bare default and stop accepting
 * `mcpgateway.ping.demo`, breaking gateway exchange-#3 tokens. `source` lets the
 * caller say WHICH name supplied the value, so a deployment still on the shared
 * banking name is visible in the logs instead of silently "working".
 */
export function resolveResourceUriEnv(
  env: Record<string, string | undefined> = process.env,
): { value?: string; source?: string } {
  for (const name of [RESOURCE_URI_ENV, LEGACY_RESOURCE_URI_ENV]) {
    // Empty string is "unset", not "an empty audience list".
    if (env[name]) return { value: env[name], source: name };
  }
  return { value: undefined, source: undefined };
}

export function resolveAcceptedAudiences(envValue?: string): string[] {
  const list = (envValue || OWN_AUDIENCE)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.includes(OWN_AUDIENCE)) {
    list.push(OWN_AUDIENCE);
  }
  return list;
}
