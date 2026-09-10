import React from "react";

// Illustrative snapshot of the demo's agent → MCP-tool access surface. Static
// on purpose — see the "Agentic Access Console" TECH_DEBT.md entry.
const COVERAGE_BY_RUNTIME = [
  { runtime: "langchain_agent", framework: "LangGraph", servers: 3, tools: 54 },
  { runtime: "openai_agent", framework: "OpenAI Agents SDK", servers: 3, tools: 54 },
  { runtime: "pydantic_agent", framework: "Pydantic AI", servers: 3, tools: 54 },
  { runtime: "mastra_agent", framework: "Mastra", servers: 3, tools: 54 },
];

const COVERAGE_BY_VERTICAL = [
  { vertical: "Meridian Wealth", domain: "investment", tools: 4 },
  { vertical: "United Airlines", domain: "airline", tools: 3 },
  { vertical: "Super Sports", domain: "gear", tools: 3 },
  { vertical: "CareConnect", domain: "records", tools: 2 },
  { vertical: "Precision Works", domain: "work orders", tools: 1 },
];

const RECENT_DECISIONS = [
  { time: "14:02:11", agent: "openai_agent", tool: "create_transfer", scope: "transfer", decision: "PERMIT" },
  { time: "14:01:47", agent: "mastra_agent", tool: "create_transfer", scope: "transfer", decision: "INDETERMINATE" },
  { time: "13:58:03", agent: "langchain_agent", tool: "delete_customer", scope: "admin:delete", decision: "DENY" },
  { time: "13:55:22", agent: "pydantic_agent", tool: "get_sensitive_account_details", scope: "sensitive:read", decision: "PERMIT" },
  { time: "13:50:09", agent: "openai_agent", tool: "freeze_account", scope: "admin:write", decision: "DENY" },
];

function DecisionPill({ decision }) {
  const cls = decision.toLowerCase();
  return <span className={`aac-pill aac-pill--${cls}`}>{decision}</span>;
}

export default function DashboardSection() {
  return (
    <div>
      <p className="aac-section-intro">
        Four agent runtimes call one endpoint, <code>demo_mcp_gateway</code>, which
        aggregates <code>tools/list</code> from two backends and enforces PingOne
        Authorize policy plus HITL on every call. Access is flat — every runtime
        reaches the same 3 servers and 54 tools; what differs per call is the
        policy decision, not the wiring.
      </p>

      <div className="aac-stat-grid">
        <div className="aac-stat-tile">
          <div className="aac-stat-value">4</div>
          <div className="aac-stat-label">Agent runtimes</div>
          <div className="aac-stat-detail">+ 11 per-vertical A2A specialists — see Agents tab</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value">3</div>
          <div className="aac-stat-label">MCP servers</div>
          <div className="aac-stat-detail">gateway + oauth-mcp + resource-server</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value">54</div>
          <div className="aac-stat-label">MCP tools</div>
          <div className="aac-stat-detail">32 oauth-mcp, 22 resource-server</div>
        </div>
        <div className="aac-stat-tile">
          <div className="aac-stat-value">1,842</div>
          <div className="aac-stat-label">Authz decisions (24h)</div>
          <div className="aac-stat-detail">1,791 permit · 39 deny · 12 → HITL</div>
        </div>
      </div>

      <div className="aac-section-block">
        <h3>Coverage by runtime</h3>
        <p className="aac-card-sub" style={{ marginBottom: 10 }}>
          All four runtimes see the same 3 servers / 54 tools — access is uniform,
          gated by policy at call time, not scoped per agent.
        </p>
        <div className="aac-table-wrap">
          <table className="aac-table">
            <thead>
              <tr>
                <th scope="col">Runtime</th>
                <th scope="col">Framework</th>
                <th scope="col">MCP servers</th>
                <th scope="col">Tools reachable</th>
              </tr>
            </thead>
            <tbody>
              {COVERAGE_BY_RUNTIME.map((r) => (
                <tr key={r.runtime}>
                  <th scope="row" className="aac-mono">{r.runtime}</th>
                  <td>{r.framework}</td>
                  <td>{r.servers}</td>
                  <td>{r.tools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="aac-section-block">
        <h3>Coverage by vertical</h3>
        <div className="aac-table-wrap">
          <table className="aac-table">
            <thead>
              <tr>
                <th scope="col">Vertical</th>
                <th scope="col">Domain</th>
                <th scope="col">Tools</th>
              </tr>
            </thead>
            <tbody>
              {COVERAGE_BY_VERTICAL.map((v) => (
                <tr key={v.vertical}>
                  <th scope="row">{v.vertical}</th>
                  <td>{v.domain}</td>
                  <td>{v.tools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="aac-card-sub" style={{ marginTop: 8 }}>+7 more verticals</p>
      </div>

      <div className="aac-section-block">
        <h3>Recent authorization decisions</h3>
        <div className="aac-table-wrap">
          <table className="aac-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Agent</th>
                <th scope="col">Tool</th>
                <th scope="col">Scope</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_DECISIONS.map((d, i) => (
                <tr key={i}>
                  <td className="aac-mono">{d.time}</td>
                  <td>{d.agent}</td>
                  <td className="aac-mono">{d.tool}</td>
                  <td className="aac-mono">{d.scope}</td>
                  <td>
                    <DecisionPill decision={d.decision} />
                    {d.decision === "INDETERMINATE" && (
                      <span className="aac-card-sub"> → demo_hitl_service</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
