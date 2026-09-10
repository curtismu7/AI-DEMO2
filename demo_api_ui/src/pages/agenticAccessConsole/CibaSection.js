import React, { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";

const AGENTIC_APPS = [
  { name: "opensearch22", kind: "OpenSearch, native MCP", frontend: "opensearch.default.applications.procyon.ai:8643/mcp", gateway: "cm-mcpgw", status: "LIVE" },
  { name: "mcp-brave-search", kind: "native MCP", frontend: "—", gateway: "agentless-mcpgw", status: "LIVE" },
  { name: "mcp-grafana", kind: "native MCP", frontend: "mcpgw.ai-demo.ping-devops.com/mcp-grafana/mcp", gateway: "agentless-mcpgw", status: "LIVE" },
  { name: "openapi2", kind: "OpenAPI MCP", frontend: "—", gateway: "agentless-mcpgw", status: "BROKEN", note: "→ mcp-openapi-banking" },
  { name: "mcp-pingone", kind: "PingOne management API", frontend: "—", gateway: "agentless-mcpgw", status: "PENDING", note: "PR #2913" },
];

const AGENT_CARD_EXAMPLE = `{
  "url": "https://api.ping.demo:3001/a2a/specialists/investment",
  "authentication": { "schemes": ["PingOne Bearer"] },
  "skills": [
    { "id": "get_investment_portfolio_summary", "tags": ["investment", "a2a"] }
  ]
}`;

const CIBA_APPROVALS = [
  { agent: "BankingAssistant", action: "create_transfer $4,200", message: "Approve $4,200 transfer to Alex R.?", status: "APPROVED", approver: "self" },
  { agent: "Banking Agent", action: "create_transfer $12,500", message: "exceeds standing limit", status: "PENDING", approver: "manager (delegationService)" },
  { agent: "langchain_agent", action: "create_withdrawal $900", message: "Approve $900 withdrawal?", status: "DENIED", approver: "self" },
];

function AppStatusBadge({ status }) {
  const map = { LIVE: "live", BROKEN: "broken", PENDING: "pending" };
  return <span className={`aac-badge aac-badge--${map[status] || "neutral"}`}>{status}</span>;
}

function ApprovalStatusPill({ status }) {
  const map = { APPROVED: "permit", DENIED: "deny", PENDING: "indeterminate" };
  return <span className={`aac-pill aac-pill--${map[status] || "indeterminate"}`}>{status}</span>;
}

const LIVE_STATUS_MAP = { approved: "permit", denied: "deny", pending: "indeterminate", expired: "deny" };

export default function CibaSection({ user }) {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [initiateError, setInitiateError] = useState(null);

  const fetchRequests = () => {
    setError(false);
    return apiClient
      .get("/api/auth/ciba/requests")
      .then(({ data }) => setRequests(data.requests || []))
      .catch(() => setError(true));
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchRequests().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleTryIt = () => {
    setInitiating(true);
    setInitiateError(null);
    apiClient
      .post("/api/auth/ciba/initiate", {
        amount: 500,
        from_account_label: "Checking ••1234",
        to_account_label: "Alex R.",
        binding_message: "Agentic Access Console demo request",
      })
      .then(() => fetchRequests())
      .catch((err) => {
        setInitiateError(err?.response?.data?.message || err?.response?.data?.error || err.message || "Request failed");
      })
      .finally(() => setInitiating(false));
  };

  const showLive = !!user && !error && Array.isArray(requests);

  return (
    <div>
      <p className="aac-section-intro">
        This tab also covers PingOne Privilege's Agentic Apps registry and the A2A
        protocol, alongside CIBA step-up approvals proper — three distinct
        mechanisms that all sit under "agent-to-agent / human-in-the-loop" control.
      </p>

      <div className="aac-section-block">
        <h3>Agentic Apps</h3>
        <p className="aac-card-sub" style={{ marginBottom: 8 }}>
          Source: pingone-privgateway-helm
        </p>
        <div className="aac-table-wrap">
          <table className="aac-table">
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Kind</th>
                <th scope="col">Frontend</th>
                <th scope="col">Gateway</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {AGENTIC_APPS.map((a) => (
                <tr key={a.name}>
                  <th scope="row" className="aac-mono">{a.name}</th>
                  <td>{a.kind}</td>
                  <td className="aac-mono">{a.frontend}</td>
                  <td className="aac-mono">{a.gateway}</td>
                  <td>
                    <AppStatusBadge status={a.status} />
                    {a.note && <span className="aac-card-sub"> {a.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="aac-card-sub" style={{ marginTop: 8 }}>Illustrative — needs an operator connect step this public page can't perform.</p>
      </div>

      <div className="aac-section-block">
        <h3>A2A protocol — agent cards</h3>
        <p className="aac-card-sub" style={{ marginBottom: 8 }}>
          Agent2Agent (Linux Foundation v1.0) cards via <code>a2aAgentCardService.js</code>,
          PingOne Bearer auth.
        </p>
        <pre className="aac-prompt-block">{AGENT_CARD_EXAMPLE}</pre>
        <p className="aac-card-body" style={{ marginTop: 10 }}>
          Banking Assistant (Agent 1, generalist) delegates (scope <code>invest:read</code>)
          to Investment Advisor (Agent 2, specialist).
        </p>
        <div className="aac-chip-row">
          <span className="aac-badge aac-badge--neutral">UC2 — base nested-act chain</span>
          <span className="aac-badge aac-badge--neutral">UC2.5 — same flow, audit-trail framing</span>
          <span className="aac-badge aac-badge--broken">UC2.6 — negative test: rogue agent credential riding a legitimate delegation shape is still DENIED</span>
        </div>
        <p className="aac-card-sub" style={{ marginTop: 8 }}>Illustrative.</p>
      </div>

      <div className="aac-section-block">
        <h3>CIBA step-up approvals {showLive && <span className="aac-badge aac-badge--live">Live</span>}</h3>
        <p className="aac-card-sub" style={{ marginBottom: 8 }}>
          Source: <code>demo_api_server/routes/ciba.js</code> — independent of the
          Agentic Apps registry above.
        </p>
        {user && (
          <>
            <button type="button" className="aac-filter-btn" style={{ marginBottom: 10 }} onClick={handleTryIt} disabled={initiating}>
              {initiating ? "Initiating…" : "Try it live — initiate a real CIBA request"}
            </button>
            {initiateError && (
              <p className="aac-card-sub" style={{ marginBottom: 10, color: "var(--th-status-error-text)" }}>
                {initiateError}
              </p>
            )}
          </>
        )}
        {showLive ? (
          requests.length > 0 ? (
            <div className="aac-table-wrap">
              <table className="aac-table">
                <thead>
                  <tr>
                    <th scope="col">Auth req</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Message</th>
                    <th scope="col">Status</th>
                    <th scope="col">Engine</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.authReqId}>
                      <th scope="row" className="aac-mono">{r.authReqId.slice(0, 8)}…</th>
                      <td>{r.amount != null ? `$${r.amount}` : "—"}</td>
                      <td>{r.bindingMessage || r.tool || "—"}</td>
                      <td><span className={`aac-pill aac-pill--${LIVE_STATUS_MAP[r.status] || "indeterminate"}`}>{r.status.toUpperCase()}</span></td>
                      <td>{r.engine}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="aac-card"><div className="aac-card-body">No CIBA requests tracked in this session yet — use "Try it live" above to create a real one.</div></div>
          )
        ) : (
          <>
            <div className="aac-table-wrap">
              <table className="aac-table">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col">Action</th>
                    <th scope="col">Message</th>
                    <th scope="col">Status</th>
                    <th scope="col">Approver</th>
                  </tr>
                </thead>
                <tbody>
                  {CIBA_APPROVALS.map((c, i) => (
                    <tr key={i}>
                      <th scope="row">{c.agent}</th>
                      <td>{c.action}</td>
                      <td>{c.message}</td>
                      <td><ApprovalStatusPill status={c.status} /></td>
                      <td>{c.approver}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="aac-card-sub" style={{ marginTop: 8 }}>
              {!user ? "Sign in to see live data." : "Live CIBA request data unavailable — showing an illustrative example."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
