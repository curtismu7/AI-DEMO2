/**
 * PingSlideFlow: a ReactFlow canvas drawn in the look of the Ping deck slides (light slide, red marks,
 * Ping logo boxes, black number badges, dashed Agent Gateway). Boxes drag; the page owns the stepper.
 *
 * Props:
 *   config  { title, subtitle, nodes, edges }
 *     node: { id, kind: ping|user|robot|servers|boundary|gateway|text, x, y, w?, h?, label?, sub?, badge?, mcp? }
 *     edge: { from, to, fs, ts, n?, label?, sub?, dashed?, off?, step, at? }   fs/ts = handle side l|r|t|b|lt
 *   step    0 = idle (all drawn), 1..N = walkthrough step (edges whose `step` matches are animated)
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, Position, ReactFlow, ReactFlowProvider, Controls, useReactFlow, useStore, useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useFitOnResize } from "../hooks/useFitOnResize";
import { useDraggableNodes } from "../hooks/useDraggableNodes";
import { pathFromPoints, labelPoint } from "../utils/orthoRoute";
import { isObstacle, routeSlideEdges } from "./pingSlideRouting";
import "./PingSlideFlow.css";

const SIDE = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom, lt: Position.Left };
const HIDDEN = { opacity: 0, width: 1, height: 1 };
// left gutter keeps the zoom buttons (bottom-left) off the cards
const FIT = { padding: { top: '12px', right: '12px', bottom: '12px', left: '60px' } };

function Handles({ gateway }) {
  return (
    <>
      {["l", "r", "t", "b"].map((k) => (
        <React.Fragment key={k}>
          <Handle id={`s-${k}`} type="source" position={SIDE[k]} style={HIDDEN} />
          <Handle id={`t-${k}`} type="target" position={SIDE[k]} style={HIDDEN} />
        </React.Fragment>
      ))}
      {gateway && <Handle id="s-lt" type="source" position={Position.Left} style={{ ...HIDDEN, top: 31 }} />}
    </>
  );
}

const Badge = ({ children }) => <span className="ps-badge">{children}</span>;
const lines = (t) => String(t || "").split("\n").map((s, i) => <div key={i}>{s}</div>);

function PersonIcon() {
  return (
    <svg viewBox="0 0 80 80" className="ps-ico" aria-hidden="true">
      <circle cx="40" cy="30" r="12" />
      <path d="M16,66 q24,-34 48,0" />
    </svg>
  );
}
function RobotIcon() {
  return (
    <svg viewBox="0 0 80 80" className="ps-ico" aria-hidden="true">
      <line x1="40" y1="8" x2="40" y2="18" /><circle cx="40" cy="8" r="4" />
      <rect x="14" y="18" width="52" height="40" rx="9" />
      <circle cx="30" cy="36" r="5" /><circle cx="50" cy="36" r="5" />
      <path d="M30,48 q10,6 20,0" /><path d="M26,58 l-4,10 10,-6" />
    </svg>
  );
}
function ServerIcon() {
  return (
    <svg viewBox="0 0 60 50" className="ps-ico ps-ico--sm" aria-hidden="true">
      {[0, 17, 34].map((y) => (
        <g key={y}><rect x="2" y={y + 1} width="56" height="14" /><circle cx="12" cy={y + 8} r="2" className="ps-fill" /><line x1="22" y1={y + 8} x2="50" y2={y + 8} /></g>
      ))}
    </svg>
  );
}

function SlideNode({ data }) {
  const { n } = data;
  const { kind, w, h, label, sub, badge } = n;
  const ring = data.hot ? " ps-hot" : "";
  let body;
  if (kind === "ping") {
    body = (
      <>
        <div className="ps-head">{lines(label)}</div>
        <img src="/branding/ping-logo.png" alt="Ping Identity" className="ps-logo" draggable={false} />
      </>
    );
  } else if (kind === "user") {
    body = <div className={`ps-user${ring}`} style={{ width: w, height: h }}><PersonIcon /></div>;
  } else if (kind === "robot") {
    body = (
      <>
        <div className={`ps-robot${ring}`} style={{ width: w, height: h }}><RobotIcon /></div>
        <div className="ps-cap" style={{ width: w }}>
          {badge && <Badge>{badge}</Badge>}
          <div><b>{label}</b>{sub && lines(sub)}</div>
        </div>
      </>
    );
  } else if (kind === "servers") {
    body = (
      <div className={`ps-server${ring}`}>
        <div className="ps-server-icon">{n.mcp && <span className="ps-mcp">MCP</span>}<ServerIcon /></div>
        <div className="ps-server-text">{label}{sub && <small>{lines(sub)}</small>}</div>
      </div>
    );
  } else if (kind === "redbox") {
    body = (
      <div className={`ps-redbox${ring}`} style={{ width: w, height: h }}>
        <b>{label}</b>{sub && <small>{sub}</small>}
      </div>
    );
  } else if (kind === "win") {
    body = (
      <div className={`ps-win${n.dashed ? " ps-win--dashed" : ""}${ring}`} style={{ width: w, height: h }}>
        <i aria-hidden="true">•••</i><b>{label}</b>{sub && <small>{sub}</small>}
      </div>
    );
  } else if (kind === "grey") {
    body = (
      <div className={`ps-grey${ring}`} style={{ width: w, height: h }}>
        <b>{label}</b>{sub && <small>{sub}</small>}
      </div>
    );
  } else if (kind === "redbar") {
    body = (
      <div className={`ps-redbar${ring}`} style={{ width: w, height: h }}>
        <span><b>{label}</b><small>{sub}</small></span>
      </div>
    );
  } else if (kind === "agents") {
    body = (
      <div className={`ps-agents${ring}`} style={{ width: w, height: h }}>
        <b>{label}</b>
        {(n.items || []).map((it) => <span key={it}>{it}</span>)}
      </div>
    );
  } else if (kind === "card" || kind === "dashedcard") {
    body = (
      <div className={`ps-card${kind === "dashedcard" ? " ps-card--dashed" : ""}${n.top ? " ps-card--top" : ""}${ring}`} style={{ width: w, height: h }}>
        <b>{label}</b>{sub && <small>{lines(sub)}</small>}
      </div>
    );
  } else if (kind === "redcard") {
    body = (
      <div className={`ps-redcard${ring}`} style={{ width: w, height: h }}>
        <b>{label}</b>{sub && <small>{lines(sub)}</small>}
        {(n.items || []).length > 0 && <ul>{n.items.map((it) => <li key={it}>{it}</li>)}</ul>}
      </div>
    );
  } else if (kind === "panel") {
    body = <div className="ps-panel" style={{ width: w, height: h }}><small>{label}</small></div>;
  } else if (kind === "chevron") {
    body = <div className={`ps-chevron${ring}`} style={{ width: w, height: h }}>{label}</div>;
  } else if (kind === "numcard") {
    body = (
      <div className={`ps-numcard${ring}`} style={{ width: w, height: h }}>
        <span className="ps-num">{n.num}</span>
        <b>{label}</b>
        <p>{sub}</p>
      </div>
    );
  } else if (kind === "zone") {
    body = <div className="ps-zone" style={{ width: w, height: h }}><small>{label}</small></div>;
  } else if (kind === "boundary") {
    body = <div className="ps-boundary" style={{ width: w, height: h }}><span>Trust Boundary</span></div>;
  } else if (kind === "gateway") {
    body = (
      <div className={`ps-gateway${ring}`} style={{ width: w, height: h }}>
        <img src="/branding/ping-logo.png" alt="Ping Identity" className="ps-logo" draggable={false} />
        <span>{label}</span>
      </div>
    );
  } else {
    body = <div className="ps-text">{lines(label)}</div>;
  }
  return (
    <div className={`ps-node${data.dim ? " ps-dim" : ""}`}>
      {body}
      <Handles gateway={kind === "gateway"} />
    </div>
  );
}

function SlideEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const { off = 0, dashed, state, n, label, sub, at, dx = 0, dy = 0, route } = data;
  const horiz = (p) => p === Position.Left || p === Position.Right;
  const sx = sourceX + (horiz(sourcePosition) ? 0 : off);
  const sy = sourceY + (horiz(sourcePosition) ? off : 0);
  const tx = targetX + (horiz(targetPosition) ? 0 : off);
  const ty = targetY + (horiz(targetPosition) ? off : 0);
  const [path, mx, my] = getSmoothStepPath({
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition, targetPosition, borderRadius: 0, offset: 24,
  });
  // Routed around the boxes when the router found a way; otherwise (or while a box is being dragged) the smooth-step path.
  const routed = route && route.ok;
  const lp = routed ? labelPoint(route.pts) : { x: mx, y: my };
  const lx = (at === "end" ? tx - 24 : lp.x) + dx;
  const ly = (at === "end" ? ty - 8 : lp.y) + dy;
  const tr = at === "end" ? "translate(-100%, -100%)" : "translate(-50%, -50%)";
  const hot = state === "now";
  return (
    <g className={`ps-edge ps-edge--${state}${data.deny ? " ps-edge--deny" : ""}`}>
      <BaseEdge path={routed ? pathFromPoints(route.pts, 0) : path} markerEnd={`url(#ps-arrow${hot ? "-hot" : ""})`} markerStart={data.both ? `url(#ps-arrow${hot ? "-hot" : ""})` : undefined} style={{ strokeDasharray: dashed ? "5 4" : undefined }} />
      {(label || n) && (
        <EdgeLabelRenderer>
          <div className={`ps-elabel nodrag nopan ps-edge--${state}`} style={{ transform: `${tr} translate(${lx}px, ${ly}px)` }}>
            {n && <Badge>{n}</Badge>}
            <div><b>{label}</b>{sub && <small>{sub}</small>}</div>
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

// The app zooms the whole page for the font-size setting (document.documentElement.style.zoom). ReactFlow
// divides DOM rects by its own viewport scale only, so under a page zoom every handle lands that much too
// far out. Cancel the zoom inside the canvas (and widen it to compensate) so measurement is true.
function useRootZoom() {
  const read = () => parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const [k, setK] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setK(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => mo.disconnect();
  }, []);
  return k;
}

const nodeTypes = { ps: SlideNode };
const edgeTypes = { ps: SlideEdge };

function Inner({ config, step }) {
  const ref = useRef(null);
  const k = useRootZoom();
  useFitOnResize(ref, FIT);
  // Handles are measured on first paint, before web fonts / card CSS settle; re-measure so arrows meet the box edges.
  const updateInternals = useUpdateNodeInternals();
  const { fitView } = useReactFlow();
  useEffect(() => {
    const ids = config.nodes.map((n) => n.id);
    const t = [60, 400, 1200].map((ms) => setTimeout(() => { updateInternals(ids); fitView(FIT); }, ms));
    return () => t.forEach(clearTimeout);
  }, [config, updateInternals, fitView]);
  const active = useMemo(() => {
    const ids = new Set();
    if (step > 0) config.edges.forEach((e) => { if (e.step === step) { ids.add(e.from); ids.add(e.to); } });
    return ids;
  }, [config, step]);

  const laidOut = useMemo(
    () => config.nodes.map((n) => ({
      id: n.id,
      type: "ps",
      position: { x: n.x, y: n.y },
      draggable: !["text", "zone", "panel"].includes(n.kind),
      selectable: false,
      data: {
        n,
        hot: active.has(n.id) || (step > 0 && !!n.steps?.includes(step)),
        dim: step > 0 && !!n.steps && !n.steps.includes(step),
      },
      zIndex: ["boundary", "zone", "panel"].includes(n.kind) ? 0 : 1,
    })),
    [config, active, step],
  );
  const { nodes, onNodesChange } = useDraggableNodes(laidOut);

  // Routes come from the real boxes (React Flow's absolute positions and measured sizes) and are recomputed when a
  // box lands; while one is being dragged the cheap smooth-step path is drawn. Zones/panels/boundary/text are not obstacles.
  const [dragging, setDragging] = useState(false);
  const nodeLookup = useStore((st) => st.nodeLookup);
  const absKey = useStore((st) => {
    let k = "";
    for (const n of st.nodeLookup.values()) {
      if (isObstacle(n.data.n)) k += `${n.id}:${Math.round(n.internals.positionAbsolute.x)},${Math.round(n.internals.positionAbsolute.y)},${n.measured?.width ?? ""},${n.measured?.height ?? ""}|`;
    }
    return k;
  });
  const routing = useMemo(() => {
    if (dragging) return { routes: {}, fallbacks: null };
    const rects = {};
    for (const n of nodeLookup.values()) {
      const p = n.internals.positionAbsolute;
      if (!n.measured?.width || !n.measured?.height) { if (isObstacle(n.data.n)) return { routes: {}, fallbacks: null }; continue; }
      rects[n.id] = { x: p.x, y: p.y, w: n.measured.width, h: n.measured.height, kind: n.data.n.kind };
    }
    return routeSlideEdges(config.edges, rects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absKey, dragging, config]);

  const edges = useMemo(
    () => config.edges.map((e, i) => ({
      id: `e${i}`,
      type: "ps",
      source: e.from,
      target: e.to,
      sourceHandle: `s-${e.fs}`,
      targetHandle: `t-${e.ts}`,
      selectable: false,
      zIndex: 2,
      data: { ...e, route: routing.routes[`e${i}`], state: step === 0 ? "idle" : e.step === step ? "now" : e.step < step ? "past" : "future" },
    })),
    [config, step, routing],
  );

  return (
    <div className="ps-canvas" ref={ref} role="group" aria-label={config.title} data-route-fallbacks={routing.fallbacks ?? undefined} style={{ ...(config.aspect ? { aspectRatio: config.aspect } : {}), ...(k !== 1 ? { zoom: 1 / k } : {}) }}>
      <svg width="0" height="0" aria-hidden="true" className="ps-defs">
        <defs>
          <marker id="ps-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="ps-ah" /></marker>
          <marker id="ps-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="ps-ah-hot" /></marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStart={() => setDragging(true)}
        onNodeDragStop={() => setDragging(false)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={FIT}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function PingSlideFlow({ config, step = 0 }) {
  return (
    <div className={`ps-slide${config.dark ? " ps-slide--dark" : ""}`} data-testid="ping-slide-flow">
      <header className="ps-title">
        <h2><strong>{config.title}</strong> {config.subtitle}</h2>
        <img src="/branding/ping-logo.png" alt="Ping Identity" className="ps-title-logo" />
      </header>
      <ReactFlowProvider>
        <Inner config={config} step={step} />
      </ReactFlowProvider>
    </div>
  );
}
