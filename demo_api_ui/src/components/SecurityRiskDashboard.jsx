import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "../services/apiClient";
import "./SecurityRiskDashboard.css";

const REFRESH_MS = 30_000;
const EMPTY_EVENTS = [];
const EMPTY_SERVICES = {};

const SERVICE_LABELS = {
  mcp_gateway: "MCP gateway",
  mcp_server: "MCP server",
  hitl_service: "Human approval",
  agent_service: "Agent service",
  llm_proxy: "LLM proxy",
};

const CONTROL_FAMILIES = [
  {
    label: "Identity & authentication",
    categories: ["oauth", "auth_lifecycle", "jwks"],
  },
  {
    label: "Token & delegation",
    categories: ["token_exchange", "delegation", "introspection"],
  },
  { label: "Authorization / policy", categories: ["authorize"] },
  { label: "Transaction approval", categories: ["hitl", "threshold"] },
  { label: "Resilience & telemetry", categories: ["mcp", "agent", "config"] },
];

function eventTime(event) {
  const value = Date.parse(event?.timestamp || "");
  return Number.isFinite(value) ? value : 0;
}

function formatAge(timestamp) {
  if (!timestamp) return "No recent event";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - eventTime({ timestamp })) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function eventLabel(event) {
  return event?.message || event?.tag || event?.category || "Security event";
}

function normalizeEvents(payload) {
  return Array.isArray(payload?.events) ? payload.events : [];
}

function serviceState(service) {
  if (service?.configured === false) return "unknown";
  if (service?.up === true) return "healthy";
  if (service?.up === false) return "down";
  return "unknown";
}

function severityForEvent(event) {
  if (event?.severity === "error") return "high";
  if (event?.severity === "warning" || event?.severity === "warn")
    return "medium";
  return "low";
}

function buildRiskQueue(events, services, limit = 4) {
  const candidates = events
    .filter(
      (event) =>
        event?.severity === "error" ||
        event?.severity === "warning" ||
        event?.severity === "warn",
    )
    .map((event) => ({
      id: event.id || `${event.category}-${event.timestamp}`,
      title: eventLabel(event),
      detail: `${event.category || "system"} signal${event.tag ? ` · ${event.tag}` : ""}`,
      severity: severityForEvent(event),
      owner:
        event.category === "authorize"
          ? "Authorization"
          : "Platform operations",
      age: formatAge(event.timestamp),
      status: event.severity === "error" ? "Investigate" : "Monitor",
      sortTime: eventTime(event),
      sortSeverity: severityForEvent(event) === "high" ? 3 : 2,
    }));

  Object.entries(services || {})
    .filter(([, service]) => service?.up === false && service?.configured !== false)
    .forEach(([key, service]) => {
      candidates.push({
        id: `service-${key}`,
        title: `${SERVICE_LABELS[key] || key} unavailable`,
        detail: service.error || "Health probe failed",
        severity: "high",
        owner: "Platform operations",
        age: "Current",
        status: "Investigate",
        sortTime: Number.MAX_SAFE_INTEGER,
        sortSeverity: 3,
      });
    });

  return candidates
    .sort((a, b) => b.sortSeverity - a.sortSeverity || b.sortTime - a.sortTime)
    .slice(0, limit)
    .map(({ sortTime: _sortTime, sortSeverity: _sortSeverity, ...risk }) => risk);
}

function buildSignalTrend(events, now = Date.now()) {
  const bucketCount = 12;
  const windowMs = 24 * 60 * 60 * 1000;
  const bucketMs = windowMs / bucketCount;
  const start = now - windowMs;
  const buckets = Array.from({ length: bucketCount }, () => ({ total: 0, errors: 0, warnings: 0 }));

  events.forEach((event) => {
    const timestamp = eventTime(event);
    if (!timestamp || timestamp < start || timestamp > now) return;
    const index = Math.min(bucketCount - 1, Math.floor((timestamp - start) / bucketMs));
    buckets[index].total += 1;
    if (event.severity === "error") buckets[index].errors += 1;
    if (event.severity === "warning" || event.severity === "warn") buckets[index].warnings += 1;
  });

  const maxTotal = Math.max(1, ...buckets.map((bucket) => bucket.total));
  return buckets.map((bucket) => ({
    events: (bucket.total / maxTotal) * 100,
    errors: (bucket.errors / maxTotal) * 100,
    warnings: (bucket.warnings / maxTotal) * 100,
  }));
}

