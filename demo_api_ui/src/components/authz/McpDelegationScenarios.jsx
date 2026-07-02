import { useCallback, useState } from "react";
import apiClient from "../../services/apiClient";
import JsonField from "../shared/JsonField";
import "./McpDelegationScenarios.css";

/**
 * Live PingOne Authorize — MCP Delegation Authorization policy scenarios.
 * Runs the REAL provisioned MCP policy against the configured decision endpoint
 * (POST /api/authorize/test-mcp-live). Each scenario starts from a fully-valid
 * parameter set and varies ONE attribute to trigger a specific policy rule.
 */
const BASE = {
  DecisionContext: "McpFirstTool",
  UserId: "user-1",
  ToolName: "banking_get_accounts",
  TokenAudience: "https://mcp.demo",
  McpResourceUri: "https://mcp.demo",
  ActClientId: "d3f8fead-b81d-46f9-bba5-051e493cea0e",
  NestedActClientId: "d3f8fead-b81d-46f9-bba5-051e493cea0e",
  UserTier: "PrivateBanking",
  RequiredGroup: "none",
  InRequiredGroup: true,
  Acr: "Multi_Factor",
  HitlApproved: true,
  Amount: 100,
};

const SCENARIOS = [
  { id: "valid", label: "Valid tool call", expect: "PERMIT", override: {},
    desc: "Matching audience, valid actor, known user, in-group — the happy path." },
  { id: "audience", label: "Invalid token audience", expect: "DENY", override: { TokenAudience: "https://attacker.example" },
    desc: "Token aud ≠ MCP resource URI → step-skipping / wrong-audience block." },
  { id: "user", label: "Missing user id", expect: "DENY", override: { UserId: "none" },
    desc: "No end-user identity in the delegation chain." },
  { id: "actor", label: "Invalid actor chain", expect: "DENY", override: { ActClientId: "00000000-0000-0000-0000-000000000000" },
    desc: "act client is not an approved agent → broken RFC 8693 chain." },
  { id: "group", label: "Not in required group", expect: "DENY", override: { RequiredGroup: "Advisors", InRequiredGroup: false },
    desc: "Tool requires a group the user isn't a member of." },
  { id: "consent", label: "Consent-gated tool", expect: "PERMIT + consent", override: { ToolName: "book_appointment", HitlApproved: false },
    desc: "Sensitive tool with no approval → PERMIT with a HITL consent obligation." },
];

const BADGE = { PERMIT: "authz-badge authz-badge--permit", DENY: "authz-badge authz-badge--deny", INDETERMINATE: "authz-badge authz-badge--indeterminate" };

function Result({ result }) {
  if (!result) return null;
  if (result.error) return <div className="mds-error">{result.error}</div>;
  const dec = result.decision || "INDETERMINATE";
  return (
    <div className="mds-result">
      <div className="mds-result-head">
        <span className={BADGE[dec] || "authz-badge"}>{dec}</span>
        {result.stepUpRequired ? <span className="mds-flag mds-flag--stepup">step-up</span> : null}
        {result.consentRequired ? <span className="mds-flag mds-flag--consent">consent</span> : null}
      </div>
      {(result.statements || []).length ? (
        <div className="mds-statements">
          {result.statements.map((s) => <code key={s} className="mds-stmt">{s}</code>)}
        </div>
      ) : null}
      <JsonField label="Raw decision" value={{ raw: result.raw, pingoneRequest: result.pingoneRequest, pingoneResponse: result.pingoneResponse }} />
    </div>
  );
}

export default function McpDelegationScenarios({ configured }) {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState({});

  const runOne = useCallback(async (s) => {
    setRunning((r) => ({ ...r, [s.id]: true }));
    try {
      const { data } = await apiClient.post("/api/authorize/test-mcp-live", {
        parameters: { ...BASE, ...s.override },
      });
      setResults((r) => ({ ...r, [s.id]: data }));
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Live MCP evaluation failed";
      setResults((r) => ({ ...r, [s.id]: { error: msg } }));
    } finally {
      setRunning((r) => ({ ...r, [s.id]: false }));
    }
  }, []);

  const runAll = useCallback(async () => {
    for (const s of SCENARIOS) {
      // eslint-disable-next-line no-await-in-loop
      await runOne(s);
    }
  }, [runOne]);

  return (
    <div className="mcp-delegation-scenarios">
      <div className="mds-header">
        <div>
          <h3 className="mds-title">Live PingOne Authorize — MCP Delegation Authorization policy</h3>
          <p className="mds-sub">Runs the real MCP tool-delegation policy live. Each card starts from a fully-valid request and breaks one control (audience, user, actor chain, group, consent).</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={runAll} disabled={!configured}>Run all live</button>
      </div>
      {!configured ? (
        <div className="mds-notice">PingOne Authorize isn’t configured yet — set a worker app + decision endpoint (or <code>PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID</code>) to run these live.</div>
      ) : null}
      <div className="mds-grid">
        {SCENARIOS.map((s) => (
          <div className="mds-card" key={s.id}>
            <div className="mds-card-head">
              <span className="mds-card-label">{s.label}</span>
              <span className="mds-expect">expect: {s.expect}</span>
            </div>
            <p className="mds-card-desc">{s.desc}</p>
            <button type="button" className="btn btn-secondary" onClick={() => runOne(s)} disabled={!configured || running[s.id]}>
              {running[s.id] ? "Evaluating…" : "Run live"}
            </button>
            <Result result={results[s.id]} />
          </div>
        ))}
      </div>
    </div>
  );
}
