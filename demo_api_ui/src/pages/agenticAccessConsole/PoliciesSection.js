import React, { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";

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

/** Flatten the PingOne policy tree (PolicySet > Policy > Rule) to its RULE leaves. */
function flattenRules(nodes, ancestry = []) {
  let out = [];
  for (const node of nodes || []) {
    const path = [...ancestry, node.name];
    if (node.kind === "RULE") {
      out.push({ id: node.id, name: node.name, path: path.slice(0, -1).join(" › ") || "—", outcome: node.effect || node.algorithm || "—" });
    }
    if (node.children?.length) out = out.concat(flattenRules(node.children, path));
  }
  return out;
}

export default function PoliciesSection({ user }) {
  const [filter, setFilter] = useState("All");

  const [rulesData, setRulesData] = useState(null); // { rules, note, source } | null=loading
  const [rulesError, setRulesError] = useState(false);

  const [decisions, setDecisions] = useState(null);
  const [decisionsState, setDecisionsState] = useState("idle"); // idle|loading|ok|not_configured|error

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/api/authorize/pingone-policies")
      .then(({ data }) => {
        if (cancelled) return;
        const flat = flattenRules(data.policies);
        setRulesData({ rules: flat, note: data.note || null, source: data.source || null });
      })
      .catch(() => { if (!cancelled) setRulesError(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setDecisionsState("loading");
    apiClient
      .get("/api/authorize/recent-decisions?limit=10")
      .then(({ data }) => {
        if (cancelled) return;
        setDecisions(data.decisions || []);
        setDecisionsState("ok");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.response?.status === 422) {
          setDecisionsState("not_configured");
        } else {
          setDecisionsState("error");
        }
      });
    return () => { cancelled = true; };
  }, [user]);

  const liveRules = !rulesError && rulesData?.rules?.length ? rulesData.rules : null;

  const visible = filter === "All"
    ? DECISION_LOG
    : DECISION_LOG.filter((d) => d.decision.toLowerCase() === filter.toLowerCase());

  return (
    <div>
      <p className="aac-section-intro">
        PingOne Authorize returns PERMIT or DENY, optionally with obligations
        (step-up, consent, CIBA). <code>demo_mcp_gateway</code> maps an unsatisfied
        obligation to INDETERMINATE.
      </p>

      <div className="aac-section-block">
        <h3>Policy rules <span className="aac-badge aac-badge--live">Live</span></h3>
        {liveRules ? (
          <>
            <p className="aac-card-sub" style={{ marginBottom: 10 }}>
              {rulesData.rules.length} rules from the live PingOne Authorize policy tree
              {rulesData.source === "snapshot" ? " (rendered from the repo import snapshot — see note below)" : ""}.
            </p>
            <div className="aac-table-wrap">
              <table className="aac-table">
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Policy path</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {liveRules.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.name}</th>
                      <td>{r.path}</td>
                      <td>{r.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rulesData.note && <p className="aac-card-sub" style={{ marginTop: 8 }}>{rulesData.note}</p>}
          </>
        ) : (
          <>
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
              {rulesError
                ? "Live PingOne Authorize policy tree unavailable — showing an illustrative example (12 of 62 rules)."
                : (rulesData?.note || "Loading live policy tree… showing an illustrative example (12 of 62 rules) meanwhile.")}
            </p>
          </>
        )}
      </div>

      <div className="aac-section-block">
        <h3>Decision log</h3>
        {user ? (
          <>
            {decisionsState === "ok" && decisions?.length > 0 && (
              <div className="aac-table-wrap">
                <table className="aac-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Decision</th>
                      <th scope="col">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisions.map((d, i) => (
                      <tr key={d.id || i}>
                        <td className="aac-mono">{d.createdAt || d.timestamp || "—"}</td>
                        <td><DecisionPill decision={String(d.decision || d.result?.decision || "UNKNOWN")} /></td>
                        <td>
                          <details>
                            <summary className="aac-card-sub" style={{ cursor: "pointer" }}>Raw</summary>
                            <pre className="aac-prompt-block">{JSON.stringify(d, null, 2)}</pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {decisionsState === "not_configured" && (
              <div className="aac-card"><div className="aac-card-body">PingOne Authorize worker credentials not configured in this environment.</div></div>
            )}
            {decisionsState === "error" && (
              <div className="aac-card"><div className="aac-card-body">Live decision log unavailable right now.</div></div>
            )}
            {decisionsState === "ok" && (!decisions || decisions.length === 0) && (
              <div className="aac-card"><div className="aac-card-body">No recorded decisions for the configured endpoint yet.</div></div>
            )}
            {decisionsState === "loading" && (
              <div className="aac-card"><div className="aac-card-body">Loading…</div></div>
            )}
          </>
        ) : (
          <>
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
                </tbody>
              </table>
            </div>
            <p className="aac-card-sub" style={{ marginTop: 8 }}>Sign in to see live data.</p>
          </>
        )}
      </div>
    </div>
  );
}
