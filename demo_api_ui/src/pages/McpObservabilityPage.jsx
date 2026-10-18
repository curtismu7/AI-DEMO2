import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "../services/apiClient";
import { useThemeOptional } from "../context/ThemeContext";
import { KIBANA_URL } from "../config/observabilityLinks";
import "./McpObservabilityPage.css";
import InlineSpinner from '../components/shared/InlineSpinner';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import * as obsFlow from '../config/mcpObservabilityDiagram';
import PageHeader from '../components/common/PageHeader';

const OBS_FLOW = { GROUPS: obsFlow.MCP_OBS_GROUPS, NODES: obsFlow.MCP_OBS_NODES, EDGES: obsFlow.MCP_OBS_EDGES, STEPS: obsFlow.MCP_OBS_STEPS };

const REFRESH_MS = 15000;
const AUDIT_LIMIT = 100;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Math.round(safeNumber(value)));
}

function formatDuration(milliseconds) {
  const value = safeNumber(milliseconds);
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatTime(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function isDenied(event) {
  return event?.outcome === "failure" && event?.details?.alert === true;
}

function normalizeAuditEvents(data) {
  return asArray(data).map((event, index) => ({
    ...event,
    eventId: event.eventId || `event-${index}`,
    operation: event.operation || "unknown",
    outcome: event.outcome || "unknown",
    duration: event.duration == null || event.duration === "" ? null : (Number.isFinite(Number(event.duration)) ? Number(event.duration) : null),
    timestamp: event.timestamp || null,
  }));
}

export function buildObservabilitySummary(events, summary, gatewayMetrics, health) {
  const byOutcome = summary?.byOutcome || {};
  const total = safeNumber(summary?.totalEvents, events.length);
  const successful = safeNumber(byOutcome.success, events.filter((event) => event.outcome === "success").length);
  const durations = events.map((event) => event.duration).filter((value) => value != null);
  const denied = events.filter(isDenied).length;
  const gatewayAvailable = gatewayMetrics?.available === true;
  const components = health?.components || {};

  return {
    total,
    successRate: total ? (successful / total) * 100 : null,
    p95: percentile(durations, 0.95),
    denied,
    gatewayAvailable,
    healthStatus: health?.status || "unknown",
    serverHealth: [
      { name: "PingOne Agent Gateway", detail: "policy boundary", status: gatewayAvailable ? "healthy" : "unavailable" },
      { name: "MCP server", detail: "configured resource", status: components.mcp_server?.status || "unknown" },
      { name: "PingOne JWKS", detail: "identity keys", status: components.pingone_jwks?.status || "unknown" },
    ],
  };
}

export function buildToolHealth(events) {
  const byTool = new Map();
  events.forEach((event) => {
    const current = byTool.get(event.operation) || { operation: event.operation, calls: 0, failures: 0, denials: 0, durations: [], lastSeen: event.timestamp, vertical: event.vertical };
    current.calls += 1;
    if (event.outcome === "failure") current.failures += 1;
    if (isDenied(event)) current.denials += 1;
    if (event.duration != null) current.durations.push(event.duration);
    if (!current.lastSeen || String(event.timestamp) > String(current.lastSeen)) current.lastSeen = event.timestamp;
    byTool.set(event.operation, current);
  });
  return [...byTool.values()]
    .map((tool) => ({ ...tool, errorRate: tool.calls ? (tool.failures / tool.calls) * 100 : 0, p95: percentile(tool.durations, 0.95) }))
    .sort((a, b) => (b.denials - a.denials) || (b.calls - a.calls));
}

function endpointGet(url) {
  return apiClient.get(url, { _silent: true }).then((response) => response.data);
}

function StatusDot({ status }) {
  return <span className={`mcp-observability-dot mcp-observability-dot--${status}`} aria-hidden="true" />;
}

function Metric({ label, value, note, tone = "" }) {
  return <article className={`mcp-observability-metric ${tone}`}><span className="mcp-observability-metric__label">{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function TraceDetail({ event, detail, loading }) {
  if (!event) return <div className="mcp-observability-empty">Select an MCP request to inspect its trace.</div>;
  const denied = isDenied(event);
  const hops = asArray(detail?.hops);
  return (
    <div className="mcp-observability-trace">
      <div className="mcp-observability-trace-head">
        <div><span className="mcp-observability-trace-id">{event.correlationId || event.eventId}</span><h3>{event.operation}</h3><p>{event.userId || "Unknown user"} · {event.agentId || "direct call"} · {event.vertical || "unclassified"}</p></div>
        <span className={`mcp-observability-status mcp-observability-status--${denied ? "denied" : event.outcome}`}>{denied ? "DENIED" : String(event.outcome).toUpperCase()}</span>
      </div>
      <div className="mcp-observability-waterfall">
        {loading && <div className="mcp-observability-trace-loading"><InlineSpinner label="Loading chain-of-custody trace…" /></div>}
        {!loading && hops.length > 0 && hops.map((hop, index) => <div className="mcp-observability-hop" key={`${hop.phase || "hop"}-${index}`}><span>{hop.phase || hop.op || "hop"}</span><i style={{ width: `${Math.max(8, Math.min(92, safeNumber(hop.durationMs, 24) / Math.max(1, safeNumber(event.duration, 100)) * 100))}%` }} /><b>{formatDuration(hop.durationMs)}</b></div>)}
        {!loading && hops.length === 0 && <div className="mcp-observability-trace-loading">Trace unavailable: no chain-of-custody hops were returned.</div>}
      </div>
      <div className="mcp-observability-trace-foot"><span>correlation <b>{event.correlationId || "—"}</b></span><span>duration <b>{formatDuration(event.duration)}</b></span></div>
    </div>
  );
}

export default function McpObservabilityPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [gatewayMetrics, setGatewayMetrics] = useState(null);
  const [health, setHealth] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [trace, setTrace] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      endpointGet(`/api/mcp/audit?limit=${AUDIT_LIMIT}`),
      endpointGet("/api/mcp/audit?summary=1"),
      endpointGet("/api/health/gateway-metrics"),
      endpointGet("/api/health"),
    ]);
    const [auditResult, summaryResult, metricsResult, healthResult] = results;
    if (auditResult.status === "fulfilled") {
      const nextEvents = normalizeAuditEvents(auditResult.value);
      setEvents(nextEvents);
      setSelectedId((current) => current || nextEvents[0]?.eventId || null);
      setError(null);
    } else {
      setError("MCP audit data is unavailable. Check the admin session and BFF health.");
    }
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
    if (metricsResult.status === "fulfilled") setGatewayMetrics(metricsResult.value);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const selected = events.find((event) => event.eventId === selectedId) || null;
  useEffect(() => {
    if (!selected?.correlationId) { setTrace(null); return undefined; }
    let cancelled = false;
    setTraceLoading(true);
    endpointGet(`/api/transaction-trace/${encodeURIComponent(selected.correlationId)}`)
      .then((data) => { if (!cancelled) setTrace(data); })
      .catch(() => { if (!cancelled) setTrace(null); })
      .finally(() => { if (!cancelled) setTraceLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const visibleEvents = useMemo(() => events.filter((event) => {
    const haystack = [event.operation, event.userId, event.agentId, event.correlationId, event.vertical].join(" ").toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());
    const matchesOutcome = outcome === "all" || (outcome === "denied" ? isDenied(event) : event.outcome === outcome);
    return matchesSearch && matchesOutcome;
  }), [events, outcome, search]);
  const overview = buildObservabilitySummary(events, summary, gatewayMetrics, health);
  const tools = buildToolHealth(events);

  return (
    <div className="mcp-observability-page">
      <PageHeader className="mcp-observability-header" title="MCP traffic, with the why attached" summary="A live view of server health, tool performance, and authorization outcomes across the agent gateway."
        actions={<>        <div className="mcp-observability-header-actions"><span className="mcp-observability-live"><StatusDot status="healthy" /> LIVE · {lastUpdated ? formatTime(lastUpdated) : "connecting"}</span><a className="mcp-observability-button" href={KIBANA_URL} target="_blank" rel="noopener noreferrer">Open Kibana logs</a>{toggleDarkMode && <button type="button" className="mcp-observability-button" onClick={toggleDarkMode}>{darkMode ? "☀️ Light mode" : "🌙 Dark mode"}</button>}<button type="button" className="mcp-observability-button mcp-observability-button--primary" onClick={() => load()}>Refresh</button></div>
        </>} />

      {error && <div className="mcp-observability-error" role="alert">{error}</div>}
      <section className="mcp-observability-metrics" aria-label="MCP overview metrics">
        <Metric label="Tool calls" value={loading ? "…" : formatNumber(overview.total)} note="durable MCP audit events" tone="cyan" />
        <Metric label="Success rate" value={overview.successRate == null ? "—" : `${overview.successRate.toFixed(1)}%`} note="derived from audit outcomes" />
        <Metric label="p95 latency" value={overview.p95 == null ? "—" : formatDuration(overview.p95)} note="from recent audited calls" tone={overview.p95 > 800 ? "warn" : ""} />
        <Metric label="Denied calls" value={formatNumber(overview.denied)} note="authorization decisions" tone={overview.denied ? "danger" : ""} />
      </section>

      <div className="mcp-observability-section-title"><h2>Traffic health</h2><span>auto-refresh 15s</span></div>
      <section className="mcp-observability-health-grid">
        <article className="mcp-observability-panel mcp-observability-chart-panel"><div className="mcp-observability-panel-head"><strong>Recent call distribution</strong><span>{events.length} events loaded</span></div><div className="mcp-observability-bars" aria-label="Recent call distribution chart">{events.slice(0, 18).reverse().map((event) => <span key={event.eventId} className={isDenied(event) ? "denied" : event.outcome === "failure" ? "failed" : "success"} style={{ height: `${Math.max(12, Math.min(100, safeNumber(event.duration, 20) / Math.max(1, overview.p95 || 100) * 100))}%` }} title={`${event.operation} · ${formatDuration(event.duration)}`} />)}</div><div className="mcp-observability-chart-caption"><span>older</span><span>newest</span></div></article>
        <article className="mcp-observability-panel"><div className="mcp-observability-panel-head"><strong>Server health</strong><span>{overview.gatewayAvailable ? "gateway reachable" : "gateway unavailable"}</span></div><div className="mcp-observability-server-list">{overview.serverHealth.map((server) => <div className="mcp-observability-server" key={server.name}><StatusDot status={server.status} /><div><strong>{server.name}</strong><small>{server.detail}</small></div><span>{server.status}</span></div>)}</div></article>
      </section>

      <section className="mcp-observability-explorer"><div className="mcp-observability-section-title"><h2>Request explorer</h2><span>{visibleEvents.length} visible · {formatNumber(overview.denied)} denied</span></div><article className="mcp-observability-panel mcp-observability-explorer-grid"><div className="mcp-observability-request-list"><div className="mcp-observability-filterbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tool, user, correlation ID…" aria-label="Search MCP requests" /><select value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Filter outcome"><option value="all">All outcomes</option><option value="success">Success</option><option value="denied">Denied</option><option value="failure">Failure</option></select></div>{visibleEvents.map((event) => <button type="button" key={event.eventId} className={`mcp-observability-request ${event.eventId === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(event.eventId)}><StatusDot status={isDenied(event) ? "denied" : event.outcome} /><span><strong>{event.operation}</strong><small>{event.userId || "unknown user"} · {event.agentId || "direct call"} · {event.vertical || "unclassified"}</small></span><time>{formatDuration(event.duration)}</time></button>)}</div><TraceDetail event={selected} detail={trace} loading={traceLoading} /></article></section>

      <section className="mcp-observability-tools"><div className="mcp-observability-section-title"><h2>Tool health</h2><span>ranked by impact</span></div><article className="mcp-observability-panel mcp-observability-table-wrap"><table><thead><tr><th>Tool</th><th>Calls</th><th>Error rate</th><th>p95</th><th>Denials</th><th>Last seen</th></tr></thead><tbody>{tools.map((tool) => <tr key={tool.operation}><td><span className="mcp-observability-tool-name"><StatusDot status={tool.denials ? "warning" : "healthy"} />{tool.operation}</span></td><td>{formatNumber(tool.calls)}</td><td className={tool.errorRate ? "bad" : "good"}>{tool.errorRate.toFixed(1)}%</td><td>{formatDuration(tool.p95)}</td><td className={tool.denials ? "caution" : ""}>{formatNumber(tool.denials)}</td><td>{formatTime(tool.lastSeen)}</td></tr>)}</tbody></table>{!tools.length && <div className="mcp-observability-empty">No tool calls in the current audit window.</div>}</article></section>

      <EmbeddedFlowDiagram config={OBS_FLOW} testId="mcp-obs-flow" ariaLabel="Where this page's data comes from"
        title="Where this page's data comes from"
        lede="Four BFF reads feed the page: audit events, health, gateway metrics, and the chain-of-custody trace of the selected request." />
    </div>
  );
}
