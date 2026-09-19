export const AUTO_RECONNECT_NO_AUTH_SERVERS = new Set(['aidemo-mcp', 'opensearch-direct']);

export type StartupServer = {
  serverName: string;
  requestScoped?: boolean;
};

export type StartupStatus = {
  authorizationState?: string;
  connectionState?: string;
  requestScoped?: boolean;
};

/**
 * Return only servers that can be warmed without opening or polling OAuth.
 * OAuth-backed servers are eligible only when LibreChat already has durable
 * authorization for them; no-auth servers may be initialized directly.
 */
export function getStartupReconnectCandidates(
  servers: StartupServer[],
  statuses: Record<string, StartupStatus | undefined> | undefined,
): string[] {
  return servers
    .filter((server) => {
      if (server.requestScoped || statuses?.[server.serverName]?.requestScoped) return false;

      const status = statuses?.[server.serverName];
      if (status?.connectionState === 'connected' || status?.connectionState === 'connecting') {
        return false;
      }

      if (AUTO_RECONNECT_NO_AUTH_SERVERS.has(server.serverName)) return true;
      return status?.authorizationState === 'authorized';
    })
    .map((server) => server.serverName);
}
