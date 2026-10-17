// Data path behind McpObservabilityPage. Mirrors the page's load() calls and
// demo_api_server routes: /api/mcp/audit (requireSession), /api/health,
// /api/health/gateway-metrics (Prometheus scrape, available:false if unreachable),
// /api/transaction-trace/:correlationId (chain-of-custody ledger).
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);

export const MCP_OBS_GROUPS = {
  page: { label: 'Observability page', bg: 'var(--th-status-info)' },
  bff: { label: 'Demo API (BFF)', bg: 'var(--th-bg-emphasis)' },
  source: { label: 'Data sources', bg: 'var(--th-status-warning)' },
};

export const MCP_OBS_NODES = [
  N('page', 'page', 'Observability page', ['loads every 15s', 'and on Refresh'], 0, 200),
  N('audit', 'bff', '/api/mcp/audit', ['last 100 events + summary', 'requires a session'], 340, 0),
  N('health', 'bff', '/api/health', ['components: MCP server,', 'PingOne JWKS'], 340, 160),
  N('metrics', 'bff', '/api/health/gateway-metrics', ['scrapes PingGateway admin', 'available:false if unreachable'], 340, 320),
  N('trace', 'bff', '/api/transaction-trace/:id', ['chain-of-custody hops', 'for the selected request'], 340, 480),
  N('auditlog', 'source', 'MCP audit events', ['operation, outcome, duration,', 'user, agent, vertical'], 700, 0),
  N('ledger', 'source', 'Transaction ledger', ['hops per correlationId;', '403 if ff_transaction_ledger off'], 700, 480),
  N('gateway', 'source', 'PingGateway', ['Prometheus text, ig_* metrics'], 700, 320),
];

export const MCP_OBS_EDGES = [
  E('page', 'audit', 'events + summary'), // 0
  E('audit', 'auditlog', 'reads audit events'), // 1
  E('page', 'health', 'health'), // 2
  E('page', 'metrics', 'gateway reachability'), // 3
  E('metrics', 'gateway', 'scrape admin metrics'), // 4
  E('page', 'trace', 'on selecting a request (correlationId)'), // 5
  E('trace', 'ledger', 'assembles hops'), // 6
];

export const MCP_OBS_STEPS = [
  { key: 'audit', edges: [0, 1], title: 'Audit events drive the metrics', what: 'The page fetches the latest 100 MCP audit events and a summary; tool calls, success rate, p95, denials and the tool table are derived from them.', why: 'Denied counts come from failure events flagged as alerts, so authorization outcomes sit beside latency.' },
  { key: 'health', edges: [2, 3, 4], title: 'Server health from two probes', what: 'The health endpoint supplies MCP server and JWKS status; the gateway-metrics endpoint scrapes PingGateway and reports whether it is reachable.', why: 'A stack without the gateway is a normal state and shows as unavailable, not an error.' },
  { key: 'trace', edges: [5, 6], title: 'Selecting a request loads its trace', what: 'The event correlation ID is looked up in the transaction ledger and the hops render as a waterfall.', why: 'Each tool call gets its why attached; if the ledger is off or empty the page says the trace is unavailable.' },
];
