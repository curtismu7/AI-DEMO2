'use strict';

/**
 * MCP spec 2026-07-28: server/discover. Servers MUST implement this RPC —
 * a standalone call returning supported protocol versions, capabilities,
 * and identity, usable as a convenience for modern clients and as the
 * backward-compat probe a dual-era-aware client uses to tell a legacy
 * server apart from a modern one.
 *
 * supportedVersions includes 2026-07-28 because the gateway serves Modern
 * (stateless) callers end to end, and each piece is real and tested:
 *  - per-request version negotiation (modernNegotiation.ts), with the
 *    Mcp-Method / Mcp-Name header checks (400 + -32020) in GatewayServer.ts;
 *  - every Modern result carries resultType, and tools/list carries
 *    ttlMs / cacheScope (upstreamModern.ts finalizeModernBody);
 *  - MRTR elicitation over a signed, single-use requestState
 *    (requestState.ts, authorizeMcpRequest.ts, and the WebSocket handler in
 *    index.ts), non-interchangeable with the Legacy _elicitation_id flow;
 *  - GET/DELETE on /mcp answer 405 for a Modern caller.
 *
 * Upstream hops are opt-in: with GW_UPSTREAM_MODERN=1 the gateway probes the
 * backend's server/discover and sends self-contained requests with no
 * initialize handshake (upstreamModern.ts); with it unset, or against a
 * backend that does not answer discover, upstream stays on the Legacy
 * handshake. The BFF client (mcpGatewayClient.js / mcpWebSocketClient.js)
 * does not yet SEND Modern _meta on its own calls, so this repo's own live
 * traffic is Legacy at the first hop; the gateway is ready for a Modern
 * caller, it does not change what our BFF sends.
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
