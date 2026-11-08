// /mcp-observability: traffic health, request explorer and tool health for MCP calls.
//
// Honesty: this page is LIVE data. Counts, latencies, the request list and the traces are read from this app's
// durable MCP audit store and health endpoints through the BFF (a user sees their own calls, an admin sees every
// caller's), so it is empty until an agent makes an MCP call. Nothing here is sample data. The one illustration is
// the diagram at the bottom (shared EmbeddedFlowDiagram): its Simulate walks the arrows and calls nothing.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through the
// shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv,
// P7 chips (always with the word), P9 buttons. P6 (inspector) and P8 (diagram boxes) stay as they were.
//
// P9, one primary per view state: the one primary is Refresh, in every state (connecting, data, empty, error). It is
// the only page action that changes what the page shows; in the error state it is the retry. Kibana and the theme
// toggle are secondaries. The diagram's own Simulate button belongs to the shared DiagramStepBar, which this page
// does not restyle.
import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "../services/apiClient";
import { useThemeOptional } from "../context/ThemeContext";
import { KIBANA_URL } from "../config/observabilityLinks";
import "./McpObservabilityPage.css";
import InlineSpinner from '../components/shared/InlineSpinner';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import * as obsFlow from '../config/mcpObservabilityDiagram';
import PageHeader from '../components/common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from '../components/pingUi';

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

// The outcome word is always shown; the tone only adds colour to it (P7). A denied call is an authorization
// decision (red), a failure that was not a denial is amber.
function outcomeOf(event) {
  if (isDenied(event)) return { tone: "danger", word: "Denied" };
  if (event.outcome === "success") return { tone: "ok", word: "Success" };
  if (event.outcome === "failure") return { tone: "warn", word: "Failure" };
  return { tone: "neutral", word: "Unknown" };
}

const HEALTH_TONE = { healthy: "ok", unavailable: "danger", unknown: "neutral" };

