// Accepted-audience resolution for demo_mcp_resource_server.
//
// MCP_SERVER_RESOURCE_URI may be a comma-separated accepted-audience list
// (RFC 8693 rollout). The FIRST entry is this server's canonical resource URI
// (RFC 9728 metadata, health, logs); the full list feeds aud validation.
//
// This server's own canonical audience is ALWAYS accepted, even when the env
// carries another service's list — refresh-service-envs fans the banking MCP
// server's value ("mcpserver.ping.demo,mcpgateway.ping.demo") out to every
// service, and a stale container env then rejects every gateway exchange-#3
// token with "Audience mismatch".

export const OWN_AUDIENCE = 'mcp-invest.ping.demo';

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
