// One pipeline step — a native <details> card. Dumb renderer over the neutral
// step.detail shape produced by buildTraceSteps; knows nothing about sources.
import React from "react";
import { tokenize, formatJson } from "./shared/JsonHighlight";
import "./shared/JsonHighlight.css";

const STATUS_ICON = { pending: "·", active: "…", done: "✓", error: "✗", notinpath: "–" };

/** Combined request+response size above which we push the learner to pop-out. */
export const EVIDENCE_POPOUT_CHARS = 1200;

// d.request.text / d.response.text are pre-formatted display strings (often a
// narrative prefix line + embedded JSON, not pure JSON) — tokenize() colors
// the JSON portions and leaves the rest as plain text, so it's safe to run
// over the whole string as-is rather than re-parsing it as a JSON value.
function HighlightedText({ text }) {
  return tokenize(text).map((t, i) => (
    <span key={i} className={t.critical ? `jh-${t.type} jh-critical` : `jh-${t.type}`}>{t.text}</span>
  ));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textToHtml(text) {
  if (text == null || text === "") return "";
  return tokenize(String(text))
    .map((t) => {
      const cls = t.critical ? `jh-${t.type} jh-critical` : `jh-${t.type}`;
      return `<span class="${cls}">${escapeHtml(t.text)}</span>`;
    })
    .join("");
}

/** Opens a standalone teaching window for one TraceRail step (L3 overflow). */
export function openStepTeachingWindow(step) {
  const d = step?.detail || {};
  const title = `${step?.num != null ? `${step.num}. ` : ""}${step?.title || "Step"}`;
  const whyHtml = d.why ? `<p class="why"><strong>Why this run:</strong> ${escapeHtml(d.why)}</p>` : "";
  const narrativeHtml = d.narrative
    ? `<p class="narrative"><strong>What this hop does:</strong> ${escapeHtml(d.narrative)}</p>`
    : "";
  const decisionHtml = d.decision
    ? `<div class="decision">Decision: ${escapeHtml(String(d.decision.outcome || ""))} — ${escapeHtml(String(d.decision.label || ""))}</div>`
    : "";
  const reqHtml = d.request
    ? `<h2>${escapeHtml(d.request.title || "Request")}</h2><pre class="pre">${textToHtml(d.request.text)}</pre>`
    : "";
  const resHtml = d.response
    ? `<h2>${escapeHtml(d.response.title || "Response")}</h2><pre class="pre">${textToHtml(d.response.text)}</pre>`
    : "";
  const altReqHtml = d.altRequest
    ? `<h2>${escapeHtml(d.altRequest.title || "Alt request")}</h2><pre class="pre">${textToHtml(d.altRequest.text)}</pre>`
    : "";
  const altResHtml = d.altResponse
    ? `<h2>${escapeHtml(d.altResponse.title || "Alt response")}</h2><pre class="pre">${textToHtml(d.altResponse.text)}</pre>`
    : "";
  const kvHtml = Array.isArray(d.kv) && d.kv.length
    ? `<h2>Proof</h2><table>${d.kv.map(([k, v]) =>
      `<tr><th>${escapeHtml(k)}</th><td><pre class="inline">${textToHtml(typeof v === "string" ? v : formatJson(v) || String(v))}</pre></td></tr>`).join("")}</table>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#fff;padding:18px}
  h1{font-size:1.05rem;margin-bottom:8px}
  h2{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin:14px 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
  .narrative,.why{margin:0 0 8px;color:#334155}
  .decision{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 10px;margin:8px 0;font-weight:600}
  .pre{background:#0f172a;color:#bae6fd;border-radius:8px;padding:12px;font:11px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:70vh;overflow:auto}
  .inline{margin:0;white-space:pre-wrap;word-break:break-word;font:11px ui-monospace,Menlo,monospace}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;color:#64748b;width:120px;vertical-align:top;padding:4px 8px 4px 0}
  td{padding:4px 0;vertical-align:top}
  .jh-key{color:#79c0ff}.jh-string{color:#7ee787}.jh-number{color:#ffa657}
  .jh-keyword{color:#d2a8ff;font-weight:600}.jh-punct{color:#8b949e}
  .jh-critical{color:#ff6b6b;font-weight:600}
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${narrativeHtml}${whyHtml}${decisionHtml}${kvHtml}${reqHtml}${resHtml}${altReqHtml}${altResHtml}
</body></html>`;

  const win = window.open(
    "",
    `tctr-step-${step?.id || "step"}-${Date.now()}`,
    "width=1100,height=920,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no",
  );
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}

function evidenceSize(d) {
  return (d?.request?.text?.length || 0) + (d?.response?.text?.length || 0)
    + (d?.altRequest?.text?.length || 0) + (d?.altResponse?.text?.length || 0);
}

/** True when the step has run-specific detail beyond the static narrative/RFCs. */
export function hasPopoutWorthyDetail(d) {
  if (!d) return false;
  if (d.request || d.response || d.altRequest || d.altResponse) return true;
  if (d.why) return true;
  if (d.decision) return true;
  if (Array.isArray(d.kv) && d.kv.length > 0) return true;
  if (d.scopeDiff) return true;
  return false;
}

export default function TraceStepCard({ step, onInspect, defaultOpen = false }) {
  const d = step.detail || {};
  const notInPath = step.status === "notinpath";
  const hasEvidence = Boolean(d.request || d.response || d.altRequest || d.altResponse);
  const largeEvidence = evidenceSize(d) > EVIDENCE_POPOUT_CHARS;
  const canPopOut = hasPopoutWorthyDetail(d);

  return (
    <details className="tctr-step" data-status={step.status} open={defaultOpen}>
      <summary>
        <span className={`tctr-ic tctr-ic--${step.status}`}>{STATUS_ICON[step.status]}</span>
        <span className={`tctr-step-title${notInPath ? " tctr-step-title--notinpath" : ""}`}>{step.num}. {step.title}</span>
        {notInPath
          ? <span className="tctr-lane tctr-lane--notinpath">Not in path</span>
          : <span className={`tctr-lane tctr-lane--${step.lane.toLowerCase()}`}>{step.lane}</span>}
        <span className="tctr-step-chev" aria-hidden="true">▶</span>
      </summary>
      <div className="tctr-step-body">
        {d.narrative && <p className="tctr-narrative">{d.narrative}</p>}
        {d.why && (
          <p className="tctr-why">
            <span className="tctr-why-lbl">Why this run:</span> {d.why}
          </p>
        )}
        {d.decision && (
          <div className={`tctr-decision tctr-decision--${String(d.decision.outcome || "").toLowerCase()}`}>
            {d.decision.outcome === "PERMIT" ? "✓"
              : String(d.decision.outcome || "").toUpperCase() === "INDETERMINATE" ? "⚠️"
              : "✗"}{" "}
            {d.decision.label}
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

        {hasEvidence && (
          <div className="tctr-evidence-inline">
            {largeEvidence ? (
              <p className="tctr-evidence-hint">Large payload — use Pop out for a bigger view.</p>
            ) : null}
            {d.request && (
              <>
                <h4>{d.request.title}</h4>
                <pre className="tctr-code"><HighlightedText text={d.request.text} /></pre>
              </>
            )}
            {d.response && (
              <>
                <h4>{d.response.title}</h4>
                <pre className="tctr-code"><HighlightedText text={d.response.text} /></pre>
              </>
            )}
            {d.altRequest && (
              <>
                <h4>{d.altRequest.title}</h4>
                <pre className="tctr-code"><HighlightedText text={d.altRequest.text} /></pre>
              </>
            )}
            {d.altResponse && (
              <>
                <h4>{d.altResponse.title}</h4>
                <pre className="tctr-code"><HighlightedText text={d.altResponse.text} /></pre>
              </>
            )}
          </div>
        )}

        <div className="tctr-step-actions">
          {canPopOut && (
            <button
              type="button"
              className={`tctr-inspect${largeEvidence ? " tctr-inspect--emphasize" : ""}`}
              onClick={() => openStepTeachingWindow(step)}
            >
              → Pop out full detail
            </button>
          )}
          {d.inspectToken && (
            <button type="button" className="tctr-inspect"
              onClick={() => onInspect(d.inspectToken)}>
              → Inspect claims
            </button>
          )}
          {d.moreDetail && d.moreDetail.href && (
            <a
              className="tctr-inspect"
              href={d.moreDetail.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              → {d.moreDetail.label || "Show more detail"}
            </a>
          )}
        </div>
      </div>
    </details>
  );
}
