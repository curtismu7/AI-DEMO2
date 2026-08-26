/**
 * gatewayMetrics — parsing PingGateway's Prometheus exposition.
 *
 * The fixture below is real output captured from the SE cluster's gateway
 * admin connector (ping-gateway:8085) on 2026-08-25, trimmed to the ig_mcp_*
 * families. Keeping it verbatim is the point: the label set (mcp_method,
 * mcp_method_param_tool, mcp_error, route) and the trailing comma before `}`
 * are PingGateway's own formatting, not a shape this repo chose.
 */

'use strict';

const { parseMcpMetrics } = require('../../routes/gatewayMetrics');

const FIXTURE = `
# HELP ig_mcp_method_time_seconds Elapsed time of a MCP method call
# TYPE ig_mcp_method_time_seconds summary
ig_mcp_method_time_seconds{heap="gateway.router-handler.00-mcp-external-door",mcp_method="initialize",name="McpProtocol",route="00-mcp-external-door",quantile="0.5",} 1.825786976
ig_mcp_method_time_seconds_sum{heap="gateway.router-handler.00-mcp-external-door",mcp_method="initialize",name="McpProtocol",route="00-mcp-external-door",} 2.964007779
ig_mcp_method_time_seconds_count{heap="gateway.router-handler.00-mcp-external-door",mcp_method="initialize",name="McpProtocol",route="00-mcp-external-door",} 2.0
ig_mcp_method_time_seconds_sum{heap="gateway.router-handler.00-mcp-external-door",mcp_method="tools/call",mcp_method_param_tool="get_my_accounts",name="McpProtocol",route="00-mcp-external-door",} 0.326485253
ig_mcp_method_time_seconds_count{heap="gateway.router-handler.00-mcp-external-door",mcp_method="tools/call",mcp_method_param_tool="get_my_accounts",name="McpProtocol",route="00-mcp-external-door",} 1.0
ig_mcp_error_total{mcp_error="-32600",route="00-mcp-external-door",} 7.0
ig_mcp_error_total{mcp_error="-32602",mcp_method="tools/call",route="00-mcp-external-door",} 1.0
ig_http_server_time_seconds_count{route="00-mcp-external-door",} 99.0
`;

describe('parseMcpMetrics', () => {
  const parsed = parseMcpMetrics(FIXTURE);

  it('pairs _sum with _count into one row per method and derives the mean', () => {
    const initialize = parsed.methods.find((m) => m.method === 'initialize');
    expect(initialize).toMatchObject({ count: 2, route: '00-mcp-external-door', tool: null });
    // 2.964007779 / 2 — the mean the panel shows, not a quantile.
    expect(initialize.meanSeconds).toBeCloseTo(1.4820038895, 6);
  });

  it('keeps the tool name on tools/call so per-tool rows stay distinct', () => {
    const call = parsed.methods.find((m) => m.method === 'tools/call');
    expect(call).toMatchObject({ tool: 'get_my_accounts', count: 1 });
  });

  it('ignores quantile rows so a summary is not double counted', () => {
    // One initialize row, one tools/call row — the quantile="0.5" line adds neither.
    expect(parsed.methods).toHaveLength(2);
  });

  it('ignores non-MCP families such as ig_http_server_*', () => {
    expect(parsed.methods.some((m) => m.count === 99)).toBe(false);
  });

  it('reads error counters, carrying the method label only when present', () => {
    expect(parsed.errors).toEqual([
      { code: '-32600', method: null, route: '00-mcp-external-door', count: 7 },
      { code: '-32602', method: 'tools/call', route: '00-mcp-external-door', count: 1 },
    ]);
  });

  it('returns empty families rather than throwing on unrelated input', () => {
    expect(parseMcpMetrics('# nothing here\n')).toEqual({ methods: [], errors: [] });
  });
});
