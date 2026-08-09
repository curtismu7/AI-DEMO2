// One step's full detail, ordered so the claim comes before the evidence:
// what happened, what changed, then the raw request and response. TraceStepCard
// renders the same data payload-first and collapsed; this is the presenter's
// view of it and is deliberately a separate component so that card is untouched.
import React from "react";
import "./StepDetailPanel.css";

const STATUS_TEXT = {
  done: "Completed",
  active: "In flight",
  pending: "Not yet run",
  notinpath: "Not in this path",
  denied: "Denied",
  error: "Error",
};

function Section({ label, children }) {
  return (
    <div className="sdp-section">
      <div className="sdp-section-label">{label}</div>
      {children}
    </div>
  );
}

export default function StepDetailPanel({ step, onInspect }) {
  if (!step) return null;
  const d = step.detail || {};
  const kv = Array.isArray(d.kv) ? d.kv : [];
  const rfcs = Array.isArray(d.rfcs) ? d.rfcs : [];

  return (
    <div className="sdp">
      <div className="sdp-head">
        <h3 className="sdp-title">{step.title}</h3>
        <span className="sdp-lane">{step.lane}</span>
        <span className={`sdp-status sdp-status--${step.status || "pending"}`}>
          {STATUS_TEXT[step.status] || String(step.status || "")}
        </span>
      </div>

      {d.narrative ? (
        <Section label="What happened">
          <p className="sdp-narrative">{d.narrative}</p>
        </Section>
      ) : null}

      {kv.length > 0 ? (
        <Section label="What changed">
          <dl className="sdp-kv">
            {kv.map(([k, v]) => (
              <div className="sdp-kv-row" key={k}>
                <dt>{k}</dt>
                <dd>{v && typeof v === "object" ? JSON.stringify(v, null, 2) : String(v)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {d.request?.text ? (
        <Section label="Request">
          <pre className="sdp-pre">{d.request.text}</pre>
        </Section>
      ) : null}

      {d.response?.text ? (
        <Section label="Response">
          <pre className="sdp-pre">{d.response.text}</pre>
        </Section>
      ) : null}

      {rfcs.length > 0 ? (
        <div className="sdp-rfcs">
          {rfcs.map((r) => (
            <span className="sdp-rfc" key={typeof r === "string" ? r : r.label}>
              {typeof r === "string" ? r : r.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* d.inspectToken is a token type ("user" | "agent" | "mcp"), the same
          vocabulary TraceStepCard and TraceTokenSummary pass to onInspect. The
          rail resolves it against this run's token events; a step id would not
          resolve and would silently show canned claims. */}
      {typeof onInspect === "function" && d.inspectToken ? (
        <button type="button" className="sdp-inspect" onClick={() => onInspect(d.inspectToken)}>
          Inspect token claims
        </button>
      ) : null}
    </div>
  );
}
