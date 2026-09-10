import React, { useState } from "react";

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

export default function AgentsSection() {
  const [selectedId, setSelectedId] = useState(AGENTS[0].id);
  const selected = AGENTS.find((a) => a.id === selectedId);

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
            className={`aac-card aac-agent-card${a.id === selectedId ? " aac-agent-card--active" : ""}`}
            onClick={() => setSelectedId(a.id)}
            aria-pressed={a.id === selectedId}
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
    </div>
  );
}
