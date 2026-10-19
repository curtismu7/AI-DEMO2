/**
 * StaticFlowDiagram — fixed-layout token flows drawn with React Flow.
 *
 * Props:
 *   NODES        [{ id, group, label, sub?: string[], x, y }]
 *   EDGES        [[srcId, tgtId, label?, opts?]] — opts: { dashed, color, vertical, lane }
 *                (vertical = leave the bottom of the source, enter the top of the target;
 *                lane = px: join the left sides of both cards with a curve bowed that far out to the
 *                left (negative = right sides, bowed right), so a long return arrow runs beside a
 *                column instead of through it).
 *                When both A→B and B→A exist, the second one's label sits below the shared line.
 *   GROUPS       { key: { label, bg } }
 *   selectedPath key of the currently highlighted path (dims others)
 *   onNodeClick  (node) => void — node = { id, data }
 *   testId       data-testid for the wrapper
 *   height       ignored (kept so pages need no edit): the canvas is as tall as the viewport leaves room for with the reel in view
 *   ariaLabel    accessible name for the diagram (role="group")
 *   stepper      a page-owned useDiagramStepper: the diagram follows it and shows the movie reel
 *   walk         a scripted walkthrough instead of one-arrow-per-step: [{ title, label, lines?, nodes: [ids],
 *                edges: [indexes into EDGES] }]. Each step rings its nodes and runs the dashed line along its
 *                edges; nodes from earlier steps stay softly marked. Gives the diagram its own Play/Step bar.
 *   details      node id -> text for the reel's details row (defaults to the node's own detail lines)
 *   step         index of the EDGES entry in focus for a Play/Step walkthrough
 *                (-1 = off): that arrow is accented, later ones fade. Leave it
 *                undefined and the diagram shows its own Play/Step bar; pass a
 *                number to drive it from the page instead
 *   focusId      node id to ring while a page-driven walkthrough is on
 *   pingStyle    OPT-IN (default false; every other page is unchanged). The Token Chain look and behaviour:
 *                light-grey canvas, thick black arrows (blue dashed), numbered orange badge on every arrow
 *                (words only for the active step or on hover), a key under the canvas, a step detail panel in the
 *                reel, click-a-box selection that jumps the stepper to the box's first arrow (into it, else out of it)
 *                and scrolls the reel + detail into view; a drag (>5px, or a click within 300ms of drag stop) is not a click.
 *   steps        the config's STEPS (only read with pingStyle). STEPS[i].detail = { form?, tokens?, refs? } feeds the
 *                reel's detail panel for EVERY arrow listed in STEPS[i].edges (edge indexes into EDGES): see withStepDetail
 *                in utils/diagramReel.js.
 *
 * Nodes keep their hand-placed x/y; React Flow supplies pan/zoom and fit-to-view.
 * Interaction: nodes are draggable so a presenter can nudge the layout clean;
 * connect stays off — these are teaching graphs, not editors. Drag is
 * view-only (positions reset on reload; nothing is saved).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useFitOnResize } from "../hooks/useFitOnResize";
import { useDraggableNodes } from "../hooks/useDraggableNodes";
import { edgeCaptions, useDiagramStepper } from "../hooks/useDiagramStepper";
import DiagramStepBar from "./DiagramStepBar";
import DiagramReel from "./DiagramReel";
import { buildNodeDetail, buildReelSteps, withStepDetail } from "../utils/diagramReel";
import { createRouter, labelPoint, pathFromPoints } from "../utils/orthoRoute";
import "./StaticFlowDiagram.css";

const NODE_W = 250;
// Layouts were hand-placed for 210px cards; spread them out in proportion so the larger text fits.
const SPREAD_X = 1.2;
const SPREAD_Y = 1.12;
// 13px bold label (~7.4px/char) and 12px detail lines (~6.6px/char) inside 250px minus padding.
const LABEL_CHARS = 29;
const SUB_CHARS = 33;
const wrapped = (text, per) => Math.max(1, Math.ceil(String(text).length / per));
const nodeH = (n) =>
  16 + wrapped(n.label, LABEL_CHARS) * 17 + (n.sub || []).reduce((h, s) => h + wrapped(s, SUB_CHARS) * 16, 0);

// The left gutter keeps the zoom buttons (bottom-left) off the cards.
const FIT = { padding: { top: "20px", right: "20px", bottom: "20px", left: "56px" } };
// pingStyle: routed arrows and their number badges run in the free border outside the outermost boxes, so leave room for them.
const FIT_PING = { padding: { top: "40px", right: "60px", bottom: "40px", left: "100px" } };
const HIDDEN = { opacity: 0, width: 1, height: 1 };

// Handle ids are sl/sr/sb (source) and tl/tr/tt (target): the second letter is the side of the box (l/r/b/t).
const handleDir = (id) => id[1];

// A coarser grid than the default 6px: parallel arrows that share a corridor sit cell/2 apart, so 20px keeps them visibly separate.
// A tight layout (gaps under about cell + 12px) cannot take that, so a layout with unplaceable arrows is retried on a finer grid.
const ROUTE_CELLS = [20, 16, 12];
const ROUTE_MARGIN = 60; // createRouter's grid starts `margin` before the outermost box; attach points are snapped onto its lines
const SLOT_INSET = 8; // keep arrows off the rounded corners of a card
const LABEL_GAP = 32; // min distance between two number badges
const LABEL_MIN_RUN = 28; // a badge sits on a straight run at least this long

// Where each routed arrow leaves / enters its box. Arrows that share a side of a box get their own slot along it
// (ordered by where the other end is, so fans do not cross) instead of all piling onto the side's midpoint. Slots lie on
// the router's grid lines so the first/last run needs no jog. The side itself is the config's handle side.
// Returns { edgeId: { start, end } }.
export function attachPoints(rects, edges, cell = ROUTE_CELLS[0]) {
  const all = Object.values(rects);
  if (!all.length) return {};
  const ox = Math.min(...all.map((r) => r.x)) - ROUTE_MARGIN;
  const oy = Math.min(...all.map((r) => r.y)) - ROUTE_MARGIN;
  const groups = new Map(); // "node:side" -> [{ id, role, other }]
  for (const e of edges) {
    const a = rects[e.source];
    const b = rects[e.target];
    if (e.data?.self || !a || !b) continue;
    for (const [role, node, side, other] of [["start", e.source, handleDir(e.sourceHandle), b], ["end", e.target, handleDir(e.targetHandle), a]]) {
      const k = `${node}:${side}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ id: e.id, role, node, side, other });
    }
  }
  const out = {};
  for (const list of groups.values()) {
    const { node, side } = list[0];
    const r = rects[node];
    const horiz = side === "l" || side === "r"; // arrows run along the side's y; top/bottom sides slot along x
    const [lo, hi] = horiz ? [r.y + SLOT_INSET, r.y + r.h - SLOT_INSET] : [r.x + SLOT_INSET, r.x + r.w - SLOT_INSET];
    const origin = horiz ? oy : ox;
    const slots = [];
    for (let v = origin + Math.ceil((lo - origin) / cell) * cell; v <= hi; v += cell) slots.push(v);
    const mid = horiz ? r.y + r.h / 2 : r.x + r.w / 2;
    if (!slots.length) slots.push(Math.round((origin + Math.round((mid - origin) / cell) * cell)));
    const centre = (o) => (horiz ? o.y + o.h / 2 : o.x + o.w / 2);
    const nearest = (want) => slots.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), slots[0]);
    list.sort((p, q) => centre(p.other) - centre(q.other));
    list.forEach((it, i) => {
      // one arrow on the side: aim at the other end's centre (so facing boxes line up); several: spread over the free slots
      // more arrows than grid lines on this side (a short card): spread them evenly over the side instead (their first run then sits off the grid; harmless)
      const v = list.length === 1 ? nearest(centre(it.other))
        : list.length > slots.length ? Math.round(lo + ((hi - lo) * i) / (list.length - 1))
          : slots[Math.round((i * (slots.length - 1)) / (list.length - 1))];
      const pt = horiz ? { x: side === "r" ? r.x + r.w : r.x, y: v } : { x: v, y: side === "b" ? r.y + r.h : r.y };
      (out[it.id] ||= {})[it.role] = pt;
    });
  }
  return out;
}

// Badge position: the longest run's midpoint, unless another badge is already there; then another run / another spot on it.
export function pickLabel(pts, placed) {
  const cands = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (len < LABEL_MIN_RUN) continue;
    for (const t of len >= 90 ? [0.5, 0.3, 0.7, 0.15, 0.85] : [0.5]) cands.push({ len, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  if (!cands.length) return labelPoint(pts);
  cands.sort((p, q) => q.len - p.len);
  const clear = (c) => placed.reduce((m, p) => Math.min(m, Math.hypot(p.x - c.x, p.y - c.y)), Infinity);
  const ok = cands.find((c) => clear(c) >= LABEL_GAP);
  const pick = ok || cands.reduce((best, c) => (clear(c) > clear(best) ? c : best), cands[0]);
  return { x: pick.x, y: pick.y };
}

// pingStyle routing: rects = { nodeId: {x,y,w,h} }, edges = React Flow edges (source, target, sourceHandle, targetHandle, data.self).
// Every box is an obstacle (the edge's own two too: the router's lead-in/out reaches the handle). Self-loops keep their curve.
// Returns { routes: { edgeId: {pts, ok, label} }, fallbacks } where fallbacks counts edges the router could not place.
export function routeEdges(rects, edges) {
  let best = null;
  for (const cell of ROUTE_CELLS) {
    const res = routeOnce(rects, edges, cell);
    if (!best || res.fallbacks < best.fallbacks) best = res;
    if (!best.fallbacks) break;
  }
  return best;
}

function routeOnce(rects, edges, cell) {
  const router = createRouter({ obstacles: Object.values(rects), cell, margin: ROUTE_MARGIN });
  const att = attachPoints(rects, edges, cell);
  const routes = {};
  const placed = [];
  let fallbacks = 0;
  for (const e of edges) {
    const a = rects[e.source];
    const b = rects[e.target];
    if (e.data?.self || !a || !b) continue;
    const sd = handleDir(e.sourceHandle);
    const td = handleDir(e.targetHandle);
    const r = router.route({ start: att[e.id].start, end: att[e.id].end, startDir: sd, endDir: td });
    if (r.ok) {
      r.label = pickLabel(r.pts, placed);
      placed.push(r.label);
    } else fallbacks += 1;
    routes[e.id] = r;
  }
  return { routes, fallbacks };
}

function FlowNode({ data }) {
  const { n, color, className, testId, onClick } = data;
  return (
    <div
      className={className}
      style={{ width: NODE_W, minHeight: nodeH(n), borderColor: color }}
      onClick={onClick}
      data-testid={`${testId}-node-${n.id}`}
    >
      <span className="sfd-node-stripe" style={{ background: color }} />
      <div className="sfd-node-label">{n.label}</div>
      {(n.sub || []).map((s, i) => (
        <div key={i} className="sfd-node-sub">{s}</div>
      ))}
      <Handle id="tl" type="target" position={Position.Left} style={HIDDEN} />
      <Handle id="tr" type="target" position={Position.Right} style={HIDDEN} />
      <Handle id="sl" type="source" position={Position.Left} style={HIDDEN} />
      <Handle id="sr" type="source" position={Position.Right} style={HIDDEN} />
      <Handle id="tt" type="target" position={Position.Top} style={HIDDEN} />
      <Handle id="sb" type="source" position={Position.Bottom} style={HIDDEN} />
    </div>
  );
}

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const { self, lane, ping, route } = data;
  const [hover, setHover] = useState(false);
  // Routed around the boxes when the router found a way; otherwise (or while a box is dragged) the old curve.
  const routed = ping && !self && route && route.ok;
  const rl = routed ? route.label || labelPoint(route.pts) : null;
  const [path, labelX, labelY] = routed
    ? [pathFromPoints(route.pts), rl.x, rl.y]
    : self
    ? [`M ${sourceX} ${sourceY} C ${sourceX + 60} ${sourceY}, ${sourceX + 60} ${sourceY + 30}, ${sourceX} ${sourceY + 30}`, sourceX + 55, sourceY + 15]
    : lane
      ? [`M ${sourceX} ${sourceY} C ${sourceX - lane} ${sourceY}, ${targetX - lane} ${targetY}, ${targetX} ${targetY}`, (sourceX + targetX) / 2 - lane * 0.75, (sourceY + targetY) / 2]
      : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  // pingStyle: the stroke comes from CSS (black / blue dashed), the number is always shown, the words only when active or hovered.
  const shown = ping && (data.active || hover);
  return (
    <g className={`${data.className}${ping && data.dashed ? " sfd-edge--dashed" : ""}`} onMouseEnter={ping ? () => setHover(true) : undefined} onMouseLeave={ping ? () => setHover(false) : undefined}>
      <BaseEdge
        id={id}
        path={path}
        markerEnd="url(#sfd-arrow)"
        style={ping ? { strokeDasharray: data.dashed ? "5 4" : undefined } : { stroke: data.color, strokeWidth: 1.5, strokeDasharray: data.dashed ? "5 4" : undefined }}
      />
      {ping ? (
        <EdgeLabelRenderer>
          <div
            className={`sfd-edge-label sfd-edge-label--ping nodrag nopan ${data.className}${shown ? " is-shown" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            data-testid={`sfd-edge-badge-${data.n}`}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            <span className="sfd-edge-num">{data.n}</span>
            {data.label && <span className="sfd-edge-text">{data.label}</span>}
          </div>
        </EdgeLabelRenderer>
      ) : data.label && (
        <EdgeLabelRenderer>
          <div
            className={`sfd-edge-label nodrag nopan ${data.className}`}
            style={{ transform: data.below ? `translate(-50%, 0) translate(${labelX}px, ${labelY + 2}px)` : `translate(-50%, -100%) translate(${labelX}px, ${labelY - 2}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

const nodeTypes = { sfd: FlowNode };
const edgeTypes = { sfd: FlowEdge };

function Inner({ NODES, EDGES, GROUPS, selectedPath, onNodeClick, testId, step, focusId, ariaLabel, walkStep, visited, pingStyle, selectedId }) {
  const ref = useRef(null);
  const lastDragEnd = useRef(0);
  const fit = pingStyle ? FIT_PING : FIT;
  useFitOnResize(ref, fit);
  const byId = useMemo(() => new Map(NODES.map((n) => [n.id, n])), [NODES]);
  const [dragging, setDragging] = useState(false);
  const nodeLookup = useStore((st) => st.nodeLookup);
  // React Flow clamps/moves boxes in place: subscribe to a string of their absolute boxes so a drop re-routes.
  const absKey = useStore((st) => {
    if (!pingStyle) return "";
    let k = "";
    for (const n of st.nodeLookup.values()) {
      const p = n.internals.positionAbsolute;
      k += `${n.id}:${Math.round(p.x)},${Math.round(p.y)},${Math.round(n.measured?.width ?? 0)},${Math.round(n.measured?.height ?? 0)}|`;
    }
    return k;
  });
  const stepEdge = step >= 0 ? EDGES[step] : null;

  const laidOut = useMemo(
    () =>
      NODES.map((n) => {
        const g = GROUPS[n.group] || {};
        const active = selectedPath && n.path === selectedPath;
        const dimmed = selectedPath && n.path && !active;
        const hot = (stepEdge && (stepEdge[0] === n.id || stepEdge[1] === n.id)) || focusId === n.id || (walkStep ? walkStep.nodes.includes(n.id) : false);
        const seen = !hot && visited ? visited.has(n.id) : false;
        return {
          id: n.id,
          type: "sfd",
          position: { x: n.x * SPREAD_X, y: n.y * SPREAD_Y },
          draggable: true,
          selectable: false,
          data: {
            n,
            color: g.bg || "var(--sfd-edge)",
            testId,
            className: `sfd-node${dimmed ? " dimmed" : ""}${hot ? " step-hot" : ""}${seen ? " step-seen" : ""}${pingStyle && selectedId === n.id ? " sfd-node--selected" : ""}`,
            onClick: () => {
              // The click that ends a drag is not a selection.
              if (pingStyle && Date.now() - lastDragEnd.current < 300) return;
              onNodeClick({ id: n.id, data: n });
            },
          },
        };
      }),
    [NODES, GROUPS, selectedPath, stepEdge, focusId, testId, onNodeClick, walkStep, visited, pingStyle, selectedId],
  );

  const { nodes, onNodesChange } = useDraggableNodes(laidOut);

  const edges = useMemo(
    () =>
      EDGES.flatMap(([src, tgt, label, opts = {}], i) => {
        const a = byId.get(src);
        const b = byId.get(tgt);
        if (!a || !b) return [];
        const self = src === tgt;
        const active =
          selectedPath && (a.path === selectedPath || b.path === selectedPath || opts.path === selectedPath);
        const dimmed = selectedPath && !active;
        const stepClass = walkStep
          ? walkStep.edges?.includes(i) ? " step-now" : ""
          : step < 0 ? "" : i === step ? " step-now" : i > step ? " step-future" : "";
        const forward = a.x < b.x;
        return [
          {
            id: `e${i}`,
            type: "sfd",
            source: src,
            target: tgt,
            sourceHandle: opts.vertical ? "sb" : opts.lane ? (opts.lane > 0 ? "sl" : "sr") : self || forward ? "sr" : "sl",
            targetHandle: opts.vertical ? "tt" : opts.lane ? (opts.lane > 0 ? "tl" : "tr") : self ? "tr" : forward ? "tl" : "tr",
            selectable: false,
            data: {
              label,
              self,
              lane: opts.lane,
              below: EDGES.some(([s, t], j) => j < i && s === tgt && t === src),
              dashed: opts.dashed,
              ping: pingStyle,
              n: i + 1,
              active: stepClass === " step-now",
              color: opts.color || "var(--sfd-edge)",
              className: `sfd-edge${dimmed ? " dimmed" : ""}${stepClass}`,
            },
          },
        ];
      }),
    [EDGES, byId, selectedPath, step, walkStep, pingStyle],
  );

  // pingStyle only: route every arrow around the boxes; re-run when a box lands, skip while one is dragged.
  const routing = useMemo(() => {
    if (!pingStyle || dragging) return { routes: {}, fallbacks: null };
    const rects = {};
    for (const n of nodeLookup.values()) {
      const p = n.internals.positionAbsolute;
      rects[n.id] = { x: p.x, y: p.y, w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? nodeH(n.data.n) };
    }
    return routeEdges(rects, edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pingStyle, dragging, absKey, edges]);
  const routedEdges = useMemo(
    () => (pingStyle ? edges.map((e) => ({ ...e, data: { ...e.data, route: routing.routes[e.id] } })) : edges),
    [pingStyle, edges, routing],
  );

  return (
    <div className={`sfd${pingStyle ? " sfd--ping" : ""}`} data-testid={testId} data-route-fallbacks={routing.fallbacks ?? undefined} ref={ref} role={ariaLabel ? "group" : undefined} aria-label={ariaLabel}>
      <svg width="0" height="0" aria-hidden="true" className="sfd-defs">
        <defs>
          <marker id="sfd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="sfd-arrow" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={routedEdges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={fit}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable
        // pingStyle: a small wiggle is still a click; only a deliberate drag (past 5px) is a drag.
        nodeDragThreshold={pingStyle ? 5 : undefined}
        onNodeDragStart={pingStyle ? () => setDragging(true) : undefined}
        onNodeDragStop={() => { lastDragEnd.current = Date.now(); setDragging(false); }}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function StaticFlowDiagram({
  NODES,
  EDGES,
  GROUPS,
  selectedPath = null,
  onNodeClick,
  testId = "static-flow-diagram",
  step,
  stepper,
  walk,
  details,
  focusId,
  ariaLabel,
  pingStyle = false,
  steps,
}) {
  const controlled = step !== undefined;
  const own = useDiagramStepper(stepper || controlled ? 0 : walk ? walk.length : EDGES.length);
  // `stepper` lets a page that owns the walkthrough still get the movie reel; a bare `step`
  // number only paints the diagram (no reel). With neither, the diagram runs itself.
  const driver = stepper || (controlled ? null : own);
  const stepValue = walk ? -1 : stepper ? stepper.step : controlled ? step : own.step;
  const walkStep = walk && driver && driver.step >= 0 ? walk[driver.step] : null;
  const visited = useMemo(() => {
    if (!walk || !driver || driver.step <= 0) return null;
    return new Set(walk.slice(0, driver.step).flatMap((w) => w.nodes));
  }, [walk, driver]);
  const captions = useMemo(
    () => (walk ? walk.map((w) => `${w.title}${w.label ? ` — ${w.label}` : ""}`) : edgeCaptions(EDGES, Object.fromEntries(NODES.map((n) => [n.id, n.label])))),
    [walk, NODES, EDGES],
  );
  const reelSteps = useMemo(() => {
    if (!driver) return [];
    if (walk) return walk.map((w, i) => ({ n: i + 1, from: "", to: "", title: w.title, label: w.label || "", lines: w.lines || [] }));
    const base = buildReelSteps({ edges: EDGES, nodes: NODES, details });
    return pingStyle ? withStepDetail(base, steps) : base;
  }, [driver, walk, EDGES, NODES, details, pingStyle, steps]);
  const [nodeDetail, setNodeDetail] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [openKey, setOpenKey] = useState(0);
  const reelRef = useRef(null);
  const dstep = driver ? driver.step : -1;
  // pingStyle: moving the stepper/reel selects that step's box, unless the selected box is already part of the step.
  useEffect(() => {
    if (!pingStyle || walk || dstep < 0 || !EDGES[dstep]) return;
    const [from, to] = EDGES[dstep];
    setSelectedId((cur) => (cur === from || cur === to ? cur : to));
  }, [pingStyle, walk, dstep, EDGES]);
  // pingStyle: a box click selects it, jumps the stepper to its first arrow (into it, else out of it),
  // opens that step's detail and scrolls the reel + detail into view.
  const pickNode = useCallback(
    (node) => {
      setSelectedId(node.id);
      const into = EDGES.findIndex((e) => e[1] === node.id);
      const i = into >= 0 ? into : EDGES.findIndex((e) => e[0] === node.id);
      if (driver && !walk && i >= 0) {
        driver.goTo(i);
        setNodeDetail(null);
        setOpenKey((k) => k + 1);
      } else if (driver) setNodeDetail(buildNodeDetail(NODES.find((n) => n.id === node.id), details));
      requestAnimationFrame(() => {
        const el = reelRef.current;
        (el?.querySelector(".dreel-detail") || el)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      });
    },
    [EDGES, NODES, details, driver, walk],
  );
  // A page that handles node clicks itself keeps its own panel; otherwise the details row shows the node.
  const handleNodeClick = useCallback(
    (node) => {
      if (pingStyle) {
        pickNode(node);
        if (onNodeClick) onNodeClick(node);
      } else if (onNodeClick) onNodeClick(node);
      else if (driver) setNodeDetail(buildNodeDetail(NODES.find((n) => n.id === node.id), details));
    },
    [pingStyle, pickNode, onNodeClick, driver, NODES, details],
  );
  return (
    <>
      {!stepper && !controlled && <DiagramStepBar stepper={own} caption={captions[own.step]} testId={`${testId}-steps`} />}
      <ReactFlowProvider>
        <Inner
          NODES={NODES}
          EDGES={EDGES}
          GROUPS={GROUPS}
          selectedPath={selectedPath}
          onNodeClick={handleNodeClick}
          testId={testId}
          step={stepValue}
          focusId={focusId}
          ariaLabel={ariaLabel}
          walkStep={walkStep}
          visited={visited}
          pingStyle={pingStyle}
          selectedId={selectedId}
        />
      </ReactFlowProvider>
      {pingStyle && (
        <ul className="sfd-ping-key" aria-label="Arrow key">
          <li><b className="sfd-edge-num">n</b>arrow = step n in the walkthrough</li>
          <li><i className="sfd-key-line" />solid = request</li>
          <li><i className="sfd-key-line sfd-key-line--dashed" />dashed = token or decision</li>
        </ul>
      )}
      {driver && (
        <div ref={reelRef}>
          <DiagramReel steps={reelSteps} stepper={driver} nodeDetail={nodeDetail} onClearNode={() => setNodeDetail(null)} openKey={openKey} testId={`${testId}-reel`} />
        </div>
      )}
    </>
  );
}
