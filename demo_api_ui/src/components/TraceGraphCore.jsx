// demo_api_ui/src/components/TraceGraphCore.jsx
import React, { useEffect, useRef, useState } from "react";
import { buildGraph, buildCollapsedGraph } from "../services/traceGraph";
import { renderTraceGraph } from "../services/traceGraphRender";

/**
 * Interactive D3 service graph for whatever raw Jaeger payload `rawUrl`
 * returns — one trace or a multi-trace overview, both handled by the same
 * generalized model. Shared by /tracing's Graph tab (TraceGraphView, one
 * trace) and /telemetry (TelemetryPage, one trace or the whole system).
 */
export default function TraceGraphCore({ rawUrl }) {
  const hostRef = useRef(null);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [selection, setSelection] = useState(null); // { kind: 'node'|'edge', data }

  useEffect(() => {
    let live = true;
    setRaw(null); setError(null); setSelection(null);
    (async () => {
      try {
        const res = await fetch(rawUrl, { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (live) setRaw(data);
      } catch (e) {
        if (live) setError(e.message || "Failed to load trace");
      }
    })();
    return () => { live = false; };
  }, [rawUrl]);

  useEffect(() => {
    if (!raw || !hostRef.current) return undefined;
    const graph = collapsed ? buildCollapsedGraph(raw, {}) : buildGraph(raw, {});
    const handle = renderTraceGraph(hostRef.current, graph, {
      onNodeClick: (node) => setSelection({ kind: "node", data: node }),
      onEdgeClick: (edge) => setSelection({ kind: "edge", data: edge }),
    });
    return () => handle.destroy();
  }, [raw, collapsed]);

  if (error) return <div className="tracing-detail tracing-detail--msg tracing-detail--error">{error}</div>;
  if (!raw) return <div className="tracing-detail tracing-detail--msg">Loading graph…</div>;

  return (
    <div className="tracing-graph">
      <div className="tracing-graph-controls">
        <label className="tracing-graph-toggle">
          <input type="checkbox" checked={collapsed} onChange={(e) => setCollapsed(e.target.checked)} />
          <span>Collapse clusters</span>
        </label>
      </div>
      <div className="tracing-graph-canvas" ref={hostRef} />
      {selection && (
        <aside className="tracing-graph-panel">
          <button type="button" className="tracing-btn tracing-btn--secondary" onClick={() => setSelection(null)}>
            Close
          </button>
          <h3>{selection.kind === "node" ? selection.data.label : `${selection.data.sourceLabel} to ${selection.data.targetLabel}`}</h3>
          <dl className="tracing-graph-panel-facts">
            <dt>Calls</dt><dd>{selection.data.callCount ?? "1"}</dd>
            {selection.kind === "edge" && (<><dt>Avg duration</dt><dd>{selection.data.avgDurationMs} ms</dd></>)}
          </dl>
          <div className="tracing-graph-panel-spans">
            {(selection.data.spans || []).map((s, i) => (
              <div key={i} className="tracing-span-row">
                <span className="tracing-span-op">{s.operationName || s.op}</span>
                <span className="tracing-span-dur">{s.durationMs} ms</span>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
