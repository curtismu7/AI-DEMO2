'use strict';

/**
 * Prometheus metrics for the Agent Gateway (this service, demo_mcp_gateway).
 *
 * Prefixed `mcpgw_`, matching PingGateway's own `ig_` convention, so both
 * live in one Prometheus without colliding.
 *
 * Deliberately does NOT touch proxy.ts's control flow, error handling, or
 * return values — every call site wraps the existing exported function with
 * pure observation (record on settle, re-throw/re-return unchanged). This
 * gateway has locked HITL-receipt and tools/list-outage behavior
 * (REGRESSION_PLAN.md §1); nothing here changes what those paths do.
 */

import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'mcpgw_' });

/**
 * Duration of every JSON-RPC call proxied to a backend MCP server, both
 * transports (index.ts's WebSocket path and GatewayServer's HTTP path route
 * through proxy.ts's proxyJsonRpc/proxyJsonRpcHttp, so this is the one place
 * that sees all of it).
 */
export const mcpCallDuration = new client.Histogram({
  name: 'mcpgw_mcp_call_duration_seconds',
  help: 'Duration of MCP JSON-RPC calls proxied to a backend MCP server',
  labelNames: ['method'],
  registers: [register],
});

export const mcpCallErrors = new client.Counter({
  name: 'mcpgw_mcp_call_errors_total',
  help: 'MCP JSON-RPC calls that settled as a JSON-RPC error response or threw',
  labelNames: ['method'],
  registers: [register],
});

export function metricsContentType(): string {
  return register.contentType;
}
