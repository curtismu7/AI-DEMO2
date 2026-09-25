import React, { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";

/**
 * SecuritySection — threat monitoring, gateway decisions and attack simulation.
 *
 * Live sources:
 *   GET /api/admin/agent-gateway/decisions — recent PingOne Authorize decisions
 *   posted by PingGateway. Signed-in users get every decision about their own
 *   sub (admins see all); guests get an empty list, so the panel still renders.
 *   GET /api/admin/agent-gateway/logs — real PingGateway container logs,
 *   token-redacted, any signed-in user.
 *
 *   GET /api/security/* (anomalies, alerts, metrics) is admin-token gated — the
 *   panel renders a sign-in-as-admin note rather than pretending to fetch.
 *
 * The attack simulator itself is a POST with side effects; this tab only points
 * to it, it never arms or runs attacks on page load.
 */

function SeverityPill({ severity }) {
  const label = String(severity || "info").toUpperCase();
  const cls = label === "critical" || label === "emergency" ? "aac-pill--deny" : label === "warning" ? "aac-pill--indeterminate" : "aac-pill--permit";
  return <span className={`aac-pill ${cls}`}>{label}</span>;
}

function DecisionPill({ decision }) {
  const label = String(decision || "UNKNOWN").toUpperCase();
  const cls = label === "PERMIT" ? "aac-pill--permit" : label === "DENY" ? "aac-pill--deny" : "aac-pill--indeterminate";
  return <span className={`aac-pill ${cls}`}>{label}</span>;
}

export default function SecuritySection() {
  const [decisions, setDecisions] = useState([]);
  const [decisionsError, setDecisionsError] = useState(false);

  const [gatewayLogs, setGatewayLogs] = useState(null);
  const [gatewayLogsError, setGatewayLogsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/api/admin/agent-gateway/decisions?limit=15")
      .then(({ data }) => { if (!cancelled) setDecisions(Array.isArray(data?.decisions) ? data.decisions : []); })
      .catch(() => { if (!cancelled) setDecisionsError(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/api/admin/agent-gateway/logs?tail=20&filter=P1AZ")
      .then(({ data }) => { if (!cancelled) setGatewayLogs(data); })
      .catch(() => { if (!cancelled) setGatewayLogsError(true); });
    return () => { cancelled = true; };
  }, []);

  const permitted = decisions.filter((d) => String(d.decision).toLowerCase() === "permit").length;
  const denied = decisions.filter((d) => String(d.decision).toLowerCase() !== "permit").length;

  return (
    <div>
      <p className="aac-section-intro">
        What the control plane sees when things go wrong: real PingOne Authorize
        decisions posted by PingGateway, the gateway's own redacted logs, and the
        attack-simulation surface. Signed-out visitors see structure but not
        personal decision rows — identity-scoped data stays behind sign-in.
      </p>

      <div className="aac-stat-grid">
        <div className="aac-stat-tile">
          <div className="aac-stat-value" style={{ color: "var(--th-status-success, #3fb27f)" }}>{decisionsError ? "—" : permitted}</div>
          <div className="aac-stat-label">Permitted (recent)</div>
          <div className="aac-stat-detail">gateway decision buffer</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value" style={{ color: "var(--th-status-error-text, #d95c5c)" }}>{decisionsError ? "—" : denied}</div>
          <div className="aac-stat-label">Denied / other</div>
          <div className="aac-stat-detail">scope backstop, policy deny, HITL pending</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value">{gatewayLogs?.ok ? "✓" : gatewayLogsError ? "—" : "…"}</div>
          <div className="aac-stat-label">Gateway log feed</div>
          <div className="aac-stat-detail">real PingGateway container, token-redacted</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value">🔒</div>
          <div className="aac-stat-label">Security API</div>
          <div className="aac-stat-detail">/api/security/* — admin token required</div>
        </div>
      </div>

      <div className="aac-section-block">
        <h3>
          Gateway P1AZ decisions{" "}
          {!decisionsError && <span className="aac-badge aac-badge--live">Live</span>}
        </h3>
        <p className="aac-card-sub" style={{ marginBottom: 10 }}>
          Source: <code>GET /api/admin/agent-gateway/decisions</code> — PingGateway
          posts each Authorize verdict to the BFF as it enforces tool calls.
          Signed-in users see decisions about their own identity; admins see all.
        </p>
        {decisionsError ? (
          <div className="aac-card"><div className="aac-card-body">Gateway decision feed unavailable right now.</div></div>
        ) : decisions.length === 0 ? (
          <div className="aac-card"><div className="aac-card-body">
            No decisions visible to you yet. Sign in and run an agent tool call, or
            ask an admin about the full decision buffer.
          </div></div>
        ) : (
          <div className="aac-table-wrap">
            <table className="aac-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Tool</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => (
                  <tr key={d.id || i}>
                    <td className="aac-mono">{(d.timestamp || "").slice(11, 19) || "—"}</td>
                    <td className="aac-mono">{d.tool || d.toolName || "—"}</td>
                    <td><DecisionPill decision={d.decision || d.result} /></td>
                    <td>{d.reason || d.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="aac-section-block">
        <h3>
          PingGateway logs{" "}
          {gatewayLogs?.ok && <span className="aac-badge aac-badge--live">Live</span>}
          {gatewayLogsError && <span className="aac-badge aac-badge--broken">Unavailable</span>}
        </h3>
        {gatewayLogsError || !gatewayLogs?.ok ? (
          <div className="aac-card"><div className="aac-card-body">
            {gatewayLogsError || !gatewayLogs
              ? "Gateway log feed unavailable right now."
              : (gatewayLogs.error || "Gateway is not running in this environment.")}
          </div></div>
        ) : (
          <div className="aac-table-wrap">
            <table className="aac-table">
              <thead>
                <tr><th scope="col">Recent lines (P1AZ filter)</th></tr>
              </thead>
              <tbody>
                {(gatewayLogs.lines || gatewayLogs.logs || []).slice(0, 12).map((line, i) => (
                  <tr key={i}><td className="aac-mono" style={{ fontSize: "var(--font-size-2xs)" }}>{String(line).slice(0, 220)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="aac-section-block">
        <h3>Security monitoring API <span className="aac-badge aac-badge--admin">admin</span></h3>
        <p className="aac-card-sub" style={{ marginBottom: 10 }}>
          <code>GET /api/security/dashboard · /alerts · /anomalies · /metrics</code> —
          anomaly detection, per-client risk scores and threat counters. Gated by
          an admin token on purpose: alert payloads name clients, subs and risk
          behavior. Sign in as an admin, or open the dedicated security pages from
          the side nav for the full view.
        </p>
        <div className="aac-chip-row">
          {["dashboard", "alerts", "anomalies", "metrics", "clients/:id/report"].map((x) => (
            <span key={x} className="aac-chip">{x}</span>
          ))}
        </div>
      </div>

      <div className="aac-section-block">
        <h3>Attack simulation <span className="aac-badge aac-badge--user">sign-in</span></h3>
        <p className="aac-card-sub">
          The attack simulator (<code>POST /api/demo/attack-sim/run</code>) replays
          seeded attack flows against the live policy — token replay, scope
          escalation, audience confusion. It is deliberately a signed-in, explicit
          action, never an automatic page-load fetch. Run it from the dedicated
          simulator page while signed in, then come back here and watch the
          decision buffer above light up with the denials.
        </p>
      </div>
    </div>
  );
}
