import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./TelemetryPage.css";
import {
  NODE_RADIUS,
  edgeGeometry,
  mergePositions,
  wrapLabel,
} from "./telemetryGraph";

const REFRESH_MS = 5000;
const VIEW_W = 900;
const VIEW_H = 480;
const DEFAULT_SERVICE = "demo-api-server";

async function fetchJson(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Telemetry page — draggable left-to-right service/span graph built from
 * Jaeger traces via the existing /api/health/tracing proxy. Overview shows
 * service topology; Detailed shows one selected trace's spans.
 */
export default function TelemetryPage() {
  const [view, setView] = useState("overview");
  const [graph, setGraph] = useState(null);
  const [positions, setPositions] = useState(new Map());
  const [traces, setTraces] = useState([]);
  const [selectedTraceId, setSelectedTraceId] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  // Drag state lives in refs: pointermove must not re-create listeners.
  const dragRef = useRef(null);
  const svgRef = useRef(null);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  const loadGraph = useCallback(async (opts = {}) => {
    const traceId = opts.traceId ?? (opts.view === "detailed" ? opts.selectedTraceId : null);
    const url = traceId
      ? `/api/health/tracing/graph?traceId=${encodeURIComponent(traceId)}`
      : "/api/health/tracing/graph?lookback=1h";
    try {
      const data = await fetchJson(url);
      setGraph(data);
      setPositions((prev) => mergePositions(prev, data, VIEW_W, VIEW_H));
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadTraces = useCallback(async () => {
    try {
      const data = await fetchJson(
        `/api/health/tracing/traces?service=${DEFAULT_SERVICE}&limit=20&lookback=1h`,
      );
      setTraces(data.traces || []);
    } catch {
      /* recent-traces list is best-effort */
    }
  }, []);

  const refresh = useCallback(() => {
    loadGraph({ view, selectedTraceId });
    loadTraces();
  }, [loadGraph, loadTraces, view, selectedTraceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh || paused) return undefined;
    const id = setInterval(() => {
      if (!dragRef.current && !document.hidden) refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, paused, refresh]);

  // ---- dragging ------------------------------------------------------------
  const svgPoint = useCallback((evt) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }, []);

  const onPointerDown = useCallback(
    (evt) => {
      const group = evt.target.closest("g[data-node-id]");
      if (!group) return;
      const id = group.getAttribute("data-node-id");
      const pos = positionsRef.current.get(id);
      if (!pos) return;
      const p = svgPoint(evt);
      dragRef.current = { id, dx: p.x - pos.x, dy: p.y - pos.y };
      svgRef.current.setPointerCapture(evt.pointerId);
    },
    [svgPoint],
  );

  const onPointerMove = useCallback(
    (evt) => {
      const drag = dragRef.current;
      if (!drag) return;
      const p = svgPoint(evt);
      setPositions((prev) => {
        const next = new Map(prev);
        next.set(drag.id, { x: p.x - drag.dx, y: p.y - drag.dy });
        return next;
      });
    },
    [svgPoint],
  );

  const onPointerUp = useCallback((evt) => {
    dragRef.current = null;
    if (svgRef.current?.hasPointerCapture?.(evt.pointerId)) {
      svgRef.current.releasePointerCapture(evt.pointerId);
    }
  }, []);

  // ---- derived -------------------------------------------------------------
  const visibleNodes = useMemo(() => {
    const nodes = graph?.nodes || [];
    const q = filter.trim().toLowerCase();
    return q ? nodes.filter((n) => n.label.toLowerCase().includes(q)) : nodes;
  }, [graph, filter]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => (graph?.edges || []).filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [graph, visibleIds],
  );

  const stats = useMemo(
    () => ({
      nodes: graph?.nodes?.length || 0,
      edges: graph?.edges?.length || 0,
      errors: (graph?.nodes || []).filter((n) => n.status === "error").length,
      traces: traces.length,
    }),
    [graph, traces],
  );

  const selectTrace = (traceId) => {
    setSelectedTraceId(traceId);
    setView("detailed");
    loadGraph({ traceId });
  };

  const changeView = (next) => {
    setView(next);
    if (next === "overview") loadGraph({});
    else if (selectedTraceId) loadGraph({ traceId: selectedTraceId });
  };

  const tracingOff = graph && graph.tracingEnabled === false;
  const emptyGraph = graph && graph.tracingEnabled && (graph.nodes || []).length === 0;

  return (
    <div className="telemetry-page">
      <header className="telemetry-header">
        <h1>Telemetry</h1>
        <p>Real-time trace visualization of service topology and errors</p>
      </header>

      <div className="telemetry-body">
        <aside className="telemetry-controls">
          <div className="telemetry-control-group">
            <label className="telemetry-label" htmlFor="telemetry-auto">Refresh</label>
            <div className="telemetry-toggle">
              <input
                id="telemetry-auto"
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <span>Auto-refresh (5s)</span>
            </div>
          </div>

          <div className="telemetry-button-row">
            <button
              type="button"
              className={`telemetry-btn ${paused ? "telemetry-btn--danger" : "telemetry-btn--secondary"}`}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" className="telemetry-btn telemetry-btn--primary" onClick={refresh}>
              Fetch
            </button>
          </div>

          <div className="telemetry-control-group">
            <label className="telemetry-label" htmlFor="telemetry-view">View</label>
            <select id="telemetry-view" value={view} onChange={(e) => changeView(e.target.value)}>
              <option value="overview">Overview (Services)</option>
              <option value="detailed">Detailed (One Trace)</option>
            </select>
          </div>

          <div className="telemetry-control-group">
            <label className="telemetry-label" htmlFor="telemetry-filter">Filter</label>
            <input
              id="telemetry-filter"
              type="text"
              placeholder="Search nodes..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="telemetry-stats">
            <div><span>Nodes</span><strong>{stats.nodes}</strong></div>
            <div><span>Calls</span><strong>{stats.edges}</strong></div>
            <div><span>Errors</span><strong className={stats.errors ? "telemetry-stat-error" : ""}>{stats.errors}</strong></div>
            <div><span>Recent traces</span><strong>{stats.traces}</strong></div>
          </div>

          <div className="telemetry-control-group">
            <span className="telemetry-label">Recent traces</span>
            <ul className="telemetry-trace-list">
              {traces.map((t) => (
                <li key={t.traceId}>
                  <button
                    type="button"
                    className={`telemetry-trace-item${t.traceId === selectedTraceId ? " telemetry-trace-item--selected" : ""}`}
                    onClick={() => selectTrace(t.traceId)}
                  >
                    <strong>{t.operation}</strong>
                    <span>{t.spanCount} spans - {t.durationMs}ms</span>
                  </button>
                </li>
              ))}
              {!traces.length && <li className="telemetry-trace-empty">None in the last hour</li>}
            </ul>
          </div>

          <div className="telemetry-updated">
            {error
              ? `Error: ${error}`
              : lastUpdated
                ? `Last update: ${lastUpdated.toLocaleTimeString()}`
                : "Loading..."}
          </div>
        </aside>

        <section className="telemetry-canvas">
          {tracingOff && (
            <div className="telemetry-empty">
              <p>Tracing is off or Jaeger is unreachable.</p>
              <p>
                Enable the <a href="/feature-flags">Tracing - OpenTelemetry feature flag</a> and
                start Jaeger, then interact with the app.
              </p>
            </div>
          )}
          {emptyGraph && (
            <div className="telemetry-empty">
              <p>No traces yet - interact with the app (run an agent chip) and traces appear here.</p>
            </div>
          )}
          {!tracingOff && !emptyGraph && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="telemetry-svg"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <defs>
                <marker id="telemetry-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                  <polygon points="0 0, 10 4, 0 8" fill="#95a5a6" />
                </marker>
                <linearGradient id="telemetry-grad-ok" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#5dade2" />
                  <stop offset="100%" stopColor="#2e86c1" />
                </linearGradient>
                <linearGradient id="telemetry-grad-error" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ec7063" />
                  <stop offset="100%" stopColor="#cb4335" />
                </linearGradient>
                <filter id="telemetry-shadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2" />
                </filter>
              </defs>

              <g>
                {visibleEdges.map((e) => {
                  const s = positions.get(e.source);
                  const t = positions.get(e.target);
                  if (!s || !t) return null;
                  const geo = edgeGeometry(s, t, NODE_RADIUS);
                  return (
                    <g key={`${e.source}-${e.target}`}>
                      <line
                        x1={geo.x1} y1={geo.y1} x2={geo.x2} y2={geo.y2}
                        stroke="#95a5a6" strokeWidth="2" markerEnd="url(#telemetry-arrow)"
                      />
                      <text x={geo.labelX} y={geo.labelY} className="telemetry-edge-label" textAnchor="middle">
                        {e.label}
                      </text>
                    </g>
                  );
                })}
              </g>

              <g>
                {visibleNodes.map((n) => {
                  const pos = positions.get(n.id);
                  if (!pos) return null;
                  const lines = wrapLabel(n.label);
                  return (
                    <g
                      key={n.id}
                      data-node-id={n.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      filter="url(#telemetry-shadow)"
                      className="telemetry-node"
                    >
                      <circle
                        r={NODE_RADIUS}
                        fill={n.status === "error" ? "url(#telemetry-grad-error)" : "url(#telemetry-grad-ok)"}
                        stroke="white"
                        strokeWidth="3"
                      />
                      <text className="telemetry-node-label" textAnchor="middle" y={lines.length === 2 ? -10 : -4}>
                        {lines.map((line, i) => (
                          <tspan key={line + i} x="0" dy={i === 0 ? 0 : 12}>{line}</tspan>
                        ))}
                      </text>
                      <text
                        className={`telemetry-node-latency${n.status === "error" ? " telemetry-node-latency--error" : ""}`}
                        textAnchor="middle"
                        y={lines.length === 2 ? 18 : 14}
                      >
                        {n.latency}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          <div className="telemetry-legend">
            <span><i className="telemetry-legend-dot telemetry-legend-dot--ok" /> OK</span>
            <span><i className="telemetry-legend-dot telemetry-legend-dot--error" /> Error</span>
            <span className="telemetry-legend-hint">Drag nodes to rearrange</span>
          </div>
        </section>
      </div>
    </div>
  );
}
