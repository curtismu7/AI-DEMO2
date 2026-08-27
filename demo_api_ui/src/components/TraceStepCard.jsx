// One pipeline step — a native <details> card. Dumb renderer over the neutral
// step.detail shape produced by buildTraceSteps; knows nothing about sources.
import React, { useMemo } from "react";
import JsonHighlight, { tokenize, formatJson } from "./shared/JsonHighlight";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { stageReplay } from "../services/inspectorReplay";
import "./shared/JsonHighlight.css";

const STATUS_ICON = { pending: "·", active: "…", done: "✓", error: "✗", notinpath: "–" };

/** Combined request+response size above which we push the learner to pop-out. */
const EVIDENCE_POPOUT_CHARS = 1200;

// d.request.text / d.response.text are pre-formatted display strings (often a
// narrative prefix line + embedded JSON, not pure JSON) — tokenize() colors
// the JSON portions and leaves the rest as plain text, so it's safe to run
// over the whole string as-is rather than re-parsing it as a JSON value.
function claimDiffs(beforeText, afterText) {
  try {
    const before = JSON.parse(beforeText);
    const after = JSON.parse(afterText);
    return new Set(
      ["aud", "scope"].filter((claim) =>
        JSON.stringify(before?.[claim]) !== JSON.stringify(after?.[claim])),
    );
  } catch {
    return new Set();
  }
}