function SignalBar({ value, tone }) {
  return (
    <span
      className={`srd-signal-bar srd-signal-bar--${tone}`}
      style={{ height: value > 0 ? `${Math.max(8, value)}%` : "0%" }}
    />
  );
}

function StatusBadge({ status }) {
  const labels = { healthy: "Healthy", down: "Degraded", unknown: "Unknown" };
  return (
    <span className={`srd-status srd-status--${status}`}>
      <span className="srd-status-dot" />
      {labels[status]}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="srd-state">
      <span className="srd-spinner" />
      Loading security posture…
    </div>
  );
}

function ErrorState({ onRetry }) {
  return (
    <div className="srd-state srd-state--error">
      <strong>Security posture is unavailable.</strong>
      <span>
        Live evidence could not be loaded. No green status is shown when
        telemetry is missing.
      </span>
      <button
        className="srd-button srd-button--primary"
        type="button"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

export default function SecurityRiskDashboard() {
  const [snapshot, setSnapshot] = useState(null);
  const [state, setState] = useState("loading");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selectedRiskId, setSelectedRiskId] = useState(null);

  const load = useCallback(async () => {
    setState((current) => (current === "ready" ? "refreshing" : "loading"));
    try {
      const [serviceResult, eventResult, gatewayResult] = await Promise.all([
        apiClient.get("/api/health/services", { _silent: true }),
        apiClient.get("/api/admin/app-events?limit=100", { _silent: true }),
        apiClient.get("/api/health/gateway-metrics", { _silent: true }),
      ]);
      setSnapshot({
        services: serviceResult.data?.services || {},
        serviceTimestamp: serviceResult.data?.timestamp,
        events: normalizeEvents(eventResult.data),
        gateway: gatewayResult.data || { available: false },
      });
      setLastRefresh(new Date());
      setState("ready");
    } catch (error) {
      console.error("[SecurityRiskDashboard] Load failed:", error);
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  const events = snapshot?.events || EMPTY_EVENTS;
  const services = snapshot?.services || EMPTY_SERVICES;
  const risks = useMemo(
    () => buildRiskQueue(events, services),
    [events, services],
  );
  const allRisks = useMemo(
    () => buildRiskQueue(events, services, Infinity),
    [events, services],
  );
  const signalTrend = useMemo(() => buildSignalTrend(events), [events]);
  const selectedRisk =
    risks.find((risk) => risk.id === selectedRiskId) || risks[0] || null;
  const errors = events.filter((event) => event.severity === "error");
  const warnings = events.filter(
    (event) => event.severity === "warning" || event.severity === "warn",
  );
  const decisions = events.filter(
    (event) =>
      event.category === "authorize" || event.category === "token_exchange",
  );
  const unavailableServices = Object.values(services).filter(
    (service) => service?.up === false && service?.configured !== false,
  ).length;
  const posture =
    unavailableServices || errors.length
      ? "Elevated"
      : warnings.length
        ? "Watch"
        : "Healthy";
  const postureTone =
    posture === "Healthy" ? "good" : posture === "Watch" ? "warn" : "bad";
  const latestEvent = events
    .slice()
    .sort((a, b) => eventTime(b) - eventTime(a))[0];

  const controlRows = CONTROL_FAMILIES.map((control) => {
    const relevant = events.filter((event) =>
      control.categories.includes(event.category),
    );
    const problems = relevant.filter(
      (event) =>
        event.severity === "error" ||
        event.severity === "warning" ||
        event.severity === "warn",
    );
    return {
      ...control,
      value: relevant.length
        ? problems.length
          ? "Watch"
          : "Observed"
        : "No evidence",
      tone: problems.some((event) => event.severity === "error")
        ? "bad"
        : problems.length
          ? "warn"
          : relevant.length
            ? "good"
            : "unknown",
      detail: relevant.length
        ? `${relevant.length} recent signal${relevant.length === 1 ? "" : "s"}`
        : "No signal in window",
    };
  });

  if (state === "loading" && !snapshot)
    return (
      <main className="srd-page">
        <LoadingState />
      </main>
    );
  if (state === "error" && !snapshot)
    return (
      <main className="srd-page">
        <ErrorState onRetry={load} />
      </main>
    );

  return (
    <main className="srd-page">
      <header className="srd-header">
        <div>
          <div className="srd-eyebrow">Security operations</div>
          <h1>Security &amp; Risk Dashboard</h1>
          <p>
            Evidence-backed posture across identity, policy, delegation,
            approvals, and infrastructure.
          </p>
        </div>
        <div className="srd-header-actions">
          <span className="srd-freshness">
            <span className="srd-status-dot srd-status-dot--good" />
            Data {state === "refreshing" ? "refreshing" : "current"}
          </span>
          <button
            className="srd-button"
            type="button"
            onClick={load}
            disabled={state === "refreshing"}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="srd-context" aria-label="Dashboard context">
        <span className="srd-context-chip">Application-wide scope</span>
        <span>Last 24 hours</span>
        <span>
          Last refresh {lastRefresh ? lastRefresh.toLocaleTimeString() : "—"}
        </span>
        <span>Evidence freshness {formatAge(latestEvent?.timestamp)}</span>
      </section>

      <section
        className="srd-metric-grid"
        aria-label="Security posture summary"
      >
        <article className={`srd-metric srd-metric--${postureTone}`}>
          <span className="srd-label">Overall posture</span>
          <strong>{posture}</strong>
          <span>
            {unavailableServices
              ? `${unavailableServices} dependency issue${unavailableServices === 1 ? "" : "s"}`
              : `${errors.length} high-signal event${errors.length === 1 ? "" : "s"}`}
          </span>
        </article>
        <article className="srd-metric">
          <span className="srd-label">Critical exposure</span>
          <strong>
            {allRisks.filter((risk) => risk.severity === "high").length}
          </strong>
          <span>
            {errors.length
              ? "Requires investigation"
              : "No error events observed"}
          </span>
        </article>
        <article className="srd-metric">
          <span className="srd-label">Control evidence</span>
          <strong>
            {controlRows.filter((row) => row.tone === "good").length}/
            {controlRows.length}
          </strong>
          <span>
            {controlRows.filter((row) => row.value === "No evidence").length}{" "}
            without current evidence
          </span>
        </article>
        <article className="srd-metric">
          <span className="srd-label">Security decisions</span>
          <strong>{decisions.length}</strong>
          <span>Authorize and exchange signals</span>
        </article>
        <article className="srd-metric">
          <span className="srd-label">Open incidents</span>
          <strong>{errors.length + unavailableServices}</strong>
          <span>
            {warnings.length} warning signal{warnings.length === 1 ? "" : "s"}
          </span>
        </article>
      </section>

      {risks.length > 0 && (
        <div className="srd-alert">
          <span>
            <strong>Action required:</strong> {risks.length} material signal
            {risks.length === 1 ? "" : "s"} need review before posture can be
            considered healthy.
          </span>
          <button
            className="srd-button srd-button--primary"
            type="button"
            onClick={() => setSelectedRiskId(risks[0].id)}
          >
            Review risk queue
          </button>
        </div>
      )}

      <section className="srd-grid srd-grid--top">
        <article className="srd-panel srd-panel--wide">
          <div className="srd-panel-head">
            <div>
              <h2>Security signal trend</h2>
              <p>Recent event volume, grouped by signal type</p>
            </div>
            <div className="srd-legend">
              <span>
                <i className="srd-legend-dot srd-legend-dot--blue" />
                Events
              </span>
              <span>
                <i className="srd-legend-dot srd-legend-dot--red" />
                Errors
              </span>
              <span>
                <i className="srd-legend-dot srd-legend-dot--amber" />
                Warnings
              </span>
            </div>
          </div>
          <div
            className="srd-chart"
            aria-label="Security signal volume across the last 24 hours"
          >
            {signalTrend.map((bucket, index) => (
              <div className="srd-bar-group" key={`bar-${index}`}>
                <SignalBar value={bucket.events} tone="blue" />
                <SignalBar value={bucket.errors} tone="red" />
                <SignalBar value={bucket.warnings} tone="amber" />
              </div>
            ))}
          </div>
          <div className="srd-axis">
            <span>24h ago</span>
            <span>12h ago</span>
            <span>Now</span>
          </div>
          <p className="srd-footnote">
            Derived from structured event timestamps currently available to the
            BFF; this is not a long-term reporting metric.
          </p>
        </article>
        <article className="srd-panel">
          <div className="srd-panel-head">
            <div>
              <h2>Control effectiveness</h2>
              <p>Current evidence, not a compliance certification</p>
            </div>
          </div>
          {controlRows.map((row) => (
            <div className="srd-control" key={row.label}>
              <div className="srd-control-line">
                <span>{row.label}</span>
                <strong className={`srd-text--${row.tone}`}>{row.value}</strong>
              </div>
              <div className="srd-control-track">
                <span
                  className={`srd-control-fill srd-control-fill--${row.tone}`}
                />
              </div>
              <small>{row.detail}</small>
            </div>
          ))}
        </article>
      </section>

      <section className="srd-grid srd-grid--middle">
        <article className="srd-panel srd-panel--wide">
          <div className="srd-panel-head">
            <div>
              <h2>Risk queue</h2>
              <p>Prioritized by severity and current evidence</p>
            </div>
            <span className="srd-panel-meta">{risks.length} active</span>
          </div>
          {risks.length ? (
            <div className="srd-table-wrap">
              <table className="srd-table">
                <thead>
                  <tr>
                    <th>Risk</th>
                    <th>Severity</th>
                    <th>Owner</th>
                    <th>Age</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {risks.map((risk) => (
                    <tr
                      className={
                        selectedRisk?.id === risk.id ? "srd-row--selected" : ""
                      }
                      key={risk.id}
                      onClick={() => setSelectedRiskId(risk.id)}
                    >
                      <td>
                        <strong>{risk.title}</strong>
                        <small>{risk.detail}</small>
                      </td>
                      <td>
                        <span className={`srd-pill srd-pill--${risk.severity}`}>
                          {risk.severity === "high" ? "High" : "Medium"}
                        </span>
                      </td>
                      <td>{risk.owner}</td>
                      <td>{risk.age}</td>
                      <td>
                        <span
                          className={`srd-pill srd-pill--${risk.status === "Investigate" ? "open" : "monitor"}`}
                        >
                          {risk.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="srd-empty">
              No high-signal risks are present in the current evidence window.
            </div>
          )}
        </article>
        <article className="srd-panel">
          <div className="srd-panel-head">
            <div>
              <h2>Identity &amp; token signals</h2>
              <p>Last 24 hours</p>
            </div>
          </div>
          <div className="srd-signal-grid">
            <div>
              <span className="srd-label">Auth events</span>
              <strong>
                {
                  events.filter((event) =>
                    ["oauth", "auth_lifecycle"].includes(event.category),
                  ).length
                }
              </strong>
            </div>
            <div>
              <span className="srd-label">Step-up signals</span>
              <strong>
                {
                  events.filter((event) =>
                    /step.?up|mfa/i.test(eventLabel(event)),
                  ).length
                }
              </strong>
            </div>
            <div>
              <span className="srd-label">Token exchange</span>
              <strong>
                {
                  events.filter((event) => event.category === "token_exchange")
                    .length
                }
              </strong>
            </div>
            <div>
              <span className="srd-label">Policy denies</span>
              <strong
                className={
                  events.filter((event) =>
                    /deny|denied/i.test(eventLabel(event)),
                  ).length
                    ? "srd-text--bad"
                    : ""
                }
              >
                {
                  events.filter((event) =>
                    /deny|denied/i.test(eventLabel(event)),
                  ).length
                }
              </strong>
            </div>
          </div>
          <p className="srd-footnote">
            Counts reflect structured app events currently available to the BFF.
          </p>
        </article>
      </section>

      <section className="srd-panel">
        <div className="srd-panel-head">
          <div>
            <h2>Infrastructure trust boundaries</h2>
            <p>
              Health is separate from security posture; unknown means not
              measured.
            </p>
          </div>
          <span className="srd-panel-meta">
            Updated {formatAge(snapshot?.serviceTimestamp)}
          </span>
        </div>
        <div className="srd-health-grid">
          <div className="srd-health">
            <div>
              <strong>BFF / API</strong>
              <StatusBadge status="healthy" />
            </div>
            <p>Dashboard endpoint responded successfully</p>
          </div>
          {Object.entries(services).map(([key, service]) => (
            <div className="srd-health" key={key}>
              <div>
                <strong>{SERVICE_LABELS[key] || key}</strong>
                <StatusBadge status={serviceState(service)} />
              </div>
              <p>
                {service?.configured === false
                  ? "Optional service is not configured"
                  : service?.up === false
                  ? service.error || "Health probe failed"
                  : service?.up === true
                    ? "Health probe passed"
                    : "No health probe"}
              </p>
            </div>
          ))}
          <div className="srd-health">
            <div>
              <strong>PingOne / DaVinci</strong>
              <StatusBadge status="unknown" />
            </div>
            <p>Dependency telemetry is not exposed by this aggregate yet</p>
          </div>
          <div className="srd-health">
            <div>
              <strong>Gateway metrics</strong>
              <StatusBadge
                status={snapshot?.gateway?.available ? "healthy" : "unknown"}
              />
            </div>
            <p>
              {snapshot?.gateway?.available
                ? `${snapshot.gateway.methods?.length || 0} metric families available`
                : "PingGateway metrics unavailable"}
            </p>
          </div>
        </div>
      </section>

      <section className="srd-grid srd-grid--bottom">
        <article className="srd-panel srd-panel--wide">
          <div className="srd-panel-head">
            <div>
              <h2>Evidence timeline</h2>
              <p>Recent events that changed or validated posture</p>
            </div>
          </div>
          {events.length ? (
            <ol className="srd-timeline">
              {events
                .slice()
                .sort((a, b) => eventTime(b) - eventTime(a))
                .slice(0, 5)
                .map((event) => (
                  <li
                    key={event.id || `${event.timestamp}-${eventLabel(event)}`}
                  >
                    <strong>{eventLabel(event)}</strong>
                    <span>
                      {event.timestamp
                        ? new Date(event.timestamp).toLocaleString()
                        : "Time unavailable"}{" "}
                      · {event.category || "system"}
                      {event.correlationId
                        ? ` · ${event.correlationId.slice(0, 8)}…`
                        : ""}
                    </span>
                  </li>
                ))}
            </ol>
          ) : (
            <div className="srd-empty">
              No evidence events are available yet.
            </div>
          )}
        </article>
        <article className="srd-panel">
          <div className="srd-panel-head">
            <div>
              <h2>Selected risk</h2>
              <p>{selectedRisk ? selectedRisk.id : "No active risk"}</p>
            </div>
            {selectedRisk && (
              <span className={`srd-pill srd-pill--${selectedRisk.severity}`}>
                {selectedRisk.severity === "high" ? "High" : "Medium"}
              </span>
            )}
          </div>
          {selectedRisk ? (
            <>
              <p className="srd-detail-label">Why it matters</p>
              <p className="srd-detail-copy">
                {selectedRisk.detail}. This signal needs an owner, evidence
                review, and a recorded remediation decision.
              </p>
              <p className="srd-detail-label">Next action</p>
              <p className="srd-detail-copy">
                Open the source event using its correlation ID and confirm
                whether the condition is expected, contained, or requires a
                control change.
              </p>
              <button
                className="srd-button srd-button--primary"
                type="button"
                onClick={() => setSelectedRiskId(null)}
              >
                Acknowledge for review
              </button>
            </>
          ) : (
            <p className="srd-empty">
              The dashboard will show investigation details when a material
              signal is present.
            </p>
          )}
        </article>
      </section>

      <footer className="srd-footer">
        Read-only security view · Values are derived from current BFF health and
        structured event evidence.
      </footer>
    </main>
  );
}
