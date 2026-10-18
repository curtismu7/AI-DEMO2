import React, { memo, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Background, BackgroundVariant, Handle, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./ObservabilityDiagramPage.css";
import { useDraggableNodes } from '../hooks/useDraggableNodes';
import { edgeCaptions, markNodes, stepEdges, useDiagramStepper } from "../hooks/useDiagramStepper";
import DiagramStepBar from "./DiagramStepBar";

/**
 * ObservabilityDiagramPage — /architecture/observability.
 *
 * The observability demo as a diagram: where each telemetry plane is emitted,
 * which collector stores it, and which surface presents it — plus the two-part
 * demo walkthrough (forensics, then ops). Same React Flow pattern as
 * PingFederateIdJagPage; the page is illustrative by design (it maps the
 * shipped stack, it does not query it live).
 */

const PLANES = ["metrics", "traces", "logs"];

// One edge per telemetry hop in the compose stack (docker-compose.yml
// `observability` + `tracing` profiles). Plane hues are the validated trio
// (metrics #2563eb, traces #0d9488, logs #946b24 — passes all six dataviz
// checks on BOTH surfaces; see ObservabilityDiagramPage.css).
// sourceHandle/targetHandle: each node exposes left+right handles; parallel
// edges leaving one node use DIFFERENT vertical offsets via `so`/`to`
// (source/target Y fraction, 0=top .. 1=bottom) so co-routed lines fan out
// instead of drawing on top of each other.
// LAYERED LAYOUT — one horizontal band per telemetry plane. Each band is a
// simple left→middle→right flow (emit → collect → present), so an edge never
// crosses a node or another plane's lines. The old single 3-column grid made
// every left node talk to every middle node — 14 edges funnelling through two
// midlines — which is why lines overlapped no matter the routing knobs.
// Within a band, edges at most 2 per hop and can't collide: rows are 190px
// apart, nodes 73px, so each band's edges own their channel.
const FLOW_NODES = [
  // ── METRICS band ──
  { id: "gw", column: 0, row: 0, mark: "IG", title: "Agent Gateway · :8085", sub: "admin connector", planes: ["metrics"] },
  { id: "mcp", column: 0, row: 1, mark: "MCP", title: "mcp-server / mcpgw", sub: "/metrics endpoint", planes: ["metrics"] },
  { id: "prom", column: 1, row: 0, mark: "P", title: "Prometheus", sub: "scrapes both · TSDB", planes: ["metrics"] },
  { id: "am", column: 1, row: 1, mark: "AM", title: "Alertmanager", sub: "default receiver (no-op)", planes: ["metrics"] },
  { id: "graf", column: 2, row: 0, mark: "G", title: "Grafana", sub: "dashboards · alerts · explore", planes: PLANES },
  { id: "arule", column: 2, row: 1, mark: "!", title: "Alert rules page", sub: "Grafana Alerting UI", planes: ["metrics"] },
  // ── TRACES band ──
  { id: "bff", column: 0, row: 2, mark: "BFF", title: "BFF · demo-api-server", sub: "OTel spans", planes: ["traces", "logs"] },
  { id: "ags", column: 0, row: 3, mark: "AG", title: "demo_agent_service", sub: "OTel spans (reason · tool)", planes: ["traces"] },
  { id: "jaeger", column: 1, row: 2, mark: "J", title: "Jaeger", sub: "trace store · OTLP in", planes: ["traces"] },
  { id: "inapp", column: 2, row: 2, mark: "UI", title: "In-app pages", sub: "Tracing · Transaction Trace", planes: ["traces"] },
  // ── LOGS band ──
  { id: "cont", column: 0, row: 4, mark: "RUN", title: "Service containers", sub: "docker logs", planes: ["logs"] },
  { id: "alloy", column: 1, row: 3, mark: "AL", title: "Alloy", sub: "log scraper", planes: ["logs"] },
  { id: "loki", column: 1, row: 4, mark: "LO", title: "Loki", sub: "log store", planes: ["logs"] },
  { id: "mcpobs", column: 2, row: 4, mark: "UI", title: "MCP Observability", sub: "in-app log view", planes: ["logs"] },
];

// One edge per hop, laid out so no two edges in a band share a channel:
// emitters → their store → the surface that shows it. bff keeps a logs edge
// (it's the structured logger) routed to Loki on its own lane below traces.
const FLOW_EDGES = [
  // Metrics: gw+mcp → prom → graf; prom → am → arule
  { id: "e-gw-prom", source: "gw", target: "prom", label: "scrape", plane: "metrics", so: 0.5, to: 0.7, step: 0.5 },
  { id: "e-mcp-prom", source: "mcp", target: "prom", label: "scrape", plane: "metrics", so: 0.5, to: 0.3, step: 0.35 },
  { id: "e-prom-graf", source: "prom", target: "graf", label: "datasource", plane: "metrics", so: 0.3, to: 0.5, step: 0.5 },
  { id: "e-prom-am", source: "prom", target: "am", label: "fire", plane: "metrics", so: 0.7, to: 0.5, step: 0.5 },
  { id: "e-am-arule", source: "am", target: "arule", label: "", plane: "metrics", so: 0.5, to: 0.5, step: 0.5 },
  // Traces: bff+ags → jaeger → inapp (+ graf datasource)
  { id: "e-bff-jaeger", source: "bff", target: "jaeger", label: "OTLP", plane: "traces", so: 0.5, to: 0.3, step: 0.5 },
  { id: "e-ags-jaeger", source: "ags", target: "jaeger", label: "OTLP", plane: "traces", so: 0.5, to: 0.7, step: 0.35 },
  { id: "e-jaeger-graf", source: "jaeger", target: "graf", label: "datasource", plane: "traces", so: 0.3, to: 0.75, step: 0.5 },
  { id: "e-jaeger-inapp", source: "jaeger", target: "inapp", label: "BFF proxy", plane: "traces", so: 0.7, to: 0.5, step: 0.5 },
  // Logs: bff→loki (push), cont→alloy→loki → mcpobs (+ graf datasource)
  { id: "e-bff-loki", source: "bff", target: "loki", label: "push", plane: "logs", so: 0.75, to: 0.3, step: 0.28 },
  { id: "e-cont-alloy", source: "cont", target: "alloy", label: "read", plane: "logs", so: 0.5, to: 0.7, step: 0.5 },
  { id: "e-alloy-loki", source: "alloy", target: "loki", label: "", plane: "logs", so: 0.5, to: 0.7, step: 0.5 },
  { id: "e-loki-graf", source: "loki", target: "graf", label: "datasource", plane: "logs", so: 0.3, to: 0.7, step: 0.45 },
  { id: "e-loki-mcpobs", source: "loki", target: "mcpobs", label: "query", plane: "logs", so: 0.7, to: 0.5, step: 0.5 },
];

// Walkthrough steps that map to a real surface link to it (new tab, so the
// walkthrough page stays open). Grafana is external on the compose stack (its
// own origin on :3000) and same-origin under /grafana in k8s — same split the
// side nav makes for grafanaUrl (AdminSideNav.jsx). The demo/run launcher
// routes through /dashboard with navigate state (AIAgent's use-case launcher
// consumes triggerText + useCaseId); the endpoint arms the use case's flags
// and returns the trigger text, so the chip runs as soon as the dashboard
// dock opens.
const GRAFANA_BASE = typeof window !== "undefined"
  && ["localhost", "127.0.0.1", "local.ping-devops.com"].includes(window.location.hostname)
  ? "http://localhost:3000"
  : "/grafana";
const GRAFANA_DASHBOARD = `${GRAFANA_BASE}/d/ai-demo-agent-observability/agent-observability-overview`;

const WALKTHROUGH = [
  {
    part: "Part 1 · Forensics — every action attributable",
    tone: "part1",
    steps: [
      { n: "1", title: "Sign in as customer", sub: "unified sign-in, device-first" },
      { n: "2", title: "Chip: “show my balance”", sub: "UC20 trigger → PERMIT", href: "/dashboard", launch: { useCaseId: "audit-trail", label: "Run UC20 — show my balance" } },
      { n: "3", title: "Evidence panels", sub: "Token Chain + Activity — act chain stamped", href: "/monitoring/token-chain" },
      { n: "4", title: "Transaction Trace", sub: "reconstruct any hop, incl. failures", href: "/transaction-trace" },
    ],
  },
  {
    part: "Part 2 · Ops — agent traffic is just a monitored service",
    tone: "part2",
    steps: [
      { n: "5", title: "Grafana overview", sub: "agent-observability dashboard, SSO in", href: GRAFANA_DASHBOARD, external: true },
      { n: "6", title: "Run UC6 → DENY", sub: "“transfer $2500 from checking to savings”", href: "/dashboard", launch: { useCaseId: "authz-denied", label: "Run UC6 — transfer $2500" } },
      { n: "7", title: "Panels react", sub: "DENY counters move within ~30s", href: GRAFANA_DASHBOARD, external: true },
      { n: "8", title: "Alert rules page", sub: "explained: ratios, not counts — 401s are normal", href: `${GRAFANA_BASE}/alerting/list`, external: true },
    ],
  },
];

// Vertical handle offsets: 4 lanes per side (top/quarter/center/bottom) as
// fractions of the node height. Edges pick a lane via sourceHandle/targetHandle
// so parallel flows fan out instead of overlapping.
const HANDLE_Y = [0.2, 0.4, 0.6, 0.8];

const nearestLane = (f) =>
  HANDLE_Y.reduce((best, y) => (Math.abs(y - f) < Math.abs(best - f) ? y : best), HANDLE_Y[0]);

const PlaneNode = memo(function PlaneNode({ data }) {
  return (
    <div className={`obs-node${data.dim ? " is-dim" : ""}`}>
      {HANDLE_Y.map((y) => (
        <Handle key={`l-${y}`} id={`l-${y}`} type="target" position={Position.Left} style={{ top: `${y * 100}%` }} />
      ))}
      <span className="obs-node__mark" aria-hidden="true">{data.mark}</span>
      <strong>{data.title}</strong>
      <span className="obs-node__sub">{data.sub}</span>
      <span className="obs-node__planes" aria-hidden="true">
        {data.planes.map((p) => (
          <i key={p} className={`obs-plane-dot obs-plane-dot--${p}`} title={p} />
        ))}
      </span>
      {HANDLE_Y.map((y) => (
        <Handle key={`r-${y}`} id={`r-${y}`} type="source" position={Position.Right} style={{ top: `${y * 100}%` }} />
      ))}
    </div>
  );
});

const BandNode = memo(function BandNode({ data }) {
  return <div className={`obs-band obs-band--${data.cls}`}>{data.label}</div>;
});

// Snap each edge's lane fraction to the nearest available handle lane.
export function withHandleLanes(edges) {
  return edges.map((e) => ({
    ...e,
    sourceHandle: `r-${nearestLane(parseFloat(String(e.sourceHandle).slice(2)))}`,
    targetHandle: `l-${nearestLane(parseFloat(String(e.targetHandle).slice(2)))}`,
  }));
}

const CAPTIONS = edgeCaptions(FLOW_EDGES, Object.fromEntries(FLOW_NODES.map((n) => [n.id, n.title])));

const NODE_TYPES = { plane: PlaneNode, band: BandNode };

// Swimlane headers: one per plane band, rendered as borderless label nodes.
const BAND_LABELS = [
  { id: "band-metrics", row: 0, label: "METRICS", cls: "band-metrics" },
  { id: "band-traces", row: 2, label: "TRACES", cls: "band-traces" },
  { id: "band-logs", row: 4, label: "LOGS", cls: "band-logs" },
];

const COL_X = [0, 400, 800];
// Layered bands: rows within a band are 100px apart; BAND_GAP inserts the
// larger jump between planes (row 1→2 and 3→4) so each plane reads as its own
// lane. 250px between bands = generous air, no cross-band line traffic.
const ROW_Y = [0, 100, 350, 450, 700];

/** Pure node builder — exported for tests. */
export function buildNodes(activePlane = "all") {
  const flowNodes = FLOW_NODES.map((n) => ({
    id: n.id,
    type: "plane",
    position: { x: COL_X[n.column] + 90, y: ROW_Y[n.row] },
    data: {
      mark: n.mark,
      title: n.title,
      sub: n.sub,
      planes: n.planes,
      dim: activePlane !== "all" && !n.planes.includes(activePlane),
    },
    selectable: false,
  }));
  const bands = BAND_LABELS.map((b) => ({
    id: b.id,
    type: "band",
    position: { x: -40, y: ROW_Y[b.row] + 20 },
    data: { label: b.label, cls: b.cls },
    selectable: false,
    focusable: false,
  }));
  return [...bands, ...flowNodes];
}

/** Pure edge builder — exported for tests. */
export function buildEdges(activePlane = "all") {
  return FLOW_EDGES.map((e) => ({
    ...e,
    type: "smoothstep",
    animated: false,
    // One marker per plane — SVG marker fills are presentation attributes and
    // cannot resolve CSS var(), so each def carries literal hexes for both
    // themes (ArrowDefs pairs them via CSS class rules). NOTE: @xyflow/react
    // wraps markerEnd in url() itself — pass the BARE id, or it emits the
    // malformed url('#url(#...)') and no arrowhead renders.
    markerEnd: `obs-arrow-${e.plane}`,
    // Lane offsets: the so/to fractions pick among the node's offset handles
    // (0/33/67/100%), so co-routed parallel edges fan out instead of drawing
    // on top of each other. `pathOptions.stepPosition` moves the vertical
    // segment's X per edge (the default midpoint bend makes every edge in a
    // column share one vertical channel and overlap).
    sourceHandle: `r-${e.so ?? 0.5}`,
    targetHandle: `l-${e.to ?? 0.5}`,
    pathOptions: { stepPosition: e.step ?? 0.5 },
    className: `obs-edge obs-edge--${e.plane}${activePlane !== "all" && e.plane !== activePlane ? " is-dim" : ""}`,
    label: e.label || undefined,
    labelStyle: { fontSize: 12, fill: "var(--th-text-muted)", fontWeight: 600 },
    labelBgStyle: { fill: "var(--th-bg-page)", fillOpacity: 0.95 },
    labelBgPadding: [4, 6],
    labelBgBorderRadius: 4,
    zIndex: 1,
  }));
}

// Arrowhead colors mirror the node borders in each theme (light: #c3cdd9,
// dark: #34405e). Selected by CSS class so the marker re-colors on theme flip.
function ArrowDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <defs>
        {PLANES.map((p) => (
          <marker
            key={p}
            id={`obs-arrow-${p}`}
            className={`obs-arrow obs-arrow--${p}`}
            markerWidth="9"
            markerHeight="9"
            refX="7.5"
            refY="4.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path className="obs-arrow__path" d="M0,0 L9,4.5 L0,9 z" />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

export default function ObservabilityDiagramPage() {
  const [view, setView] = useState("flow");
  const [plane, setPlane] = useState("all");
  const [launching, setLaunching] = useState(null);
  const navigate = useNavigate();
  const stepper = useDiagramStepper(FLOW_EDGES.length);
  const hot = FLOW_EDGES[stepper.step];
  const nodes = useMemo(() => markNodes(buildNodes(plane), hot ? [hot.source, hot.target] : []), [plane, hot]);
  const edges = useMemo(() => stepEdges(withHandleLanes(buildEdges(plane)), stepper.step), [plane, stepper.step]);
  const onPlane = useCallback((p) => setPlane(p), []);

  // Demo-step launcher: arm the use case's flags + trigger on the BFF, then
  // land on /dashboard with the launcher state AIAgent already consumes
  // (same shape AiAttacksPanel's catalog runner navigates with).
  const onLaunch = useCallback(async (step) => {
    if (launching) return;
    setLaunching(step.n);
    let triggerText = "";
    try {
      const res = await fetch("/api/use-cases/demo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ useCaseId: step.launch.useCaseId, vertical: "banking" }),
      });
      if (res.ok) {
        const data = await res.json();
        triggerText = data.triggerText || "";
      }
    } catch {
      // Fall through: the dashboard chip still runs from the plain trigger text.
    }
    navigate("/dashboard", {
      state: { useCaseId: step.launch.useCaseId, triggerText: triggerText || step.launch.label, type: "chip", vertical: "banking" },
    });
  }, [launching, navigate]);

  const { nodes: dragNodes, onNodesChange: onDragNodes } = useDraggableNodes(nodes);
  return (
    <div className="obs-page">
      <header className="obs-header">
        <div>
          <p className="obs-kicker">Observability demo</p>
          <h1>Agent telemetry, end to end</h1>
          <p className="obs-lede">
            What each service emits, which collector stores it, and which surface presents it —
            then the demo story that walks the same path.
          </p>
        </div>
        <span className="obs-mock-chip" title="The diagram maps the shipped stack; it does not query it live.">
          ILLUSTRATIVE — maps the shipped stack
        </span>
      </header>

      <div className="obs-tabs" role="tablist" aria-label="Diagram view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "flow"}
          className={view === "flow" ? "is-current" : ""}
          onClick={() => setView("flow")}
        >
          Telemetry data flow
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "walk"}
          className={view === "walk" ? "is-current" : ""}
          onClick={() => setView("walk")}
        >
          Demo walkthrough
        </button>
      </div>

      {view === "flow" ? (
        <>
          <div className="obs-planes" role="group" aria-label="Highlight a telemetry plane">
            <button type="button" aria-pressed={plane === "all"} onClick={() => onPlane("all")}>
              All planes
            </button>
            <button type="button" aria-pressed={plane === "metrics"} onClick={() => onPlane("metrics")}>
              <i className="obs-plane-dot obs-plane-dot--metrics" /> Metrics
            </button>
            <button type="button" aria-pressed={plane === "traces"} onClick={() => onPlane("traces")}>
              <i className="obs-plane-dot obs-plane-dot--traces" /> Traces
            </button>
            <button type="button" aria-pressed={plane === "logs"} onClick={() => onPlane("logs")}>
              <i className="obs-plane-dot obs-plane-dot--logs" /> Logs
            </button>
          </div>
          <DiagramStepBar stepper={stepper} caption={CAPTIONS[stepper.step]} testId="obs-steps" />
          <div className="obs-canvas">
            <ArrowDefs />
            <ReactFlow
              nodes={dragNodes}
              onNodesChange={onDragNodes}
              nodesDraggable
              edges={edges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              panOnScroll
              minZoom={0.4}
              maxZoom={1.4}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            </ReactFlow>
          </div>
          <div className="obs-legend">
            <span><i className="obs-plane-dot obs-plane-dot--metrics" /> Metrics — Prometheus scrape</span>
            <span><i className="obs-plane-dot obs-plane-dot--traces" /> Traces — OTLP → Jaeger</span>
            <span><i className="obs-plane-dot obs-plane-dot--logs" /> Logs — forwarder + Alloy → Loki</span>
          </div>
          <div className="obs-planes-note">
            The demo runs this for real: docker-compose profiles <code>observability</code> and
            <code> tracing</code> stand up every node here. The Grafana dashboard is
            <code> agent-observability-overview</code>; the presenter runbook is
            <code> docs/runbooks/observability-demo.md</code>.
          </div>
        </>
      ) : (
        <div className="obs-walk">
          {WALKTHROUGH.map((part) => (
            <section key={part.part} className={`obs-walk__part obs-walk__part--${part.tone}`}>
              <h2>{part.part}</h2>
              <ol>
                {part.steps.map((s) => {
                  const body = (
                    <>
                      <span className="obs-walk__num">
                        {s.n}
                        {s.href && <span className="obs-walk__arrow" aria-hidden="true"> ↗</span>}
                      </span>
                      <strong>{s.title}</strong>
                      <span className="obs-walk__sub">{s.sub}</span>
                      {s.launch && (
                        <span className="obs-walk__cta">{launching === s.n ? "Arming…" : "Run it"}</span>
                      )}
                    </>
                  );
                  const cls = `obs-walk__step${s.href ? " obs-walk__step--link" : ""}`;
                  if (s.launch) {
                    return (
                      <li key={s.n}>
                        <button type="button" className={cls} onClick={() => onLaunch(s)} disabled={launching === s.n}>
                          {body}
                        </button>
                      </li>
                    );
                  }
                  if (s.href) {
                    return (
                      <li key={s.n}>
                        <a className={cls} href={s.href} target="_blank" rel="noopener noreferrer">
                          {body}
                        </a>
                      </li>
                    );
                  }
                  return <li key={s.n}><div className={cls}>{body}</div></li>;
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
