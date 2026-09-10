import React, { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";
import ExpandableRow from "./ExpandableRow";

const AGENTS = [
  {
    id: "openai_agent",
    identity: "BankingAssistant",
    runtime: "openai_agent",
    framework: "OpenAI Agents SDK",
  },
  {
    id: "mastra_agent",
    identity: "Banking Agent",
    runtime: "mastra_agent",
    framework: "Mastra",
    note: "id: banking-agent",
  },
  {
    id: "langchain_agent",
    identity: "langchain_agent",
    runtime: "langchain_agent",
    framework: "LangGraph",
  },
  {
    id: "pydantic_agent",
    identity: "pydantic_agent",
    runtime: "pydantic_agent",
    framework: "Pydantic AI",
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

// Per-vertical A2A specialist registry — source: demo_api_server/config/a2aSpecialists.js.
// Distinct from the 4 generalist runtimes above: a generalist (Agent 1) delegates
// one narrow, sensitive read task to its vertical's specialist (Agent 2) over a
// chained RFC 8693 exchange — see the Token Exchange and CIBA tabs.
const SPECIALISTS = [
  { vertical: "banking", appKey: "investment", appName: "Super Banking Investment Advisor Agent", name: "Investment Advisor", tools: ["get_portfolio_summary", "get_investment_accounts", "get_investment_balance", "get_investment_transactions"], subtaskHint: "review the customer's investment positions" },
  { vertical: "healthcare", appKey: "records", appName: "Super Banking Records Specialist Agent", name: "Records Specialist", tools: ["sensitive_patient_records"], subtaskHint: "retrieve the sensitive patient health record" },
  { vertical: "retail", appKey: "purchase", appName: "Super Banking Purchase Specialist Agent", name: "Purchase History Specialist", tools: ["sensitive_order_history"], note: "aliased by abercrombie-fitch", subtaskHint: "review the sensitive order / purchase history" },
  { vertical: "sporting-goods", appKey: "membership", appName: "Super Banking Membership Specialist Agent", name: "Membership Specialist", tools: ["sensitive_membership_details"], subtaskHint: "review the sensitive membership details" },
  { vertical: "workforce", appKey: "payroll", appName: "Super Banking Payroll Specialist Agent", name: "Payroll Specialist", tools: ["sensitive_payroll_details"], subtaskHint: "review the sensitive payroll details" },
  { vertical: "government", appKey: "tax", appName: "Super Banking Tax Records Specialist Agent", name: "Tax Records Specialist", tools: ["sensitive_tax_record"], subtaskHint: "retrieve the sensitive tax assessment record" },
  { vertical: "university", appKey: "finaid", appName: "Super Banking Financial Aid Specialist Agent", name: "Financial Aid Specialist", tools: ["sensitive_student_finance"], subtaskHint: "review the sensitive student financial aid record" },
  { vertical: "manufacturing", appKey: "supplier", appName: "Super Banking Supplier Contract Specialist Agent", name: "Supplier Contract Specialist", tools: ["sensitive_supplier_contract"], subtaskHint: "review the sensitive supplier contract terms" },
  { vertical: "investment", appKey: "holdings", appName: "Super Banking Holdings Specialist Agent", name: "Holdings Specialist", tools: ["sensitive_holdings"], subtaskHint: "review the sensitive investment holdings" },
  { vertical: "airlines", appKey: "passenger", appName: "Super Banking Passenger Records Specialist Agent", name: "Passenger Records Specialist", tools: ["sensitive_passenger_record"], subtaskHint: "retrieve the sensitive passenger record" },
  { vertical: "admin", appKey: "identity", appName: "Super Banking Identity Verification Specialist Agent", name: "Identity Verification Specialist", tools: ["sensitive_customer_identity"], subtaskHint: "retrieve the customer's identity-verification (KYC) record" },
];

function SpecialistsPanel() {
  return (
    <div className="aac-section-block">
      <h3>Vertical specialists (A2A)</h3>
      <p className="aac-card-sub">
        One specialist per vertical — the Agent 2 a generalist delegates a single
        sensitive read task to. Source: config/a2aSpecialists.js. Click a row for
        the full specialist detail.
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
            {SPECIALISTS.map((s) => (
              <ExpandableRow
                key={s.vertical}
                detail={s}
                cells={[
                  <th key="vertical" scope="row" className="aac-mono">{s.vertical}</th>,
                  <td key="name">
                    {s.name}
                    {s.note && <span className="aac-card-sub"> ({s.note})</span>}
                  </td>,
                  <td key="tools" className="aac-mono">{s.tools.join(", ")}</td>,
                ]}
              />
            ))}
          </tbody>
        </table>
      </div>
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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiClient
      .get("/api/registry/agents")
      .then(({ data }) => { if (!cancelled) setRegistry(data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [user]);

  const liveRows = registry?.rows || [];
  const showLive = !!user && !error && liveRows.length > 0;

  if (showLive) {
    const selected = liveRows.find((r) => r.id === selectedId) || liveRows[0];
    return (
      <div>
        <p className="aac-section-intro">
          Real non-human identities from PingOne, the demo's own OAuth client
          registry, and computed A2A Agent Cards. Select one to see its scopes
          and lifecycle. <span className="aac-badge aac-badge--live">Live</span>
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
              <div className="aac-card-sub">{r.identityType} · {r.source}</div>
              <div className="aac-card-body">
                <span className="aac-badge aac-badge--neutral">{r.status || "unknown"}</span>{" "}
                <ScopeStatusBadge status={r.scopeStatus} />
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <div className="aac-card aac-detail-panel">
            <div className="aac-card-title">{selected.name} — scopes &amp; lifecycle</div>
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

        <SpecialistsPanel />
      </div>
    );
  }

  const selected = AGENTS.find((a) => a.id === (selectedId || AGENTS[0].id));

  return (
    <div>
      <p className="aac-section-intro">
        Every runtime reaches the same 3 MCP servers — flat access, gated by policy
        rather than by agent identity. Select an agent to see its reachable tools.
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
            <div className="aac-card-sub">{a.runtime} · {a.framework}</div>
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
          <div className="aac-card-title">{selected.identity} — reachable MCP servers</div>
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

      <SpecialistsPanel />
    </div>
  );
}
