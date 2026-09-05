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
  help: 'Duration of processMessage calls (both WebSocket and HTTP-transport requests share this path)',
  labelNames: ['method'],
  registers: [register],
});

export function metricsContentType(): string {
  return register.contentType;
}
