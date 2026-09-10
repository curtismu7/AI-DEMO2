import React from "react";

const OAUTH_MCP_TOOLS = [
  "get_my_accounts", "get_account_balance", "get_account_nickname", "get_sensitive_account_details",
  "get_my_transactions", "search_transactions", "get_transaction_detail", "create_deposit",
  "create_withdrawal", "create_transfer", "update_contact_email", "request_fee_waiver",
  "query_user_by_email", "lookup_customer", "get_customer_profile", "get_customer_accounts",
  "get_customer_transactions", "freeze_account", "reset_customer_password", "adjust_balance",
  "delete_customer", "get_branch_hours", "sequential_think", "list_account_types",
  "list_transaction_types", "list_verticals", "get_fee_schedule",
];

const RESOURCE_SERVER_TOOLS = [
  "list_banking_accounts", "get_banking_account", "get_investment_accounts", "get_investment_balance",
  "get_investment_portfolio_summary", "get_investment_transactions", "get_airline_bookings",
  "get_flight_status", "get_loyalty_status", "list_expenses", "get_expense", "submit_expense",
  "view_records", "get_patient_record", "list_orders", "checkout", "list_gear", "gear_order_status",
  "view_courses", "view_permits", "view_work_orders", "list_anf_orders",
];

const PRIVILEGE_SERVERS = [
  { name: "opensearch22", kind: "OpenSearch, native MCP", gateway: "cm-mcpgw", status: "LIVE" },
  { name: "mcp-brave-search", kind: "native MCP", gateway: "agentless-mcpgw", status: "LIVE" },
  { name: "mcp-grafana", kind: "native MCP", gateway: "agentless-mcpgw", status: "LIVE" },
  { name: "openapi2", kind: "OpenAPI MCP", gateway: "agentless-mcpgw", status: "BROKEN", note: "replaced by mcp-openapi-banking" },
  { name: "mcp-pingone", kind: "PingOne management API", gateway: "agentless-mcpgw", status: "PENDING", note: "PR #2913" },
];

const DEV_SERVERS = [
  { name: "jwt-verifier-mcp-server", kind: "JWT teaching tool" },
  { name: "demo_mcp_weather", kind: "third-party showcase" },
  { name: "demo_mcp_brave", kind: "third-party showcase" },
  { name: "demo_mcp_audit", kind: "PingOne admin audit log" },
  { name: "demo_mcp_code_search", kind: "Weaviate code search" },
];

function StatusBadge({ status }) {
  const map = { LIVE: "live", BROKEN: "broken", PENDING: "pending" };
  return <span className={`aac-badge aac-badge--${map[status] || "neutral"}`}>{status}</span>;
}

export default function ServersSection() {
  return (
    <div>
      <p className="aac-section-intro">
        "MCP servers" spans three tiers with very different reach: the 3 servers
        agents actually call, 5 registered in PingOne Privilege's Agentic Apps
        registry for non-agent use, and 5 dev/diagnostic servers wired into the
        MCP Inspector's Gateway Showcase tab only.
      </p>

      <div className="aac-section-block">
        <h3>Agent-facing (3)</h3>
        <div className="aac-grid-2">
          <div className="aac-card">
            <div className="aac-card-title">demo_mcp_gateway</div>
            <div className="aac-card-sub">Aggregator — the single endpoint every agent calls</div>
            <div className="aac-card-body">
              Injects its own routing/enforcement tools on top of what it aggregates
              from the two backends below.
            </div>
          </div>
          <div className="aac-card">
            <div className="aac-card-title">oauth-mcp <span className="aac-badge aac-badge--neutral">32 tools</span></div>
            <div className="aac-card-sub">banking-mcp-server</div>
            <div className="aac-chip-row">
              {OAUTH_MCP_TOOLS.map((t) => <span key={t} className="aac-chip">{t}</span>)}
              <span className="aac-chip">+5 vertical show_* handlers</span>
            </div>
          </div>
          <div className="aac-card">
            <div className="aac-card-title">demo_mcp_resource_server <span className="aac-badge aac-badge--neutral">22 tools</span></div>
            <div className="aac-card-sub">banking-mcp-resource-server</div>
            <div className="aac-chip-row">
              {RESOURCE_SERVER_TOOLS.map((t) => <span key={t} className="aac-chip">{t}</span>)}
            </div>
          </div>
        </div>
      </div>

      <div className="aac-section-block">
        <h3>Privilege-registered / admin — NOT agent-facing (5)</h3>
        <div className="aac-table-wrap">
          <table className="aac-table">
            <thead>
              <tr>
                <th scope="col">Server</th>
                <th scope="col">Kind</th>
                <th scope="col">Gateway</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {PRIVILEGE_SERVERS.map((s) => (
                <tr key={s.name}>
                  <th scope="row" className="aac-mono">{s.name}</th>
                  <td>{s.kind}</td>
                  <td className="aac-mono">{s.gateway}</td>
                  <td>
                    <StatusBadge status={s.status} />
                    {s.note && <span className="aac-card-sub"> {s.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="aac-section-block">
        <h3>Dev &amp; diagnostic — NOT agent-facing (5)</h3>
        <p className="aac-card-sub">Wired into the MCP Inspector's Gateway Showcase tab.</p>
        <div className="aac-grid-3">
          {DEV_SERVERS.map((s) => (
            <div key={s.name} className="aac-card">
              <div className="aac-card-title aac-mono">{s.name}</div>
              <div className="aac-card-sub">{s.kind}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
