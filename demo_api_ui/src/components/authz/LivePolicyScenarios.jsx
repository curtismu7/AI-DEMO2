import { useCallback, useState } from "react";
import apiClient from "../../services/apiClient";
import JsonField from "../shared/JsonField";
import "./LivePolicyScenarios.css";

/**
 * Live PingOne Authorize policy scenarios — runs the REAL provisioned
 * "Transaction Authorization" policy against the configured decision endpoint
 * via the force-live path (test-evaluate { live: true }), regardless of the
 * page's global engine toggle. Thresholds mirror the live policy:
 *   consent > $250 · step-up > $500 · deny > $2,000 · MFA (Acr) satisfies step-up.
 */
const TX_SCENARIOS = [
  { id: "permit", label: "Small transfer", amount: 100, type: "transfer", acr: "", expect: "PERMIT",
    desc: "$100 — below every threshold." },
  { id: "consent", label: "Consent required", amount: 300, type: "transfer", acr: "", expect: "PERMIT + consent",
    desc: "$300 — above the $250 consent threshold." },
  { id: "stepup", label: "Step-up required", amount: 600, type: "transfer", acr: "", expect: "PERMIT + step-up",
    desc: "$600 — above the $500 step-up threshold, no MFA." },
  { id: "stepup-mfa", label: "Step-up satisfied by MFA", amount: 600, type: "transfer", acr: "Multi_Factor", expect: "PERMIT",
    desc: "$600 with Multi_Factor ACR — MFA satisfies the step-up obligation." },
  { id: "deny", label: "Denied", amount: 2500, type: "transfer", acr: "", expect: "DENY",
    desc: "$2,500 — above the $2,000 hard-deny threshold." },
];

const BADGE = { PERMIT: "authz-badge authz-badge--permit", DENY: "authz-badge authz-badge--deny", INDETERMINATE: "authz-badge authz-badge--indeterminate" };

function ResultRow({ result }) {
  if (!result) return null;
  if (result.error) return <div className="lps-error">{result.error}</div>;
  const dec = result.decision || "INDETERMINATE";
  return (
    <div className="lps-result">
      <span className={BADGE[dec] || "authz-badge"}>{dec}</span>
      <span className="lps-engine">engine: {result.engine}</span>
      {result.stepUpRequired ? <span className="lps-flag lps-flag--stepup">step-up</span> : null}
      {result.consentRequired ? <span className="lps-flag lps-flag--consent">consent</span> : null}
      <JsonField label="Raw decision" value={{ raw: result.raw, pingoneRequest: result.pingoneRequest, pingoneResponse: result.pingoneResponse }} />
    </div>
  );
}

export default function LivePolicyScenarios({ configured }) {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState({});

  const runOne = useCallback(async (s) => {
    setRunning((r) => ({ ...r, [s.id]: true }));
    try {
      const { data } = await apiClient.post("/api/authorize/test-evaluate", {
        amount: s.amount, type: s.type, ...(s.acr ? { acr: s.acr } : {}), live: true,
      });
      setResults((r) => ({ ...r, [s.id]: data }));
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Live evaluation failed";
      setResults((r) => ({ ...r, [s.id]: { error: msg } }));
    } finally {
      setRunning((r) => ({ ...r, [s.id]: false }));
    }
  }, []);

  return (
    <div className="live-policy-scenarios">
      <div className="lps-header">
        <div>
          <h3 className="lps-title">Live PingOne Authorize — Transaction Authorization policy</h3>
          <p className="lps-sub">Runs the real provisioned policy against the configured decision endpoint (force-live). Thresholds: consent &gt; $250 · step-up &gt; $500 · deny &gt; $2,000.</p>
        </div>
      </div>
      {!configured ? (
        <div className="lps-notice">PingOne Authorize isn’t configured yet. Set a worker app + decision endpoint in Engine Settings (or configure <code>PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID</code>) to run these live.</div>
      ) : null}
      <div className="lps-grid">
        {TX_SCENARIOS.map((s) => (
          <div className="lps-card" key={s.id}>
            <div className="lps-card-head">
              <span className="lps-card-label">{s.label}</span>
              <span className="lps-expect">expect: {s.expect}</span>
            </div>
            <p className="lps-card-desc">{s.desc}</p>
            <div className="lps-card-meta">
              <span>Amount: <b>${s.amount.toLocaleString()}</b></span>
              <span>Type: <b>{s.type}</b></span>
              {s.acr ? <span>ACR: <b>{s.acr}</b></span> : null}
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => runOne(s)} disabled={!configured || running[s.id]}>
              {running[s.id] ? "Evaluating…" : "Run live"}
            </button>
            <ResultRow result={results[s.id]} />
          </div>
        ))}
      </div>
    </div>
  );
}
