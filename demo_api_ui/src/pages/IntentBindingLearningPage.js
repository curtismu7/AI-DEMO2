import React, { useState } from "react";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { EDU } from "../components/education/educationIds";
import "./IntentBindingLearningPage.css";

/**
 * New standalone Intent Binding learning page. This plan implements only the
 * RAR (RFC 9396) section; AP2, OAuth Transaction Tokens draft, and RFC 8693
 * Token Exchange sections are added by later plans. Layout matches the
 * user-approved "B+C combined" mockup: static pipeline header, then a
 * permanent PERMIT | DRIFT split so both outcomes are visible at once.
 */
const GRANT = { type: "banking_transaction", tool: "create_transfer", amount: 100, payee: "acme-utilities" };

const PIPELINE_STEPS = [
  { num: 1, title: "Declare intent", detail: "Customer authorizes: pay Acme Utilities, up to $100." },
  { num: 2, title: "Build RAR grant", detail: "authorization_details attached to the agent's token via RFC 9396." },
  { num: 3, title: "Agent requests transfer", detail: "MCP gateway receives the actual create_transfer call." },
  { num: 4, title: "Gateway + P1AZ check", detail: "Requested amount compared against the grant's cap." },
];

function useColumnRun(action, defaultAmount) {
  const [amount, setAmount] = useState(defaultAmount);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async (live) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/demo/intent-binding/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestedAmount: Number(amount), live }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.reason || data.error || "Request failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { amount, setAmount, loading, result, error, run };
}

function IntentBindingColumn({ kind, title, outcomeLabel, rationale, col, live }) {
  return (
    <div className={`ib-col ib-col--${kind}`}>
      <div className="ib-col-head">
        <h2>{title}</h2>
        <span className={`ib-pill ib-pill--${kind}`}>{outcomeLabel}</span>
      </div>
      <div className="ib-amount">
        <small>Requested</small>${col.amount}
      </div>
      <p className="ib-rationale">{rationale}</p>
      <div className="ib-controls">
        <label>
          Amount
          <input type="number" value={col.amount} onChange={(e) => col.setAmount(e.target.value)} min={1} />
        </label>
        <button aria-label={`Run ${kind}`} onClick={() => col.run(live)} disabled={col.loading}>
          {col.loading ? "Running…" : "Run"}
        </button>
      </div>
      {col.error ? <div className="ib-status ib-status--error">{col.error}</div> : null}
      {col.result ? (
        <div className={`ib-status ib-status--${col.result.status === 200 ? "permit" : "deny"}`}>
          <strong>{col.result.status === 200 ? "PERMIT" : `DENY (${col.result.errorCode})`}</strong>
          <ul>
            {(col.result.tokenChainEvents || []).map((ev) => (
              <li key={ev.id}>
                <strong>{ev.label}</strong> — {ev.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function IntentBindingLearningPage() {
  const [live, setLive] = useState(false);
  const permitCol = useColumnRun("permit", 80);
  const driftCol = useColumnRun("drift", 500);
  const edu = useEducationUIOptional();

  return (
    <div className="intent-binding-page">
      <header className="ib-header-band">
        <div className="ib-eyebrow">Learning · Intent Binding</div>
        <h1>Watch an agent's intent get checked, step by step</h1>
        <p>
          Every transfer an agent makes runs this pipeline. The same RFC 9396 Rich Authorization
          Request grant is compared below against two requests — one within the agent's declared
          authority, one past it.
        </p>
      </header>

      <ol className="ib-pipeline">
        {PIPELINE_STEPS.map((step) => (
          <li key={step.num} className="ib-step">
            <div className="ib-step-num">Step {step.num}</div>
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>

      <div className="ib-grant-card">
        <strong>Grant on the agent&apos;s token (RFC 9396 authorization_details):</strong>
        <pre className="ib-grant-json">{JSON.stringify(GRANT, null, 2)}</pre>
      </div>

      <div id="rar" className="ib-split">
        <IntentBindingColumn
          kind="permit"
          title="Within the grant"
          outcomeLabel="Permit"
          rationale={`$${permitCol.amount} is within the $${GRANT.amount} cap. Steps 3-4 complete and the gateway confirms the request matches the declared intent.`}
          col={permitCol}
          live={live}
        />
        <IntentBindingColumn
          kind="drift"
          title="Drifts past the grant"
          outcomeLabel="Deny"
          rationale={`$${driftCol.amount} exceeds the $${GRANT.amount} cap. Step 4 stops the chain — the transfer never reaches the account.`}
          col={driftCol}
          live={live}
        />
      </div>

      <div className="ib-live-toggle">
        <label>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live mode — route this decision through real PingOne Authorize instead of the simulated engine
        </label>
      </div>

      <p className="ib-edu-link">
        For deeper RFC background, see the{" "}
        <button type="button" className="ib-link-btn" onClick={() => edu && edu.open(EDU.RAR, "what")}>
          RAR education panel
        </button>.
      </p>
    </div>
  );
}
