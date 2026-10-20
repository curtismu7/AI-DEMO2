// Data path behind McpObservabilityPage. Mirrors the page's load() calls and
// demo_api_server routes: /api/mcp/audit (requireSession), /api/health,
// /api/health/gateway-metrics (Prometheus scrape, available:false if unreachable),
// /api/transaction-trace/:correlationId (chain-of-custody ledger).
import { RFC, SPEC } from './pingStyleStandards';
import { noTokenDetail } from './pingStyleDetail';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);

export const MCP_OBS_GROUPS = {
  page: { label: 'Observability page', bg: '#151a24' },
  bff: { label: 'Demo API (BFF)', bg: '#151a24' },
  source: { label: 'Data source', bg: '#5a5f69' },
  ping: { label: 'Ping product (PingGateway)', bg: '#b5231a' },
};

export const MCP_OBS_NODES = [
  N('page', 'page', 'Observability page', ['loads every 15s', 'and on Refresh'], 0, 300),
  N('audit', 'bff', '/api/mcp/audit', ['last 100 events + summary', 'requires a session'], 700, 0),
  N('health', 'bff', '/api/health', ['components: MCP server,', 'PingOne JWKS'], 700, 150),
  N('metrics', 'bff', '/api/health/gateway-metrics', ['scrapes PingGateway admin', 'available:false if unreachable'], 700, 300),
  N('trace', 'bff', '/api/transaction-trace/:id', ['chain-of-custody hops', 'for the selected request'], 700, 450),
  N('auditlog', 'source', 'MCP audit events', ['operation, outcome, duration,', 'user, agent, vertical'], 1400, 0),
  N('ledger', 'source', 'Transaction ledger', ['hops per correlationId;', '403 if ff_transaction_ledger off'], 1400, 450),
  N('gateway', 'ping', 'PingGateway', ['Prometheus text, ig_* metrics'], 1400, 300),
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

const HTTP = RFC(9110, 'HTTP semantics');
const PROM = SPEC('Prometheus exposition format', 'Plain-text /metrics scrape');
const SESSION = 'The BFF reads use the browser session cookie; no OAuth token is shown or forwarded to the data source.';
const step = (key, edges, title, what, why, form, refs, reason = SESSION) => ({ key, edges, title, what, ...(why ? { why } : {}), detail: noTokenDetail(form, reason, refs) });

export const MCP_OBS_STEPS = [
  step('audit', [0], 'The page loads the audit events', 'The page fetches the latest 100 MCP audit events and a summary; tool calls, success rate, p95, denials and the tool table are derived from them.', 'Denied counts come from failure events flagged as alerts, so authorization outcomes sit beside latency.', 'GET /api/mcp/audit?limit=100 HTTP/1.1\nGET /api/mcp/audit?summary=1 HTTP/1.1', [HTTP]),
  step('auditlog', [1], 'The BFF reads the audit events', 'The audit route returns operation, outcome, duration, user, agent and vertical for each event.', null, 'read MCP audit events -> [{ operation, outcome, duration, userId, agentId, vertical, correlationId }]', [HTTP]),
  step('health', [2], 'Server health comes from the health endpoint', 'The health endpoint supplies MCP server and JWKS status.', null, 'GET /api/health HTTP/1.1', [HTTP]),
  step('gw-reach', [3], 'The page asks whether the gateway is reachable', 'The gateway-metrics endpoint reports whether PingGateway answers.', 'A stack without the gateway is a normal state and shows as unavailable, not as an error.', 'GET /api/health/gateway-metrics HTTP/1.1\n-> { "available": false } when unreachable', [HTTP]),
  step('gw-scrape', [4], 'The BFF scrapes PingGateway', 'It reads the admin connector as Prometheus text and keeps the ig_* series.', null, 'GET /metrics HTTP/1.1  (PingGateway admin connector)', [HTTP, PROM]),
  step('trace', [5], 'Selecting a request loads its trace', 'The event correlation ID is looked up in the transaction ledger and the hops render as a waterfall.', 'Each tool call gets its why attached; if the ledger is off or empty the page says the trace is unavailable.', 'GET /api/transaction-trace/:correlationId HTTP/1.1', [HTTP]),
  step('ledger', [6], 'The BFF assembles the hops', 'The ledger returns the chain-of-custody hops for that correlationId.', 'It answers 403 when ff_transaction_ledger is off.', 'read ledger hops for <correlationId>', [HTTP]),
];
