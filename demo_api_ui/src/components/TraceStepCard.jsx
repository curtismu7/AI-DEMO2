// One pipeline step — a native <details> card. Dumb renderer over the neutral
// step.detail shape produced by buildTraceSteps; knows nothing about sources.
import React from "react";

const STATUS_ICON = { pending: "·", active: "⏳", done: "✓", error: "✗" };

export default function TraceStepCard({ step, onInspect, defaultOpen = false }) {
  const d = step.detail || {};
  return (
    <details className="tctr-step" data-status={step.status} open={defaultOpen}>
      <summary>
        <span className={`tctr-ic tctr-ic--${step.status}`}>{STATUS_ICON[step.status]}</span>
        <span className="tctr-step-title">{step.num}. {step.title}</span>
        <span className={`tctr-lane tctr-lane--${step.lane.toLowerCase()}`}>{step.lane}</span>
        <span className="tctr-step-chev" aria-hidden="true">▶</span>
      </summary>
      <div className="tctr-step-body">
        {d.narrative && <p className="tctr-narrative">{d.narrative}</p>}
        {d.request && (
          <>
            <h4>{d.request.title}</h4>
            <pre className="tctr-code">{d.request.text}</pre>
          </>
        )}
        {d.response && (
          <>
            <h4>{d.response.title}</h4>
            <pre className="tctr-code">{d.response.text}</pre>
          </>
        )}
        {d.decision && (
          <div className={`tctr-decision tctr-decision--${d.decision.outcome.toLowerCase()}`}>
            {d.decision.outcome === "PERMIT" ? "✓" : "✗"} {d.decision.label}
          </div>
        )}
        {d.scopeDiff && (
          <div className="tctr-scope-diff">
            {d.scopeDiff.before.map((s) => (
              <span key={`b-${s}`}
                className={d.scopeDiff.after.includes(s) ? "tctr-sc tctr-sc--kept" : "tctr-sc tctr-sc--gone"}>
                {s}
              </span>
            ))}
            <span className="tctr-sc-note">← scope after exchange: {d.scopeDiff.after.join(" ") || "(none)"}</span>
          </div>
        )}
        {Array.isArray(d.kv) && d.kv.length > 0 && (
          <div className="tctr-kv">
            {d.kv.map(([k, v]) => (
              <React.Fragment key={k}>
                <span className="tctr-kv-k">{k}</span>
                <span className="tctr-kv-v">{v}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        {Array.isArray(d.rfcs) && d.rfcs.map((r) => (
          <span key={r} className="tctr-rfc">{r}</span>
        ))}
        {d.inspectToken && (
          <button type="button" className="tctr-inspect"
            onClick={() => onInspect(d.inspectToken)}>
            → Inspect claims
          </button>
        )}
      </div>
    </details>
  );
}