function healthChip(status) {
  const word = String(status || "unknown");
  return <StatusChip tone={HEALTH_TONE[word] || "warn"}>{word.charAt(0).toUpperCase() + word.slice(1)}</StatusChip>;
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
  // Said to screen readers only after a manual Refresh (the 15s auto-refresh stays silent).
  const [refreshNote, setRefreshNote] = useState("");

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      endpointGet(`/api/mcp/audit?limit=${AUDIT_LIMIT}`),
      endpointGet("/api/mcp/audit?summary=1"),
      endpointGet("/api/health/gateway-metrics"),
      endpointGet("/api/health"),
    ]);
    const [auditResult, summaryResult, metricsResult, healthResult] = results;
    let loaded = null;
    if (auditResult.status === "fulfilled") {
      const nextEvents = normalizeAuditEvents(auditResult.value);
      loaded = nextEvents.length;
      setEvents(nextEvents);
      setSelectedId((current) => current || nextEvents[0]?.eventId || null);
      setError(null);
    } else {
      setError("MCP audit data is unavailable. Check the admin session and BFF health.");
    }
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
    if (metricsResult.status === "fulfilled") setGatewayMetrics(metricsResult.value);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    const now = new Date();
    setLastUpdated(now);
    setLoading(false);
    return { at: now, loaded };
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const refresh = async () => {
    const { at, loaded } = await load();
    setRefreshNote(loaded == null ? "Refresh failed: MCP audit data is unavailable." : `Refreshed at ${formatTime(at)}: ${loaded} audit events loaded.`);
  };

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
  const recent = events.slice(0, 18).reverse();
  const recentCounts = recent.reduce((acc, event) => { acc[outcomeOf(event).word] = (acc[outcomeOf(event).word] || 0) + 1; return acc; }, {});
  const chartLabel = recent.length
    ? `Last ${recent.length} calls, oldest to newest: ${recentCounts.Success || 0} success, ${recentCounts.Failure || 0} failure, ${recentCounts.Denied || 0} denied. Bar height is duration.`
    : "No calls to chart yet.";
  const liveChip = error
    ? <StatusChip tone="danger">Audit unavailable</StatusChip>
    : <StatusChip tone={lastUpdated ? "ok" : "neutral"}>{lastUpdated ? `Live · ${formatTime(lastUpdated)}` : "Connecting"}</StatusChip>;

  return (
    <PingPage className="mcp-observability-page">
      <SimBanner data-testid="mcp-obs-banner">
        <strong>LIVE DATA</strong> — the counts, latencies, request list and traces on this page are read from this
        app&apos;s durable MCP audit store and health endpoints through the BFF every 15 seconds. You see your own
        calls (an admin sees every caller&apos;s), so it stays empty until an agent makes an MCP call. The one
        illustration is the diagram at the bottom: its Simulate walks the arrows and calls nothing.
      </SimBanner>
      <PageHeader className="mcp-observability-header" title="MCP traffic, with the why attached" summary="A live view of server health, tool performance, and authorization outcomes across the agent gateway."
        actions={<HeaderActions liveChip={liveChip} darkMode={darkMode} onToggleTheme={toggleDarkMode} onRefresh={refresh} />} />
      <p className="mcp-observability-sr" role="status">{refreshNote}</p>

      <PageFrame>
        {error && <div className="mcp-observability-error" role="alert">{error}</div>}

        <Section id="mcp-obs-overview-h" kicker="1 · Overview" title="Tool calls at a glance" lede="Totals come from the durable audit store; latency is from the most recent audited calls.">
          <CardGrid>
            <Metric label="Tool calls" value={loading ? "…" : formatNumber(overview.total)} note="durable MCP audit events" />
            <Metric label="Success rate" value={overview.successRate == null ? "—" : `${overview.successRate.toFixed(1)}%`} note="derived from audit outcomes" />
            <Metric label="p95 latency" value={overview.p95 == null ? "—" : formatDuration(overview.p95)} note="from recent audited calls" tone={overview.p95 > 800 ? "warn" : undefined} chip={overview.p95 > 800 ? <StatusChip tone="warn">Slow</StatusChip> : null} />
            <Metric label="Denied calls" value={formatNumber(overview.denied)} note="authorization decisions" tone={overview.denied ? "danger" : undefined} chip={overview.denied ? <StatusChip tone="danger">Denials</StatusChip> : null} />
          </CardGrid>
        </Section>

        <Section id="mcp-obs-health-h" kicker="2 · Traffic health" title="Traffic health" lede="Auto-refreshes every 15 seconds.">
          <div className="mcp-observability-health-grid">
            <Card tone="neutral" title="Recent call distribution">
              <p className="pu-note">{events.length} events loaded</p>
              <div className="mcp-observability-bars" role="img" aria-label={chartLabel}>{recent.map((event) => <span key={event.eventId} className={`mcp-observability-bar mcp-observability-bar--${outcomeOf(event).tone}`} style={{ height: `${Math.max(12, Math.min(100, safeNumber(event.duration, 20) / Math.max(1, overview.p95 || 100) * 100))}%` }} title={`${event.operation} · ${formatDuration(event.duration)}`} />)}</div>
              <div className="mcp-observability-chart-caption"><span>older</span><span>newest</span></div>
              <p className="pu-status-line"><StatusChip tone="ok">Success</StatusChip><StatusChip tone="warn">Failure</StatusChip><StatusChip tone="danger">Denied</StatusChip></p>
            </Card>
            <Card tone="neutral" title="Server health">
              <p className="pu-status-line">{overview.gatewayAvailable ? "Gateway reachable" : "Gateway unavailable"}</p>
              <KvList items={overview.serverHealth.map((server) => ({ label: server.name, value: <>{healthChip(server.status)}<span className="mcp-observability-detail">{server.detail}</span></> }))} />
            </Card>
          </div>
        </Section>

        <Section id="mcp-obs-explorer-h" kicker="3 · Request explorer" title="Request explorer" lede={`${visibleEvents.length} visible · ${formatNumber(overview.denied)} denied. Select a request to load its trace.`}>
          <Card tone="neutral">
            <div className="mcp-observability-explorer-grid">
              <div className="mcp-observability-request-list">
                <div className="mcp-observability-filterbar">
                  <input className="pu-select" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tool, user, correlation ID…" aria-label="Search MCP requests" />
                  <select className="pu-select" value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Filter outcome"><option value="all">All outcomes</option><option value="success">Success</option><option value="denied">Denied</option><option value="failure">Failure</option></select>
                </div>
                {!visibleEvents.length && <p className="pu-note pu-empty">{events.length ? "No requests match this filter." : "No MCP requests yet."}</p>}
                <div className="mcp-observability-requests" role="list">
                  {visibleEvents.map((event) => {
                    const o = outcomeOf(event);
                    return (
                      <div role="listitem" key={event.eventId}>
                        <button type="button" className="mcp-observability-request" aria-current={event.eventId === selectedId ? "true" : undefined} onClick={() => setSelectedId(event.eventId)}>
                          <span className="mcp-observability-request__main"><strong>{event.operation}</strong><small>{event.userId || "unknown user"} · {event.agentId || "direct call"} · {event.vertical || "unclassified"}</small></span>
                          <span className="mcp-observability-request__side"><StatusChip tone={o.tone}>{o.word}</StatusChip><time>{formatDuration(event.duration)}</time></span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              <TraceDetail event={selected} detail={trace} loading={traceLoading} />
            </div>
          </Card>
        </Section>

        <Section id="mcp-obs-tools-h" kicker="4 · Tool health" title="Tool health" lede="Ranked by impact: denials first, then call volume.">
          <Card tone="neutral">
            {tools.length > 0 && (
              <div className="mcp-observability-table-wrap">
                <table className="mcp-observability-table" data-testid="mcp-obs-tools">
                  <thead><tr><th scope="col">Tool</th><th scope="col">Status</th><th scope="col">Calls</th><th scope="col">Error rate</th><th scope="col">p95</th><th scope="col">Denials</th><th scope="col">Last seen</th></tr></thead>
                  <tbody>{tools.map((tool) => <tr key={tool.operation}><td data-label="Tool" className="mcp-observability-tool-name">{tool.operation}</td><td data-label="Status">{tool.denials ? <StatusChip tone="warn">Denials</StatusChip> : <StatusChip tone="ok">Healthy</StatusChip>}</td><td data-label="Calls">{formatNumber(tool.calls)}</td><td data-label="Error rate">{tool.errorRate.toFixed(1)}%</td><td data-label="p95">{formatDuration(tool.p95)}</td><td data-label="Denials">{formatNumber(tool.denials)}</td><td data-label="Last seen">{formatTime(tool.lastSeen)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {!tools.length && <p className="pu-note pu-empty">No tool calls in the current audit window.</p>}
          </Card>
        </Section>

        <EmbeddedFlowDiagram config={OBS_FLOW} testId="mcp-obs-flow" ariaLabel="Where this page's data comes from"
          title="Where this page's data comes from"
          lede="Four BFF reads feed the page: audit events, health, gateway metrics, and the chain-of-custody trace of the selected request. Boxes move; Simulate walks the arrows; click a box for the request and the standards." pingStyle />
      </PageFrame>
    </PingPage>
  );
}

// Presentational pieces, below the page so the page reads banner-first top to bottom.
function Metric({ label, value, note, tone, chip }) {
  return (
    <Card title={label} tone={tone}>
      <p className="mcp-observability-metric__value">{value}</p>
      {chip}
      <p className="pu-note">{note}</p>
    </Card>
  );
}

function TraceDetail({ event, detail, loading }) {
  if (!event) return <div className="pu-note pu-empty mcp-observability-trace">Select an MCP request to inspect its trace.</div>;
  const outcome = outcomeOf(event);
  const hops = asArray(detail?.hops);
  return (
    <div className="mcp-observability-trace" data-testid="mcp-obs-trace">
      <p className="pu-status-line"><StatusChip tone={outcome.tone}>{outcome.word}</StatusChip><span className="pu-mono">{event.correlationId || event.eventId}</span></p>
      <h3 className="pu-h3 pu-mono">{event.operation}</h3>
      <KvList items={[
        { label: "User", value: event.userId || "Unknown user" },
        { label: "Agent", value: event.agentId || "direct call" },
        { label: "Vertical", value: event.vertical || "unclassified" },
        { label: "Correlation", value: event.correlationId || "—", mono: true },
        { label: "Duration", value: formatDuration(event.duration), mono: true },
      ]} />
      <div className="mcp-observability-waterfall">
        {loading && <div className="pu-note"><InlineSpinner label="Loading chain-of-custody trace…" /></div>}
        {!loading && hops.length > 0 && hops.map((hop, index) => <div className="mcp-observability-hop" key={`${hop.phase || "hop"}-${index}`}><span>{hop.phase || hop.op || "hop"}</span><i style={{ width: `${Math.max(8, Math.min(92, safeNumber(hop.durationMs, 24) / Math.max(1, safeNumber(event.duration, 100)) * 100))}%` }} /><b>{formatDuration(hop.durationMs)}</b></div>)}
        {!loading && hops.length === 0 && <div className="pu-note">Trace unavailable: no chain-of-custody hops were returned.</div>}
      </div>
    </div>
  );
}

function HeaderActions({ liveChip, darkMode, onToggleTheme, onRefresh }) {
  return (
    <div className="pu-actions mcp-observability-header-actions">
      {liveChip}
      <a className="pu-btn" href={KIBANA_URL} target="_blank" rel="noopener noreferrer">Open Kibana logs</a>
      {onToggleTheme && <button type="button" className="pu-btn" onClick={onToggleTheme}>{darkMode ? "☀️ Light mode" : "🌙 Dark mode"}</button>}
      <button type="button" className="pu-btn pu-btn--primary" onClick={onRefresh}>Refresh</button>
    </div>
  );
}
