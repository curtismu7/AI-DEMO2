'use strict';

/**
 * Prometheus metrics for this resource server (demo_mcp_resource_server, k8s
 * Service `mcp-resource-server` — invest/airlines SQLite read-path).
 * Prefixed `mcprs_`, matching PingGateway's own `ig_` convention.
 *
 * index.ts's exported handleMessage wraps the renamed handleMessageImpl with
 * pure observation — no change to what it does or how it responds, on
 * either the HTTP or WebSocket transport.
 */

import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'mcprs_' });

export const mcpMessageDuration = new client.Histogram({
  name: 'mcprs_mcp_message_duration_seconds',
  help: 'Duration of handleMessage calls (both WebSocket and HTTP-transport requests share this path)',
  labelNames: ['method'],
  registers: [register],
});

export function metricsContentType(): string {
  return register.contentType;
}
