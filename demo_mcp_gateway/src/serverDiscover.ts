'use strict';

/**
 * MCP spec 2026-07-28: server/discover. Servers MUST implement this RPC —
 * a standalone call returning supported protocol versions, capabilities,
 * and identity, usable as a convenience for modern clients and as the
 * backward-compat probe a dual-era-aware client uses to tell a legacy
 * server apart from a modern one.
 *
 * supportedVersions now includes 2026-07-28: tools/call genuinely supports
 * it end-to-end (Modern per-request negotiation + MRTR-shaped elicitation
 * on both transports, real and tested — see modernNegotiation.ts and the
 * elicitation-obligation branches in index.ts / authorizeMcpRequest.ts).
 * This is real but PARTIAL Modern support, not full spec compliance for
 * 2026-07-28 as a whole: no header-based routing (Mcp-Method/Mcp-Name), no
 * list-result caching (ttlMs/cacheScope), and methods proxied to
 * demo_mcp_resource_server (resources/*, prompts/*, completion/complete)
 * still hit that service's own Legacy-only negotiation gate, since it
 * hasn't been upgraded. The BFF client (mcpGatewayClient.js /
 * mcpWebSocketClient.js) also does not yet SEND Modern _meta on its own
 * calls, so this repo's own live traffic still runs Legacy end-to-end today
 * — this flip makes the gateway ready to serve a genuinely Modern caller
 * correctly, it does not itself change what our own BFF sends.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2026-07-28'] as const;

export interface DiscoverServerInfo {
  name: string;
  version: string;
}

export interface DiscoverResult {
  resultType: 'complete';
  supportedVersions: readonly string[];
  capabilities: Record<string, unknown>;
  _meta: { 'io.modelcontextprotocol/serverInfo': DiscoverServerInfo };
  instructions?: string;
}

export function buildDiscoverResult(
  capabilities: Record<string, unknown>,
  serverInfo: DiscoverServerInfo,
  instructions?: string,
): DiscoverResult {
  return {
    resultType: 'complete',
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    capabilities,
    _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
    ...(instructions !== undefined ? { instructions } : {}),
  };
}
