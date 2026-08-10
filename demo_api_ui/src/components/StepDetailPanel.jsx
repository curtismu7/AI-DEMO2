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

/** Parse a payload string as JSON, or null when it is display text. */
function parseClaims(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Claims whose value moved between the two tokens — added, removed or changed.
 *
 * Deliberately every key, not the `aud`/`scope` pair TraceStepCard's private
 * claimDiffs() checks: the point of this view is that `read` is struck through,
 * `act` appears, `aud` rebinds and `exp` shortens, and three of those four would
 * be invisible under that narrower rule. TraceStepCard is a protected renderer,
 * so its helper is not shared out.
 */
function changedClaims(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const moved = new Set();
  for (const k of keys) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) moved.add(k);
  }
  return moved;
}

function render(value) {
  if (value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Before and after side by side, with only the moved rows marked. */
function ClaimDiff({ beforeAfter }) {
  const before = parseClaims(beforeAfter.before?.text);
  const after = parseClaims(beforeAfter.after?.text);
  if (!before || !after) return null;

  const moved = changedClaims(before, after);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  const column = (title, claims, side) => (
    <div className="sdp-ba-col">
      <div className="sdp-ba-title">{title}</div>
      {keys.map((k) => (
        <div
          key={k}
          data-claim={k}
          className={`sdp-ba-row${moved.has(k) ? " sdp-ba-row--changed" : ""}${
            side === "before" && !(k in (after || {})) ? " sdp-ba-row--gone" : ""
          }`}
        >
          <span className="sdp-ba-k">{k}</span>
          <span className="sdp-ba-v">{render(claims?.[k])}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="sdp-ba">
      {column(beforeAfter.before?.title || "Before", before, "before")}
      {column(beforeAfter.after?.title || "After", after, "after")}
    </div>
  );
}

/** A collapsed payload — one click away for whoever asks, out of the way otherwise. */
function Payload({ label, title, text }) {
  return (
    <div className="sdp-payload">
      <div className="sdp-section-label">{label}</div>
      {title ? <div className="sdp-payload-title">{title}</div> : null}
      <pre className="sdp-pre">{text}</pre>
    </div>
  );
}

export default function StepDetailPanel({ step, onInspect }) {
  if (!step) return null;
  const d = step.detail || {};
  const kv = Array.isArray(d.kv) ? d.kv : [];
  const rfcs = Array.isArray(d.rfcs) ? d.rfcs : [];
  const diff = d.beforeAfter ? <ClaimDiff beforeAfter={d.beforeAfter} /> : null;
  const hasChange = Boolean(diff) || kv.length > 0;
  // "done" and the error states are hops that executed; "pending"/"notinpath" are not.
  const ran = ["done", "active", "denied", "error"].includes(step.status);

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

      {hasChange ? (
        <Section label="What changed">
          {diff}
          {kv.length > 0 ? (
            <dl className="sdp-kv">
              {kv.map(([k, v]) => (
                <div className="sdp-kv-row" key={k}>
                  <dt>{k}</dt>
                  <dd>{v && typeof v === "object" ? JSON.stringify(v, null, 2) : String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Section>
      ) : null}

      {/* Four of the sixteen hops are transport and lookup. Say so, rather than
          render a faked diff or an unexplained gap where a diff should be.
          Only for a hop that actually ran: a pending or not-in-path step has not
          changed nothing, it has not happened, and saying otherwise reads as a
          finding. */}
      {ran && !hasChange && !d.request?.text && !d.response?.text ? (
        <p className="sdp-nochange">Nothing changed — this hop carries the request without altering it.</p>
      ) : null}

      {d.request?.text ? (
        <Payload label="Request" title={d.request.title} text={d.request.text} />
      ) : null}

      {d.response?.text ? (
        <Payload label="Response" title={d.response.title} text={d.response.text} />
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