function HighlightedText({ text, changedClaims = new Set(), side }) {
  let activeClaim = null;
  return tokenize(text).map((t, i) => {
    if (t.type === "key") {
      const match = t.text.match(/"([^"]+)"\s*:/);
      activeClaim = match && changedClaims.has(match[1]) ? match[1] : null;
    }
    const classes = [
      `jh-${t.type}`,
      t.critical ? "jh-critical" : null,
      t.focused ? "jh-focus" : null,
    ];
    if (activeClaim) classes.push(`tctr-claim-diff tctr-claim-diff--${side}`);
    return <span key={i} className={classes.filter(Boolean).join(" ")}>{t.text}</span>;
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textToHtml(text, changedClaims = new Set(), side) {
  if (text == null || text === "") return "";
  let activeClaim = null;
  return tokenize(String(text))
    .map((t) => {
      if (t.type === "key") {
        const match = t.text.match(/"([^"]+)"\s*:/);
        activeClaim = match && changedClaims.has(match[1]) ? match[1] : null;
      }
      const cls = [
        `jh-${t.type}`,
        t.critical ? "jh-critical" : null,
        t.focused ? "jh-focus" : null,
      ].filter(Boolean).join(" ");
      const claimClass = activeClaim ? ` claim-diff claim-diff--${side}` : "";
      return `<span class="${cls}${claimClass}">${escapeHtml(t.text)}</span>`;
    })
    .join("");
}

function renderBeforeAfterBlock(beforeAfter) {
  if (!beforeAfter?.before?.text && !beforeAfter?.after?.text) return "";
  const changedClaims = claimDiffs(beforeAfter?.before?.text, beforeAfter?.after?.text);
  const beforeHtml = beforeAfter?.before?.text
    ? `<div class="before-after-col"><h3>${escapeHtml(beforeAfter.before.title || "Before")}</h3><pre class="pre">${textToHtml(beforeAfter.before.text, changedClaims, "before")}</pre></div>`
    : "";
  const afterHtml = beforeAfter?.after?.text
    ? `<div class="before-after-col"><h3>${escapeHtml(beforeAfter.after.title || "After")}</h3><pre class="pre">${textToHtml(beforeAfter.after.text, changedClaims, "after")}</pre></div>`
    : "";
  return `<div class="before-after">${beforeHtml}${afterHtml}</div>`;
}

function renderMoreDetailLinks(moreDetail) {
  if (!moreDetail?.href && !moreDetail?.edu) return "";
  const href = moreDetail.href || "#";
  const label = moreDetail.label || (moreDetail.hrefLabel || "More Education");
  return `<p class="more-detail"><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`;
}

/** Which use case this run belongs to, from the Proof verdict (may be absent). */
function renderUseCaseBanner(useCase) {
  if (!useCase || (!useCase.title && !useCase.useCaseId)) return "";
  const name = [useCase.id, useCase.title || useCase.useCaseId].filter(Boolean).join(" — ");
  const facts = [
    useCase.vertical ? `vertical ${useCase.vertical}` : null,
    useCase.tool ? `tool ${useCase.tool}` : null,
    useCase.expectedOutcome ? `expected ${useCase.expectedOutcome}` : null,
  ].filter(Boolean).join(" · ");
  const state = useCase.state
    ? `<span class="uc-state uc-state--${escapeHtml(useCase.state)}">${escapeHtml(useCase.state)}</span>`
    : "";
  return `<div class="uc">
    <div class="uc-row"><strong>${escapeHtml(name)}</strong>${state}</div>
    ${facts ? `<div class="uc-facts">${escapeHtml(facts)}</div>` : ""}
    ${useCase.resultText ? `<div class="uc-facts">${escapeHtml(useCase.resultText)}</div>` : ""}
  </div>`;
}

/** Normative citations + rationale for this hop (static, from STEP_SPEC). */
function renderSpecBlock(spec, fallbackRfcs) {
  if (!spec) {
    return Array.isArray(fallbackRfcs) && fallbackRfcs.length
      ? `<h2>Specification</h2><p class="spec-refs">${fallbackRfcs.map((r) => escapeHtml(r)).join(" · ")}</p>`
      : "";
  }
  const refs = Array.isArray(spec.refs) && spec.refs.length
    ? `<p class="spec-refs">${spec.refs.map((r) => (r.href
      ? `<a href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.title || "")}">${escapeHtml(r.label)}</a>`
      : `<span>${escapeHtml(r.label)}</span>`)).join(" · ")}</p>`
    : "";
  const titles = Array.isArray(spec.refs) && spec.refs.length
    ? `<ul class="spec-titles">${spec.refs.map((r) =>
      `<li><strong>${escapeHtml(r.label)}</strong> — ${escapeHtml(r.title || "")}</li>`).join("")}</ul>`
    : "";
  return `
    ${spec.why ? `<h2>Why it works this way</h2><p class="prose">${escapeHtml(spec.why)}</p>` : ""}
    <h2>What the specification requires</h2>
    ${refs}${titles}
    ${spec.mandate ? `<p class="prose">${escapeHtml(spec.mandate)}</p>` : ""}
    ${spec.failure ? `<h2>Common failure mode</h2><p class="prose prose--warn">${escapeHtml(spec.failure)}</p>` : ""}`;
}

/** Scope narrowing produced by this hop — kept/dropped scopes, before → after. */
function renderScopeDiff(scopeDiff) {
  if (!scopeDiff || !Array.isArray(scopeDiff.before)) return "";
  const after = Array.isArray(scopeDiff.after) ? scopeDiff.after : [];
  const chips = scopeDiff.before.map((s) => {
    const kept = after.includes(s);
    return `<span class="sc sc--${kept ? "kept" : "gone"}">${escapeHtml(s)}${kept ? "" : " (dropped)"}</span>`;
  }).join("");
  return `<h2>Scope narrowing</h2><div class="scope">${chips}
    <div class="scope-note">Scope after this hop: ${escapeHtml(after.join(" ") || "(none)")}</div></div>`;
}

/**
 * The exact request this run made, in a form the matching inspector can re-issue.
 * Rendered read-only: staging a replay payload is a one-shot localStorage write
 * that the next inspector visit consumes and re-fires as a LIVE tool call, so it
 * must only happen on a real click of the card's own "Replay in …" button.
 */
function renderReplayBlock(replay) {
  if (!replay) return "";
  const rows = [
    ["target", replay.target],
    ["tool", replay.tool],
    ["endpoint", replay.href],
  ].filter(([, v]) => v);
  const rawArgs = replay.arguments || replay.parameters || null;
  const args = rawArgs && Object.keys(rawArgs).length ? rawArgs : null;
  return `<h2>Re-issuable request</h2><table>${rows.map(([k, v]) =>
    `<tr><th>${escapeHtml(k)}</th><td><pre class="inline">${escapeHtml(String(v))}</pre></td></tr>`).join("")}</table>
    ${args ? `<pre class="pre">${textToHtml(formatJson(args))}</pre>` : ""}
    <p class="prose prose--note">Use the “${escapeHtml(replay.label || "Replay")}” button on the step card to re-run this against the live stack.</p>`;
}

/**
 * Opens a standalone teaching window for one TraceRail step (L3 overflow).
 * @param {object} step the step model from buildTraceSteps
 * @param {object} [useCase] the Proof verdict for this run — names the use case
 */
export function openStepTeachingWindow(step, useCase) {
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
  const beforeAfterHtml = renderBeforeAfterBlock(d.beforeAfter);
  const moreDetailHtml = renderMoreDetailLinks(d.moreDetail);
  const useCaseHtml = renderUseCaseBanner(useCase);
  const specHtml = renderSpecBlock(d.spec, d.rfcs);
  const scopeHtml = renderScopeDiff(d.scopeDiff);
  const replayHtml = renderReplayBlock(d.replay);
  const laneHtml = step?.lane
    ? `<div class="meta">${escapeHtml(step.lane)}${step.status ? ` · ${escapeHtml(step.status)}` : ""}</div>`
    : "";
  const kvHtml = Array.isArray(d.kv) && d.kv.length
    ? `<h2>Proof</h2><table>${d.kv.map(([k, v]) =>
      `<tr><th>${escapeHtml(k)}</th><td><pre class="inline">${textToHtml(typeof v === "string" ? v : formatJson(v, true) || String(v))}</pre></td></tr>`).join("")}</table>`
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
  .meta{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:10px}
  .prose{margin:0 0 8px;color:#334155;max-width:76ch}
  .prose--warn{border-left:3px solid #f59e0b;padding-left:10px}
  .prose--note{color:#475569;font-size:12px}
  .uc{background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;margin:0 0 12px}
  .uc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .uc-facts{color:#475569;font-size:12px;margin-top:3px}
  .uc-state{font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;border-radius:999px;padding:2px 8px;border:1px solid #cbd5e1;color:#334155}
  .uc-state--verified,.uc-state--denied-as-expected{background:#f0fdf4;border-color:#86efac;color:#166534}
  .uc-state--mismatch{background:#fef2f2;border-color:#fca5a5;color:#991b1b}
  .uc-state--incomplete{background:#fffbeb;border-color:#fcd34d;color:#92400e}
  .spec-refs{margin:0 0 6px}
  .spec-refs a{color:#1d4ed8;font-weight:600;text-decoration:none;margin-right:4px}
  .spec-refs a:hover,.spec-refs a:focus{text-decoration:underline}
  .spec-titles{margin:0 0 8px 16px;color:#475569;font-size:12px}
  .scope{margin-bottom:10px}
  .sc{display:inline-block;font:11px ui-monospace,Menlo,monospace;border-radius:6px;padding:2px 7px;margin:0 5px 5px 0}
  .sc--kept{background:#f0fdf4;border:1px solid #86efac;color:#166534}
  .sc--gone{background:#f1f5f9;border:1px solid #cbd5e1;color:#64748b;text-decoration:line-through}
  .scope-note{color:#475569;font-size:12px}
  .decision{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 10px;margin:8px 0;font-weight:600}
  .pre{background:#0f172a;color:#bae6fd;border-radius:8px;padding:12px;font:11px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:70vh;overflow:auto}
  .inline{margin:0;white-space:pre-wrap;word-break:break-word;font:11px ui-monospace,Menlo,monospace}
  .more-detail{margin:10px 0 0}
  .more-detail a{color:#1d4ed8;font-weight:600;text-decoration:none}
  .before-after{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:10px}
  .before-after-col{display:flex;flex-direction:column;gap:6px}
  .before-after-col h3{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#475569}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;color:#64748b;width:120px;vertical-align:top;padding:4px 8px 4px 0}
  td{padding:4px 0;vertical-align:top}
  .jh-key{color:#79c0ff}.jh-string{color:#7ee787}.jh-number{color:#ffa657}
  .jh-keyword{color:#d2a8ff;font-weight:600}.jh-punct{color:#8b949e}
  .jh-critical{color:#ff6b6b;font-weight:600}
  .jh-focus{background:rgba(251,191,36,.28);color:#fde68a;font-weight:700;border-radius:3px}
  .claim-diff{border-radius:3px}
  .claim-diff--before{background:rgba(251,191,36,.24)}
  .claim-diff--after{background:rgba(45,212,191,.24)}
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${laneHtml}${useCaseHtml}${narrativeHtml}${specHtml}${scopeHtml}${whyHtml}${decisionHtml}${kvHtml}${reqHtml}${resHtml}${altReqHtml}${altResHtml}${beforeAfterHtml}${replayHtml}${moreDetailHtml}
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
  if (d.request || d.response || d.altRequest || d.altResponse || d.beforeAfter) return true;
  if (d.why) return true;
  if (d.decision) return true;
  if (Array.isArray(d.kv) && d.kv.length > 0) return true;
  if (d.scopeDiff) return true;
  // Run-specific: the gateway only reports a filter chain for a request it
  // actually processed, so its presence means there is something to pop out.
  if (Array.isArray(d.stages) && d.stages.length > 0) return true;
  return false;
}

function TraceStepCard({ step, onInspect, defaultOpen = false, useCase = null }) {
  const eduUi = useEducationUIOptional();
  const d = step.detail || {};
  const notInPath = step.status === "notinpath";
  const hasEvidence = Boolean(d.request || d.response || d.altRequest || d.altResponse || d.beforeAfter);
  const largeEvidence = evidenceSize(d) > EVIDENCE_POPOUT_CHARS;
  const canPopOut = hasPopoutWorthyDetail(d);
  const more = d.moreDetail || null;
  const canOpenEdu = Boolean(more?.edu && eduUi?.open);
  const replay = d.replay || null;
  const beforeAfterChangedClaims = useMemo(
    () => claimDiffs(d.beforeAfter?.before?.text, d.beforeAfter?.after?.text),
    [d.beforeAfter?.before?.text, d.beforeAfter?.after?.text],
  );

  // Stash this run's actual request, then open the inspector on it. Falls back
  // to the bare page when sessionStorage is unavailable.
  const openReplay = () => {
    const url = stageReplay(replay) || replay.href;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <details className="tctr-step" data-status={step.status} data-step-id={step.id} open={defaultOpen}>
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
        {Array.isArray(d.stages) && d.stages.length > 0 && (
          <ol className="tctr-stages">
            {d.stages.map((s) => (
              <li key={s.raw || s.name} className="tctr-stage" data-status={s.status}>
                <span className="tctr-stage-name">{s.name}</span>
                <span className="tctr-stage-result">
                  {s.result}{s.decision ? ` — ${s.decision}` : ""}
                  {s.blockedHere ? " (stopped here)" : ""}
                </span>
                {s.note && <span className="tctr-stage-note">{s.note}</span>}
              </li>
            ))}
          </ol>
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
                {v && typeof v === "object"
                  ? <pre className="tctr-kv-v tctr-kv-v--json"><JsonHighlight value={v} deep /></pre>
                  : <span className="tctr-kv-v">{v}</span>}
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
                <pre className="tctr-code jh-dark"><HighlightedText text={d.request.text} /></pre>
              </>
            )}
            {d.response && (
              <>
                <h4>{d.response.title}</h4>
                <pre className="tctr-code jh-dark"><HighlightedText text={d.response.text} /></pre>
              </>
            )}
            {d.altRequest && (
              <>
                <h4>{d.altRequest.title}</h4>
                <pre className="tctr-code jh-dark"><HighlightedText text={d.altRequest.text} /></pre>
              </>
            )}
            {d.altResponse && (
              <>
                <h4>{d.altResponse.title}</h4>
                <pre className="tctr-code jh-dark"><HighlightedText text={d.altResponse.text} /></pre>
              </>
            )}
            {d.beforeAfter && (
              <div className="tctr-before-after">
                <div className="tctr-before-after__column">
                  <h4>{d.beforeAfter.before?.title || "Before"}</h4>
                  <pre className="tctr-code jh-dark"><HighlightedText
                    text={d.beforeAfter.before?.text || "—"}
                    changedClaims={beforeAfterChangedClaims}
                    side="before"
                  /></pre>
                </div>
                <div className="tctr-before-after__column">
                  <h4>{d.beforeAfter.after?.title || "After"}</h4>
                  <pre className="tctr-code jh-dark"><HighlightedText
                    text={d.beforeAfter.after?.text || "—"}
                    changedClaims={beforeAfterChangedClaims}
                    side="after"
                  /></pre>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="tctr-step-actions">
          {canPopOut && (
            <button
              type="button"
              className={`tctr-inspect${largeEvidence ? " tctr-inspect--emphasize" : ""}`}
              onClick={() => openStepTeachingWindow(step, useCase)}
            >
              → Pop out full detail
            </button>
          )}
          {replay && (
            <button type="button" className="tctr-inspect" onClick={openReplay}>
              → {replay.label || "Replay in tester"}
            </button>
          )}
          {d.inspectToken && (
            <button type="button" className="tctr-inspect"
              onClick={() => onInspect(d.inspectToken)}>
              → Inspect claims
            </button>
          )}
          {canOpenEdu && (
            <button
              type="button"
              className="tctr-inspect"
              onClick={() => eduUi.open(more.edu, more.tab || null)}
            >
              → {more.label || "Learn more"}
            </button>
          )}
          {more?.href && (
            <a
              className="tctr-inspect"
              href={more.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              → {canOpenEdu ? (more.hrefLabel || "Open full page") : (more.label || "More Education")}
            </a>
          )}
        </div>
      </div>
    </details>
  );
}

export default React.memo(TraceStepCard);
