// IdentityChainPage.jsx — /identity-chain
//
// Live view of who is calling the MCP server through PingGateway, with which
// token, and what PingOne Authorize decided. One card per request, drawn as a
// chain: user -> app -> token -> PingGateway -> PingOne Authorize -> MCP server.
//
// Source: GET /api/admin/agent-gateway/decisions, fed by p1az-decision.groovy's
// POST to /internal/gateway-decision on every decision. It needs no correlation
// id, so third-party apps (e.g. Onyx sending a user's own PingOne token) appear
// here too. In-memory on the BFF: the last 50 decisions, cleared on restart.

import React, { useCallback, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import { decisionBadgeClass, statementMessage } from "../components/AgentGatewayLogPanel";
import "../components/McpGatewayConfig.css";
import "./IdentityChainPage.css";

const REFRESH_MS = 3000;
// Onyx runs locally on the presenter's machine (the third-party AI app in the
// demo). Opened in its own window so the two can sit side by side.
export const ONYX_URL = "http://localhost:3003";

/**
 * The chain for one gateway decision, as display steps.
 * Exported so the step logic is testable without rendering.
 * @param {object} d  one entry from /api/admin/agent-gateway/decisions
 */
export function chainSteps(d) {
  const permitted = String(d.decision || "").toUpperCase() === "PERMIT";
  // A PERMIT with an unmet obligation (step-up MFA, human approval) still stops at
  // PingGateway, which reports where it stopped in `stoppedAt`.
  const held = permitted && Boolean(d.stoppedAt);
  const reached = permitted && !held;
  const reasons = (d.statements || []).map(statementMessage).filter(Boolean);
  if (!reasons.length && d.reason) reasons.push(String(d.reason));
  return [
    {
      key: "user",
      label: "User",
      value: d.email || d.sub || "unknown",
      detail: d.email && d.sub ? `sub ${d.sub}` : "",
      status: "ok",
    },
    {
      key: "app",
      label: "App",
      value: d.clientId || "unknown",
      detail: "OAuth client that obtained the token",
      status: "ok",
    },
    {
      key: "token",
      label: "Token",
      value: d.aud ? `aud ${d.aud}` : "aud not reported",
      detail: [
        d.scope && `scope ${d.scope}`,
        d.iss && `iss ${d.iss}`,
        d.actor ? `acting agent ${d.actor}` : "no delegated agent (no act claim)",
      ].filter(Boolean).join(" · "),
      status: d.actor ? "ok" : "warn",
    },
    {
      key: "gateway",
      label: "PingGateway",
      value: "token verified",
      detail: d.method ? `MCP ${d.method}${d.tool ? ` · ${d.tool}` : ""}` : "",
      status: "ok",
    },
    {
      key: "authorize",
      label: "PingOne Authorize",
      value: d.decision || "UNKNOWN",
      detail: [d.backend && `backend ${d.backend}`, ...reasons].filter(Boolean).join(" · "),
      status: reached ? "ok" : held ? "warn" : "blocked",
      badgeClass: decisionBadgeClass(d),
    },
    {
      key: "mcp",
      label: "MCP server",
      value: reached ? "reached" : held ? "held at PingGateway" : "not reached",
      detail: reached
        ? ""
        : held
          ? "PERMIT with an unmet obligation (e.g. step-up MFA or approval); the call was not forwarded"
          : "the call stopped at PingOne Authorize",
      status: reached ? "ok" : held ? "warn" : "blocked",
    },
  ];
}

function ChainCard({ d }) {
  return (
    <article className="icp-card">
      <header className="icp-card__head">
        <span className="icp-card__time">{new Date(d.ts).toLocaleTimeString()}</span>
        <span className={`mgc-badge ${decisionBadgeClass(d)}`}>{d.decision || "UNKNOWN"}</span>
      </header>
      <ol className="icp-chain">
        {chainSteps(d).map((s) => (
          <li key={s.key} className={`icp-step icp-step--${s.status}`}>
            <span className="icp-step__label">{s.label}</span>
            <span className="icp-step__value">{s.value}</span>
            {s.detail ? <span className="icp-step__detail">{s.detail}</span> : null}
          </li>
        ))}
      </ol>
    </article>
  );
}

export default function IdentityChainPage() {
  const [decisions, setDecisions] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/admin/agent-gateway/decisions", { params: { limit: 20 } });
      setDecisions(Array.isArray(data?.decisions) ? data.decisions : []);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Could not load gateway decisions");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="icp-page">
      <h1 className="icp-title">Identity Chain</h1>
      <p className="icp-intro">
        <a href={ONYX_URL} target="_blank" rel="noopener noreferrer">
          Open Onyx
        </a>{" "}
        in its own window to put the two side by side: every call Onyx makes appears here.
      </p>
      <p className="icp-intro">
        Every MCP call through PingGateway: who the user is, which app is calling, what their token
        carries, and what PingOne Authorize decided. You see your own calls; admins see every
        caller's. It refreshes every few seconds.
      </p>
      {error ? <p className="icp-error" role="alert">{error}</p> : null}
      {!error && decisions.length === 0 ? (
        <p className="icp-empty">
          No gateway decisions yet. Make a call through PingGateway, for example the Onyx trigger
          (~/onyx-trigger-deny.py), and it will appear here.
        </p>
      ) : null}
      {decisions.map((d, i) => (
        <ChainCard key={`${d.ts}-${i}`} d={d} />
      ))}
    </div>
  );
}
