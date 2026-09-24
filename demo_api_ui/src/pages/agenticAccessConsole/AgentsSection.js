import React, { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";
import ExpandableRow from "./ExpandableRow";
import { AGENT_METADATA_LABELS, AGENT_ROLES, PRIMARY_AGENT } from "../../config/agentTerminology";
import {
  fetchA2aSpecialistRegistry,
  specialistRoleLabel,
} from "../../services/a2aSpecialistRegistry";

const AGENTS = [
  {
    id: "langchain_agent",
    identity: PRIMARY_AGENT.displayName,
    runtime: "langchain_agent",
    framework: "LangGraph",
  },
];

const OAUTH_MCP_TOOLS = [
  "get_my_accounts", "get_account_balance", "get_my_transactions", "search_transactions",
  "create_deposit", "create_withdrawal", "create_transfer", "get_sensitive_account_details",
  "request_fee_waiver", "update_contact_email", "get_branch_hours", "sequential_think",
];

const RESOURCE_SERVER_TOOLS = [
  "list_banking_accounts", "get_banking_account", "list_gear", "gear_order_status", "checkout",
];

function SpecialistsPanel({ specialists, loading, error }) {
  return (
    <div className="aac-section-block">
      <h3>Vertical specialists (A2A)</h3>
      <p className="aac-card-sub">
        One {AGENT_ROLES.specialist.toLowerCase()} per vertical — the {AGENT_ROLES.generalist}
        delegates a single
        sensitive read task to. Source: the server A2A specialist registry. The registry is
        the source for specialist identity and capability metadata; authorization is evaluated
        separately by PingOne Authorize. Click
        a row for the full specialist detail.
      </p>
      <div className="aac-table-wrap">
        <table className="aac-table">
          <thead>
            <tr>
              <th scope="col">Vertical</th>
              <th scope="col">Specialist</th>
              <th scope="col">Tool(s)</th>
            </tr>
          </thead>
          <tbody>
            {specialists.map((s) => (
              <ExpandableRow
                key={s.vertical}
                detail={s}
                cells={[
                  <th key="vertical" scope="row" className="aac-mono">{s.vertical}</th>,
                  <td key="name">
                    {specialistRoleLabel(s)}
                    {s.canonicalVertical !== s.vertical && (
                      <span className="aac-card-sub"> (alias of {s.canonicalVertical})</span>
                    )}
                  </td>,
                  <td key="tools" className="aac-mono">{s.tools.join(", ")}</td>,
                ]}
              />
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="aac-card-sub">Loading specialist registry…</p>}
      {error && <p className="aac-card-sub">Specialist registry unavailable.</p>}
    </div>
  );
}

function ScopeStatusBadge({ status }) {
  const map = { drift: "broken", match: "live", unverified: "neutral" };
  return <span className={`aac-badge aac-badge--${map[status] || "neutral"}`}>{status}</span>;
}

export default function AgentsSection({ user }) {
  const [registry, setRegistry] = useState(null);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [specialists, setSpecialists] = useState([]);
  const [specialistsLoading, setSpecialistsLoading] = useState(true);
  const [specialistsError, setSpecialistsError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiClient
      .get("/api/registry/agents")
      .then(({ data }) => { if (!cancelled) setRegistry(data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    fetchA2aSpecialistRegistry()
      .then((entries) => {
        if (cancelled) return;
        setSpecialists(entries);
        setSpecialistsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSpecialistsError(true);
        setSpecialistsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const liveRows = registry?.rows || [];
  const showLive = !!user && !error && liveRows.length > 0;

  if (showLive) {
    const selected = liveRows.find((r) => r.id === selectedId) || liveRows[0];
    return (
      <div>
        <p className="aac-section-intro">
          Real non-human {AGENT_METADATA_LABELS.identity.toLowerCase()} records from PingOne,
          the demo's own OAuth client registry, and computed {AGENT_METADATA_LABELS.card}s.
          Select one to see its scopes and lifecycle. <span className="aac-badge aac-badge--live">Live</span>
        </p>

        <div className="aac-grid-3">
          {liveRows.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`aac-card aac-agent-card${r.id === selected.id ? " aac-agent-card--active" : ""}`}
              onClick={() => setSelectedId(r.id)}
              aria-pressed={r.id === selected.id}
            >
              <div className="aac-card-title">{r.name}</div>
              <div className="aac-card-sub">{AGENT_METADATA_LABELS.identity} · {r.identityType} · {r.source}</div>
              <div className="aac-card-body">
                <span className="aac-badge aac-badge--neutral">{r.status || "unknown"}</span>{" "}
                <ScopeStatusBadge status={r.scopeStatus} />
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <div className="aac-card aac-detail-panel">
            <div className="aac-card-title">{selected.name} — {AGENT_METADATA_LABELS.identity}, scopes &amp; lifecycle</div>
            <div className="aac-card-sub" style={{ marginTop: 8 }}>Granted scopes</div>
            <div className="aac-chip-row">
              {(selected.grantedScopes || []).length > 0
                ? selected.grantedScopes.map((s) => <span key={s} className="aac-chip">{s}</span>)
                : <span className="aac-card-sub">none</span>}
            </div>
            {(selected.missingScopes || []).length > 0 && (
              <>
                <div className="aac-card-sub" style={{ marginTop: 10 }}>Missing (expected but not granted)</div>
                <div className="aac-chip-row">
                  {selected.missingScopes.map((s) => <span key={s} className="aac-chip">{s}</span>)}
                </div>
              </>
            )}
            <div className="aac-card-sub" style={{ marginTop: 10 }}>
              Lifecycle events: {(selected.lifecycle || []).length}
            </div>
          </div>
        )}
        {registry.sources && Object.entries(registry.sources).some(([, s]) => s.up === false) && (
          <p className="aac-card-sub" style={{ marginTop: 10 }}>
            {Object.entries(registry.sources).filter(([, s]) => s.up === false).map(([name]) => name).join(", ")} unavailable — other sources still shown.
          </p>
        )}

        <SpecialistsPanel
          specialists={specialists}
          loading={specialistsLoading}
          error={specialistsError}
        />
      </div>
    );
  }

  const selected = AGENTS.find((a) => a.id === (selectedId || AGENTS[0].id));

  return (
    <div>
      <p className="aac-section-intro">
        Each {AGENT_METADATA_LABELS.runtime.toLowerCase()} reaches the same 3 MCP servers —
        access is gated by policy, not implied by the {AGENT_METADATA_LABELS.identity.toLowerCase()}.
        Select a runtime to see its reachable tools.
      </p>

      <div className="aac-grid-3">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`aac-card aac-agent-card${a.id === selected.id ? " aac-agent-card--active" : ""}`}
            onClick={() => setSelectedId(a.id)}
            aria-pressed={a.id === selected.id}
          >
            <div className="aac-card-title">{a.identity}</div>
            <div className="aac-card-sub">{AGENT_METADATA_LABELS.runtime}: {a.runtime} · {a.framework}</div>
            {a.note && <div className="aac-card-sub">{a.note}</div>}
            <div className="aac-card-body">
              <span className="aac-badge aac-badge--live">Active</span>{" "}
              <span className="aac-badge aac-badge--neutral">3 MCPs</span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="aac-card aac-detail-panel">
          <div className="aac-card-title">{selected.identity} — {AGENT_METADATA_LABELS.runtime}: {selected.runtime}</div>
          <div className="aac-card-sub" style={{ marginTop: 8 }}>Framework: {selected.framework}</div>
          <div className="aac-card-sub" style={{ marginTop: 8 }}>oauth-mcp (banking-mcp-server)</div>
          <div className="aac-chip-row">
            {OAUTH_MCP_TOOLS.map((t) => <span key={t} className="aac-chip">{t}</span>)}
            <span className="aac-chip">+20 more</span>
          </div>
          <div className="aac-card-sub" style={{ marginTop: 14 }}>
            demo_mcp_resource_server (banking-mcp-resource-server) — scoped to active vertical, Super Sports shown
          </div>
          <div className="aac-chip-row">
            {RESOURCE_SERVER_TOOLS.map((t) => <span key={t} className="aac-chip">{t}</span>)}
          </div>
        </div>
      )}

      <p className="aac-card-sub" style={{ marginTop: 12 }}>
        {!user
          ? "Sign in to see live agent registry data."
          : error
            ? "Live agent registry unavailable — showing the illustrative runtime catalog."
            : "Loading live agent registry…"}
      </p>

      <SpecialistsPanel
        specialists={specialists}
        loading={specialistsLoading}
        error={specialistsError}
      />
    </div>
  );
}
