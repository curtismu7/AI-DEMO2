'use strict';

/**
 * Prometheus metrics for this banking MCP server (oauth-mcp, k8s Service
 * `mcp-server`). Prefixed `oauthmcp_`, matching PingGateway's own `ig_`
 * convention, so both live in one Prometheus without colliding.
 *
 * DemoMCPServer.processMessage wraps the renamed _processMessageImpl with
 * pure observation (record on settle, no change to what it returns or how it
 * responds) — nothing here changes connection handling, session state, or
 * auth.
 */

import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'oauthmcp_' });

export const mcpMessageDuration = new client.Histogram({
  name: 'oauthmcp_mcp_message_duration_seconds',
  help: 'Duration of DemoMCPServer.processMessage calls — the WebSocket path only. HttpMCPTransport (Streamable HTTP / legacy SSE, used by PingGateway\'s OLB exchange) is a separate implementation that never calls processMessage; see oauthmcp_mcp_http_transport_duration_seconds for that traffic.',
  labelNames: ['method'],
  registers: [register],
});

/**
 * HttpMCPTransport.handleRequest covers Streamable HTTP + legacy SSE — the
 * path PingGateway's OLB token exchange actually uses. Labeled by pathname,
 * not JSON-RPC method: the method lives in the POST body, which is a stream
 * handleRequestImpl reads itself: pre-reading it here to extract a label
 * would consume the stream out from under the real implementation.
 */
export const httpTransportDuration = new client.Histogram({
  name: 'oauthmcp_mcp_http_transport_duration_seconds',
  help: 'Duration of HttpMCPTransport.handleRequest calls (Streamable HTTP + legacy SSE), labeled by pathname',
  labelNames: ['path'],
  registers: [register],
});

export function metricsContentType(): string {
  return register.contentType;
}
