import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
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
        credentials: "include",
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
  // Default ON: real PingOne Authorize is the intended demo path. RAR amount
  // enforcement is done gateway-side (Demo Agent Gateway requireRarIntent, pinned
  // in #603), independent of this toggle — so PERMIT ($80) / DENY ($500) hold in
  // live mode; the toggle only switches the authorize-decision card between real
  // PingOne and the simulated engine.
  const [live, setLive] = useState(true);
  const navigate = useNavigate();
  const permitCol = useColumnRun("permit", 80);
  const driftCol = useColumnRun("drift", 500);
  const edu = useEducationUIOptional();

  return (
    <div className="intent-binding-page">
      <button className="ib-back-btn" onClick={() => navigate("/dashboard")}>
        Back to Dashboard
      </button>
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

      <div id="rar">
        <div className="ib-flow-diagram">
          <strong>RAR flow through the system:</strong>
          <svg viewBox="0 0 900 200" className="ib-flow-svg">
            <rect x="20" y="40" width="120" height="60" rx="4" fill="#e3f2fd" stroke="#1976d2" strokeWidth="2" />
            <text x="80" y="75" textAnchor="middle" fontSize="14" fontWeight="500">User Declares</text>
            <text x="80" y="92" textAnchor="middle" fontSize="12">Intent: $100</text>

            <path d="M 140 70 L 170 70" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)" />

            <rect x="170" y="40" width="140" height="60" rx="4" fill="#f3e5f5" stroke="#7b1fa2" strokeWidth="2" />
            <text x="240" y="63" textAnchor="middle" fontSize="12" fontWeight="500">RAR Grant Created</text>
            <text x="240" y="80" textAnchor="middle" fontSize="11">authorization_details</text>
            <text x="240" y="95" textAnchor="middle" fontSize="10" fill="#666">(amount: 100)</text>

            <path d="M 310 70 L 340 70" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)" />

            <rect x="340" y="40" width="120" height="60" rx="4" fill="#fff3e0" stroke="#f57c00" strokeWidth="2" />
            <text x="400" y="75" textAnchor="middle" fontSize="14" fontWeight="500">Agent Token</text>
            <text x="400" y="92" textAnchor="middle" fontSize="11">+ RAR Grant</text>

            <path d="M 460 70 L 490 70" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)" />

            <rect x="490" y="40" width="140" height="60" rx="4" fill="#e8f5e9" stroke="#388e3c" strokeWidth="2" />
            <text x="560" y="63" textAnchor="middle" fontSize="12" fontWeight="500">Transfer Request</text>
            <text x="560" y="80" textAnchor="middle" fontSize="11">create_transfer($80)</text>
            <text x="560" y="95" textAnchor="middle" fontSize="10" fill="#666">(via MCP Gateway)</text>

            <path d="M 630 70 L 660 70" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)" />

            <rect x="660" y="30" width="160" height="80" rx="4" fill="#fce4ec" stroke="#c2185b" strokeWidth="2" />
            <text x="740" y="50" textAnchor="middle" fontSize="12" fontWeight="500">PingOne Authorize</text>
            <text x="740" y="67" textAnchor="middle" fontSize="11">Compares requested</text>
            <text x="740" y="84" textAnchor="middle" fontSize="11">amount vs. grant cap</text>
            <text x="740" y="101" textAnchor="middle" fontSize="10" fill="#c2185b" fontWeight="500">→ PERMIT/DENY</text>

            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="#666" />
              </marker>
            </defs>
          </svg>
        </div>

        <div className="ib-split">
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

      <button className="ib-back-btn ib-back-btn--bottom" onClick={() => navigate("/dashboard")}>
        Back to Dashboard
      </button>
    </div>
  );
}
