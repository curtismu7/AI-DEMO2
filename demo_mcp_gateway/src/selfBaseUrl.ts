import type { IncomingMessage } from 'http';

/**
 * Reachable base URL (scheme://host) for this gateway as the client addressed it.
 *
 * Used to build RFC 9728 `resource_metadata` pointers in `WWW-Authenticate`
 * headers, which MUST be a URL the client can GET — so we derive it from the
 * request's own scheme + host (honoring reverse-proxy headers) rather than the
 * bare audience identifier (e.g. `mcpgateway.ping.demo`), which has no scheme or
 * host and is unreachable, breaking MCP OAuth auto-discovery.
 */
export function selfBaseUrl(req: IncomingMessage, fallbackPort: number | string): string {
  const fwdProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const proto = fwdProto || ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim()
    || (req.headers['host'] as string | undefined)
    || `localhost:${fallbackPort}`;
  return `${proto}://${host}`;
}
