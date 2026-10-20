// /architecture/observability: the telemetry data flow as a StaticFlowDiagram config { GROUPS, NODES, EDGES, STEPS },
// drawn in the Ping style (pingStyle). Maps the shipped compose stack (docker-compose.yml `observability` + `tracing`
// profiles); it does not query the stack live. buildObservabilityDiagram(plane) keeps only the boxes and arrows of one
// plane ("metrics" | "traces" | "logs"), or all of them ("all").
// Layout: wide grid, one band per plane (metrics on top, traces, then logs), so the router has corridors.
import { RFC, SPEC } from './pingStyleStandards';
import { noTokenDetail, diagramStep } from './pingStyleDetail';

export const OBS_PLANES = ['metrics', 'traces', 'logs'];

export const OBS_GROUPS = {
  app: { label: 'Service or in-app page', bg: '#151a24' },
  ping: { label: 'Ping product (Agent Gateway)', bg: '#b5231a' },
  infra: { label: 'Collector, store or dashboard', bg: '#5a5f69' },
};

const N = (id, group, label, sub, x, y, planes) => ({ id, group, label, sub, x, y, planes });

const HTTP = RFC(9110, 'HTTP semantics');
const PROM = SPEC('Prometheus exposition format', 'Plain-text /metrics scrape');
const OTLP = SPEC('OpenTelemetry OTLP', 'Trace export over HTTP or gRPC');
const LOKI = SPEC('Loki push API', 'POST /loki/api/v1/push, label-indexed log streams');
const NO_AUTH = 'Telemetry hops on the compose network carry no OAuth token; the user session stays in the BFF.';

const NODES_ALL = [
  // metrics band
  N('gw', 'ping', 'Agent Gateway :8085', ['admin connector', 'ig_* metrics'], 0, 0, ['metrics']),
  N('mcp', 'app', 'mcp-server / mcpgw', ['/metrics endpoint'], 0, 140, ['metrics']),
  N('prom', 'infra', 'Prometheus', ['scrapes both', 'TSDB'], 440, 70, ['metrics']),
  N('am', 'infra', 'Alertmanager', ['default receiver (no-op)'], 880, 0, ['metrics']),
  N('arule', 'infra', 'Alert rules page', ['Grafana Alerting UI'], 1320, 0, ['metrics']),
  // shared surface
  N('graf', 'infra', 'Grafana', ['dashboards and alerts', 'explore'], 1320, 420, ['metrics', 'traces', 'logs']),
  // traces band
  N('ags', 'app', 'demo_agent_service', ['OTel spans (reason, tool)'], 0, 360, ['traces']),
  N('bff', 'app', 'BFF (demo-api-server)', ['OTel spans', 'structured logger'], 0, 520, ['traces', 'logs']),
  N('jaeger', 'infra', 'Jaeger', ['trace store', 'OTLP in'], 440, 420, ['traces']),
  N('inapp', 'app', 'In-app pages', ['Tracing', 'Transaction Trace'], 880, 300, ['traces']),
  // logs band
  N('loki', 'infra', 'Loki', ['log store'], 440, 660, ['logs']),
  N('alloy', 'infra', 'Alloy', ['log scraper'], 440, 810, ['logs']),
  N('cont', 'app', 'Service containers', ['docker logs'], 0, 810, ['logs']),
  N('mcpobs', 'app', 'MCP Observability', ['in-app log view'], 880, 660, ['logs']),
];

const D = { dashed: true };
const EDGES_ALL = [
  ['gw', 'prom', 'scrape', 'metrics'], // 0
  ['mcp', 'prom', 'scrape', 'metrics'], // 1
  ['prom', 'graf', 'datasource', 'metrics'], // 2
  ['prom', 'am', 'fire', 'metrics', D], // 3
  ['am', 'arule', 'show', 'metrics'], // 4
  ['ags', 'jaeger', 'OTLP', 'traces'], // 5
  ['bff', 'jaeger', 'OTLP', 'traces'], // 6
  ['jaeger', 'graf', 'datasource', 'traces'], // 7
  ['jaeger', 'inapp', 'BFF proxy', 'traces'], // 8
  ['bff', 'loki', 'push', 'logs'], // 9
  ['cont', 'alloy', 'read', 'logs'], // 10
  ['alloy', 'loki', 'push', 'logs'], // 11
  ['loki', 'graf', 'datasource', 'logs'], // 12
  ['loki', 'mcpobs', 'query', 'logs'], // 13
];

