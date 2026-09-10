import React, { useState } from "react";

const POLICY_RULES = [
  { rule: "Deny Large Transactions", condition: "amount > $2,000", outcome: "DENY" },
  { rule: "Require Step-Up MFA for High-Value Transfers", condition: "amount > $500 AND transfer/withdrawal AND acr ≠ Multi_Factor", outcome: "PERMIT + step-up HTTP 428" },
  { rule: "Require Consent for Mid-Value Transactions", condition: "amount > $250", outcome: "PERMIT + consent" },
  { rule: "Permit Standard Transactions", condition: "amount ≤ $500, or deposit, or MFA satisfied", outcome: "PERMIT" },
  { rule: "Deny RAR Amount Overage", condition: "RAR grant present AND amount > RarMaxAmount", outcome: "DENY" },
  { rule: "MCP Deny — Tier Amount Exceeded", condition: "Standard tier AND amount > $2,000", outcome: "DENY" },
  { rule: "MCP Deny — Tier Tool Not Allowed", condition: "Standard tier calls a PrivateBanking-only tool", outcome: "DENY" },
  { rule: "MCP Deny — Admin Role Not Permitted", condition: "admin role invokes a customer write tool", outcome: "DENY" },
  { rule: "MCP Deny — Invalid Actor Chain", condition: "act chain doesn't match the expected delegation shape", outcome: "DENY" },
  { rule: "Intent Deny — Amount Drift", condition: "intent-bound amount differs from the call", outcome: "DENY" },
  { rule: "Deny Unattended Agent Without a Mandate", condition: "autonomous transfer, no declared ceiling", outcome: "DENY" },
  { rule: "Require CIBA Approval Over the Standing Mandate", condition: "transfer exceeds the agent's declared ceiling", outcome: "PERMIT + CIBA" },
];

const DECISION_LOG = [
  { time: "14:02:11", agent: "openai_agent", tool: "create_transfer", scope: "transfer", decision: "PERMIT" },
  { time: "14:01:47", agent: "mastra_agent", tool: "create_transfer", scope: "transfer", decision: "INDETERMINATE" },
  { time: "13:58:03", agent: "langchain_agent", tool: "delete_customer", scope: "admin:delete", decision: "DENY" },
  { time: "13:55:22", agent: "pydantic_agent", tool: "get_sensitive_account_details", scope: "sensitive:read", decision: "PERMIT" },
  { time: "13:50:09", agent: "openai_agent", tool: "freeze_account", scope: "admin:write", decision: "DENY" },
  { time: "13:47:31", agent: "openai_agent", tool: "create_withdrawal", scope: "transfer", decision: "PERMIT" },
  { time: "13:44:58", agent: "mastra_agent", tool: "adjust_balance", scope: "admin:write", decision: "DENY" },
];

const FILTERS = ["All", "Permit", "Deny", "Indeterminate"];

function DecisionPill({ decision }) {
  return <span className={`aac-pill aac-pill--${decision.toLowerCase()}`}>{decision}</span>;
}

export default function PoliciesSection() {
  const [filter, setFilter] = useState("All");
  const visible = filter === "All"
    ? DECISION_LOG
    : DECISION_LOG.filter((d) => d.decision.toLowerCase() === filter.toLowerCase());

  return (
    <div>
      <p className="aac-section-intro">
        PingOne Authorize returns PERMIT or DENY, optionally with obligations
        (step-up, consent, CIBA). <code>demo_mcp_gateway</code> maps an unsatisfied
        obligation to INDETERMINATE. Source: <code>AI_Demo_Transaction_Authorization_P1AZ.snapshot.json</code>,
        62 rules, deny-overrides combining algorithm — any DENY wins.
      </p>

      <div className="aac-section-block">
        <h3>Policy rules (12 of 62 shown)</h3>
        <div className="aac-table-wrap">
          <table className="aac-table">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Condition</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {POLICY_RULES.map((r) => (
                <tr key={r.rule}>
                  <th scope="row">{r.rule}</th>
                  <td>{r.condition}</td>
                  <td>{r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="aac-card-sub" style={{ marginTop: 8 }}>
          +50 more rules — token integrity, intent-binding, per-scope step-up/consent
          from scope-topology.json.
        </p>
      </div>

      <div className="aac-section-block">
        <h3>Decision log</h3>
        <div className="aac-filter-bar">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`aac-filter-btn${filter === f ? " aac-filter-btn--active" : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {f}
            </button>
          ))}
        </div>
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
              {visible.map((d, i) => (
                <tr key={i}>
                  <td className="aac-mono">{d.time}</td>
                  <td>{d.agent}</td>
                  <td className="aac-mono">{d.tool}</td>
                  <td className="aac-mono">{d.scope}</td>
                  <td><DecisionPill decision={d.decision} /></td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={5} className="aac-card-sub">No decisions match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
