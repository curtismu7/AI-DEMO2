// demo_api_ui/src/components/ProjectedTimeline.jsx
import React, { useEffect, useState } from "react";

/** CSS-badge letter per icon kind — no emoji (REGRESSION_PLAN §0 allowlist). */
const ICON_TEXT = { brain: "R", key: "K", shield: "A", bolt: "T", database: "B", bell: "H" };

/**
 * Steps tab — curated business steps for one trace, from
 * GET /api/health/tracing/traces/:id/projected (ACP telemetry-panel port).
 */
export default function ProjectedTimeline({ traceId }) {
  const [projection, setProjection] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let live = true;
    setProjection(null); setError(null); setOpenId(null);
    (async () => {
      try {
        const res = await fetch(`/api/health/tracing/traces/${traceId}/projected`, { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (live) setProjection(data);
      } catch (e) {
        if (live) setError(e.message || "Failed to load steps");
      }
    })();
    return () => { live = false; };
  }, [traceId]);

  if (error) return <div className="tracing-detail tracing-detail--msg tracing-detail--error">{error}</div>;
  if (!projection) return <div className="tracing-detail tracing-detail--msg">Loading steps…</div>;
  if (!projection.spans.length) {
    return (
      <div className="tracing-detail tracing-detail--msg">
        No recognized steps in this trace. Steps appear for agent runs — token exchange,
        authorization, reasoning, and tool calls. Try a trace from agent-service.
      </div>
    );
  }

  const maxMs = Math.max(...projection.spans.map((s) => s.durationMs), 1);

  return (
    <div className="tracing-steps">
      <p className="tracing-detail-legend">
        Curated view: the business steps of this request, distilled from {projection.spans.length} anchor
        span{projection.spans.length === 1 ? "" : "s"} · total {projection.traceDurationMs} ms
      </p>
      {projection.spans.map((s) => (
        <div
          key={s.id}
          className={`tracing-step-card ${s.status === "error" ? "tracing-step-card--error" : ""}`}
          onClick={() => setOpenId(openId === s.id ? null : s.id)}
        >
          <div className="tracing-step-head">
            <span className={`tracing-step-icon tracing-step-icon--${s.icon}`}>{ICON_TEXT[s.icon] || "·"}</span>
            <span className="tracing-step-title">{s.title}</span>
            <span className="tracing-step-dur">{s.durationMs} ms</span>
          </div>
          <div className="tracing-step-bar">
            <div className="tracing-step-bar-fill" style={{ width: `${Math.max(2, (s.durationMs / maxMs) * 100)}%` }} />
          </div>
          <dl className="tracing-step-facets">
            {s.summary.map((f, i) => (
              <div key={i} className="tracing-step-facet">
                <dt>{f.facet === "additionalMetadata" ? f.key : f.facet}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {openId === s.id && (
            <div className="tracing-step-details">
              <p className="tracing-step-source">{s.source}</p>
              <pre>{JSON.stringify(s.details, null, 2)}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