// One entry per EDGES_ALL index: [title, what, why, form, refs].
const COPY = [
  ['Prometheus scrapes the gateway', 'Prometheus pulls the PingGateway admin connector on :8085 on a fixed interval.', 'Metrics are pulled, so a stopped gateway shows as a failed scrape, not as silence.', 'GET /metrics HTTP/1.1\nHost: ping-gateway:8085', [HTTP, PROM]],
  ['Prometheus scrapes the MCP server', 'The same pull against mcp-server / mcpgw /metrics.', null, 'GET /metrics HTTP/1.1\nHost: mcp-server', [HTTP, PROM]],
  ['Grafana reads metrics from Prometheus', 'Prometheus is a Grafana datasource; the agent-observability dashboard queries it.', null, 'POST /api/v1/query_range HTTP/1.1\nquery=<PromQL over ig_* and mcp_* series>', [HTTP, PROM]],
  ['Prometheus fires alerts', 'Alert rules evaluated in Prometheus go to Alertmanager.', 'The default receiver is a deliberate no-op: alerts show as firing in Grafana and nothing pages or posts.', 'POST /api/v2/alerts HTTP/1.1\nHost: alertmanager:9093\n[{ "labels": { "alertname": "<rule>" } }]', [HTTP]],
  ['Alert rules show in Grafana Alerting', 'The Alert rules page lists the rules and their state in Grafana Alerting.', 'Rules are ratios, not counts: a few 401s are normal.', 'GET /alerting/list HTTP/1.1\nHost: grafana', [HTTP]],
  ['The agent service exports spans', 'demo_agent_service sends OpenTelemetry spans for each reason and tool step to Jaeger.', null, 'POST /v1/traces HTTP/1.1\nHost: jaeger:4318\n(OTLP/HTTP, spans: reason, tool)', [HTTP, OTLP]],
  ['The BFF exports spans', 'demo-api-server sends OpenTelemetry spans to the same Jaeger.', 'Both services share a trace id, so one request reads as one trace across them.', 'POST /v1/traces HTTP/1.1\nHost: jaeger:4318\n(OTLP/HTTP)', [HTTP, OTLP]],
  ['Grafana reads traces from Jaeger', 'Jaeger is a Grafana datasource for trace search and explore.', null, 'GET /api/traces?service=<name> HTTP/1.1\nHost: jaeger:16686', [HTTP]],
  ['The BFF proxies Jaeger to the in-app pages', 'The Tracing and Transaction Trace pages read Jaeger through a BFF proxy route.', 'The browser never talks to Jaeger directly.', 'GET /api/tracing/... HTTP/1.1\nHost: <BFF>', [HTTP]],
  ['The BFF pushes structured logs to Loki', 'The structured logger pushes log lines straight to Loki.', null, 'POST /loki/api/v1/push HTTP/1.1\nHost: loki:3100', [HTTP, LOKI]],
  ['Alloy reads container logs', 'Alloy tails the docker logs of the service containers.', null, 'read /var/lib/docker/containers/*/*-json.log', [LOKI]],
  ['Alloy ships the lines to Loki', 'Alloy labels the lines and pushes them to Loki.', null, 'POST /loki/api/v1/push HTTP/1.1\nHost: loki:3100', [HTTP, LOKI]],
  ['Grafana reads logs from Loki', 'Loki is a Grafana datasource for explore and dashboards.', null, 'GET /loki/api/v1/query_range HTTP/1.1\nquery={service="<name>"}', [HTTP, LOKI]],
  ['The MCP Observability page queries Loki', 'The in-app log view queries Loki through the BFF.', null, 'GET /loki/api/v1/query_range HTTP/1.1', [HTTP, LOKI]],
];

export function buildObservabilityDiagram(plane = 'all') {
  const keepEdge = (e) => plane === 'all' || e[3] === plane;
  const edgeIdx = EDGES_ALL.map((_, i) => i).filter((i) => keepEdge(EDGES_ALL[i]));
  const used = new Set(edgeIdx.flatMap((i) => [EDGES_ALL[i][0], EDGES_ALL[i][1]]));
  const NODES = NODES_ALL.filter((n) => used.has(n.id));
  const EDGES = edgeIdx.map((i) => {
    const [s, t, label, , opts] = EDGES_ALL[i];
    return opts ? [s, t, label, opts] : [s, t, label];
  });
  const STEPS = edgeIdx.map((orig, i) => {
    const [title, what, why, form, refs] = COPY[orig];
    return diagramStep(`obs-${orig}`, [i], title, what, why, noTokenDetail(form, NO_AUTH, refs));
  });
  return { GROUPS: OBS_GROUPS, NODES, EDGES, STEPS };
}
