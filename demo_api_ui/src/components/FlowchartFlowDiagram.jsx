import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import DiagramStepBar from "./DiagramStepBar";
import { getElk } from "../utils/elkLayout";
import { parseFlowchart } from "../utils/parseFlowchart";
import { markEdges, markNodes, stepEdges, useDiagramStepper } from "../hooks/useDiagramStepper";
import DiagramReel from "./DiagramReel";
import { buildNodeDetail, buildReelSteps } from "../utils/diagramReel";
import { useFitOnResize } from "../hooks/useFitOnResize";
import "./FlowchartFlowDiagram.css";
import { useDraggableNodes } from '../hooks/useDraggableNodes';

/**
 * FlowchartFlowDiagram — a Mermaid `flowchart` (nested subgraphs, labelled edges, classDef
 * colours) drawn with React Flow and laid out by ELK. Edges in source order are the
 * Play/Step steps.
 */

const FIT = { padding: 0.04 };
let layoutSeq = 0;
const HIDDEN = { opacity: 0, width: 1, height: 1 };
const CHAR_W = 7;
const LINE_H = 17;
const GROUP_PAD = 16;
const GROUP_HEADER = 28;
const FOLLOW_ZOOM = 0.9;
const NO_REF = { current: null };

const sizeOf = (label) => {
  const lines = label.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  return { width: Math.min(320, Math.max(140, Math.ceil(longest * CHAR_W) + 28)), height: lines.length * LINE_H + 16 };
};

function FNode({ data }) {
  return (
    <div className={`fcd-node fcd-node--${data.shape}`} style={data.style}>
      {data.label}
      <Handle type="target" position={Position.Top} style={HIDDEN} />
      <Handle type="source" position={Position.Bottom} style={HIDDEN} />
    </div>
  );
}
function FGroup({ data }) {
  return (
    <div className="fcd-group" style={data.style}>
      <span className="fcd-group__label">{data.label}</span>
      <Handle type="target" position={Position.Top} style={HIDDEN} />
      <Handle type="source" position={Position.Bottom} style={HIDDEN} />
    </div>
  );
}
const nodeTypes = { fnode: FNode, fgroup: FGroup };

// ---- Ping style (opt-in via `pingStyle`): Ping palette, thick numbered arrows, select + sync ----
const TONES = {
  red: { bg: "#b5231a", border: "#b5231a", color: "#ffffff" },
  dark: { bg: "#151a24", border: "#3a4256", color: "#f2f2f4" },
  grey: { bg: "#5a5f69", border: "#5a5f69", color: "#ffffff" },
};
// red = Ping products, identity, gateway and authorization; grey = safety and step-up; everything else is a dark card
const RED_IDS = new Set(["PingOneCloud", "PingOneAuthorize", "Gateway", "PingGW", "AuthzMock"]);
const GREY_IDS = new Set(["Gates", "StepUpGate", "AuthorizeGate", "HITLSvc", "CibaRoutes"]);
const toneOf = (id, parentOf) => {
  for (let cur = id; cur; cur = parentOf[cur]) {
    if (RED_IDS.has(cur)) return TONES.red;
    if (GREY_IDS.has(cur)) return TONES.grey;
  }
  return TONES.dark;
};
const LINE_BLACK = "#111111";
const LINE_BLUE = "#1f5fbf";
const DRAG_THRESHOLD = 5; // px: a wiggle is still a click
const CLICK_AFTER_DRAG_MS = 300; // the click that ends a drag is not a selection

/** Ping-style edge: thick path with an orange step-number badge; the words show for the active step or on hover. */
function PingEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={8} />
      <EdgeLabelRenderer>
        <div
          className={`pfd-edge-label nodrag nopan${data?.active ? " is-active" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <span className="pfd-edge-num">{data?.n}</span>
          {data?.label && <span className="pfd-edge-text">{data.label}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
const pingEdgeTypes = { pfdEdge: PingEdge };

function PingLegend() {
  return (
    <div className="pfd-legend" aria-label="Legend" data-testid="pfd-legend">
      <span><i className="pfd-sw pfd-sw--ping" />Ping product, identity, gateway, authorization</span>
      <span><i className="pfd-sw pfd-sw--app" />Your app, agent or service</span>
      <span><i className="pfd-sw pfd-sw--safety" />Step-up and safety</span>
      <span><b className="pfd-num-key">n</b>arrow = step n in the step bar and the movie reel</span>
      <span><i className="pfd-line" />solid = a call that has run</span>
      <span><i className="pfd-line pfd-line--dashed" />dashed (blue) = a step not reached yet, or an optional / fallback hop</span>
    </div>
  );
}

const colourStyle = (def) =>
  def
    ? {
        background: def.fill,
        borderColor: def.stroke,
        color: def.color,
        borderStyle: def.dashed ? "dashed" : undefined,
      }
    : undefined;

/** Lay the parsed flowchart out with ELK; returns React Flow nodes/edges and the step captions. */
export async function layoutFlowchart(model) {
  const { groups, nodes, edges, classDefs, classOf, styles = {} } = model;
  const children = new Map();
  const add = (parent, child) => {
    const key = parent || "__root";
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(child);
  };
  groups.forEach((g) => add(g.parent, { kind: "group", ...g }));
  nodes.forEach((n) => add(n.parent, { kind: "node", ...n }));

  const toElk = (item) => {
    if (item.kind === "node") return { id: item.id, ...sizeOf(item.label) };
    return {
      id: item.id,
      layoutOptions: {
        "elk.padding": `[top=${GROUP_HEADER + GROUP_PAD / 2},left=${GROUP_PAD},bottom=${GROUP_PAD},right=${GROUP_PAD}]`,
      },
      children: (children.get(item.id) || []).map(toElk),
    };
  };
  const known = new Set([...groups.map((g) => g.id), ...nodes.map((n) => n.id)]);
  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "36",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.padding": "[top=12,left=12,bottom=12,right=12]",
    },
    children: (children.get("__root") || []).map(toElk),
    edges: edges
      .filter((e) => known.has(e.from) && known.has(e.to))
      .map((e, i) => ({ id: `fe${i}`, sources: [e.from], targets: [e.to] })),
  };
  const laid = await (await getElk()).layout(elkGraph);

  const rfNodes = [];
  const walk = (elkNode, parentId) => {
    (elkNode.children || []).forEach((c) => {
      const group = groups.find((g) => g.id === c.id);
      const node = group ? null : nodes.find((n) => n.id === c.id);
      const style = colourStyle({ ...classDefs[classOf[c.id]], ...Object.fromEntries(Object.entries(styles[c.id] || {}).filter(([, v]) => v !== undefined)) });
      rfNodes.push({
        id: c.id,
        type: group ? "fgroup" : "fnode",
        position: { x: c.x, y: c.y },
        ...(parentId ? { parentId } : {}),
        data: group ? { label: group.label, style } : { label: node.label, shape: node.shape, style },
        ...(group ? { style: { width: c.width, height: c.height }, zIndex: 0 } : { zIndex: 1 }),
        selectable: false,
      });
      if (group) walk(c, c.id);
    });
  };
  walk(laid, null);

  const label = Object.fromEntries([...groups, ...nodes].map((x) => [x.id, x.label.split("\n")[0]]));
  const usable = edges.filter((e) => known.has(e.from) && known.has(e.to));
  const rfEdges = usable.map((e, i) => ({
    id: `fe${i}`,
    source: e.from,
    target: e.to,
    type: "smoothstep",
    label: e.label ? e.label.replace(/\n/g, " · ") : undefined,
    markerEnd: { type: "arrowclosed", width: 14, height: 14 },
    style: e.dashed ? { strokeDasharray: "6 4" } : undefined,
    zIndex: 2,
    selectable: false,
  }));
  const steps = usable.map((e) => `${label[e.from]} → ${label[e.to]}${e.label ? `: ${e.label.replace(/\n/g, " ")}` : ""}`);
  // For the movie reel: arrows in walk order, and every node/group with its own detail lines.
  const reelEdges = usable.map((e) => [e.from, e.to, e.label]);
  const reelNodes = [...groups, ...nodes].map((x) => {
    const [head, ...rest] = x.label.split("\n");
    return { id: x.id, label: head, sub: rest };
  });
  layoutSeq += 1;
  return { id: layoutSeq, nodes: rfNodes, edges: rfEdges, steps, reelEdges, reelNodes };
}

function Inner({ source, testId, step, active, details, followSteps, pingStyle, enrichStep }) {
  const ref = useRef(null);
  // followSteps keeps its own viewport; a refit would throw the reader back to the unreadable overview.
  useFitOnResize(followSteps ? NO_REF : ref, FIT);
  const { setCenter, getInternalNode } = useReactFlow();
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    layoutFlowchart(parseFlowchart(source))
      .then((f) => {
        if (!cancelled) setFlow(f);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Layout failed");
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const stepper = useDiagramStepper(flow ? flow.steps.length : 0);
  const driven = step !== undefined || active !== undefined;
  const shown = useMemo(() => {
    if (!flow) return [];
    if (active !== undefined) return markEdges(flow.edges, active);
    return stepEdges(flow.edges, step !== undefined ? step : stepper.step);
  }, [flow, stepper.step, step, active]);

  const reelSteps = useMemo(() => {
    if (!flow || driven) return [];
    const base = buildReelSteps({ edges: flow.reelEdges, nodes: flow.reelNodes, details });
    return enrichStep ? base.map(enrichStep) : base;
  }, [flow, driven, details, enrichStep]);
  const [nodeDetail, setNodeDetail] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null); // box detail opens only on an explicit click, never from the stepper
  const [openKey, setOpenKey] = useState(0);
  const reelRef = useRef(null);
  const lastDragEnd = useRef(0);
  const current = reelSteps[stepper.step];
  const parentOf = useMemo(() => Object.fromEntries((flow?.nodes || []).filter((n) => n.parentId).map((n) => [n.id, n.parentId])), [flow]);
  const lit = useMemo(() => {
    if (!flow) return [];
    const hot = markNodes(flow.nodes, current ? [current.from, current.to] : []);
    if (!pingStyle) return hot;
    return hot.map((n) => {
      const tone = toneOf(n.id, parentOf);
      const style = { ...n.data.style, background: n.type === "fgroup" ? `${tone.bg}14` : tone.bg, borderColor: tone.border, color: tone.color };
      return { ...n, className: `${n.className ? `${n.className} ` : ""}${n.id === selectedId ? "pfd-selected" : ""}`.trim(), data: { ...n.data, style } };
    });
  }, [flow, current, pingStyle, parentOf, selectedId]);
  const onNodeClick = (_, node) => {
    if (driven || !flow) return;
    if (!pingStyle) {
      setNodeDetail(buildNodeDetail(flow.reelNodes.find((x) => x.id === node.id), details));
      return;
    }
    // The click that ends a drag is not a selection.
    if (Date.now() - lastDragEnd.current < CLICK_AFTER_DRAG_MS) return;
    setSelectedId(node.id);
    setDetailId(node.id);
    // Jump the reel and step bar to this box's first arrow (into it, else out of it), then bring them into view.
    const into = flow.reelEdges.findIndex((e) => e[1] === node.id);
    const out = flow.reelEdges.findIndex((e) => e[0] === node.id);
    if (into >= 0 || out >= 0) {
      stepper.goTo(into >= 0 ? into : out);
      setOpenKey((k) => k + 1);
    }
    requestAnimationFrame(() => reelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
  };
  // Moving the reel or the step bar selects that step's box, unless the box already selected is part of the step.
  useEffect(() => {
    if (!pingStyle || stepper.step < 0 || !flow) return;
    const [from, to] = flow.reelEdges[stepper.step] || [];
    if (to) setSelectedId((cur) => (cur === from || cur === to ? cur : to));
  }, [pingStyle, stepper.step, flow]);
  const selectedDetail = useMemo(
    () => (pingStyle && detailId && flow ? buildNodeDetail(flow.reelNodes.find((x) => x.id === detailId), details) : null),
    [pingStyle, detailId, flow, details],
  );

  // Ping style: numbered, thick arrows. Dashed = future steps, the arrow in focus and the optional hops (blue).
  const pingEdges = useMemo(() => {
    if (!pingStyle) return shown;
    const at = driven ? -1 : stepper.step;
    return shown.map((e, i) => {
      const style = { ...e.style };
      delete style.strokeWidth; // the CSS width (3.2px, 4.2px on hover) must win over the stepper's inline 5 / 2.5
      const dashed = Boolean(e.style?.strokeDasharray); // optional hops, and stepEdges dashes the arrow in focus and the future ones
      const color = dashed ? LINE_BLUE : LINE_BLACK;
      return {
        ...e,
        style,
        type: "pfdEdge",
        label: undefined,
        zIndex: 1,
        className: dashed ? "pfd-dashed" : undefined,
        markerEnd: { type: "arrowclosed", width: 14, height: 14, color },
        data: { n: i + 1, label: e.label, active: at === i },
      };
    });
  }, [shown, pingStyle, driven, stepper.step]);

  const { nodes: dragNodes, onNodesChange: onDragNodes } = useDraggableNodes(lit);

  // followSteps: open on the first arrow's source at a readable zoom, then pan to each step's arrow.
  const followTo = (s) => {
    const edge = flow?.edges[Math.max(s, 0)];
    if (!followSteps || !edge) return;
    const pts = (s < 0 ? [edge.source] : [edge.source, edge.target]).map(getInternalNode).filter(Boolean).map((n) => ({
      x: n.internals.positionAbsolute.x + (n.measured?.width ?? 0) / 2,
      y: n.internals.positionAbsolute.y + (n.measured?.height ?? 0) / 2,
    }));
    if (!pts.length) return;
    const avg = (k) => pts.reduce((sum, p) => sum + p[k], 0) / pts.length;
    setCenter(avg("x"), avg("y"), { zoom: FOLLOW_ZOOM, duration: s < 0 ? 0 : 600 });
  };
  // On mount this runs before the viewport exists (setCenter no-ops), so onInit below does the opening view.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per step/layout; followTo is rebuilt every render
  useEffect(() => followTo(stepper.step), [flow, stepper.step, followSteps]);
  if (error) return <p className="fcd-note">Couldn't lay out this diagram: {error}</p>;
  return (
    <>
      {!driven && <DiagramStepBar stepper={stepper} caption={flow?.steps[stepper.step]} testId={`${testId}-steps`} />}
      <div className="fcd-canvas" data-testid={testId} ref={ref}>
        {flow ? (
          <ReactFlow
            key={flow.id}
            nodes={dragNodes}
            onNodesChange={onDragNodes}
            edges={pingEdges}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            edgeTypes={pingStyle ? pingEdgeTypes : undefined}
            nodeDragThreshold={pingStyle ? DRAG_THRESHOLD : undefined}
            onNodeDragStop={pingStyle ? () => { lastDragEnd.current = Date.now(); } : undefined}
            fitView={!followSteps}
            onInit={followSteps ? () => followTo(stepper.step) : undefined}
            fitViewOptions={FIT}
            minZoom={0.1}
            maxZoom={2}
            nodesDraggable
            nodesConnectable={false}
            zoomOnScroll={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : (
          <p className="fcd-note">Laying out diagram…</p>
        )}
      </div>
      {pingStyle && flow && <PingLegend />}
      {!driven && flow && (
        <div ref={reelRef}>
          <DiagramReel steps={reelSteps} stepper={stepper} nodeDetail={nodeDetail} onClearNode={() => setNodeDetail(null)} openKey={openKey} testId={`${testId}-reel`} />
          {selectedDetail && (
            <section className="dreel-detail pfd-node-detail" data-testid={`${testId}-node-detail`}>
              <header>
                <h3>{selectedDetail.title}</h3>
                <button type="button" className="dreel-close" onClick={() => setDetailId(null)} aria-label="Close box detail">
                  Close
                </button>
              </header>
              {selectedDetail.lines.length > 0 ? (
                <dl>
                  {selectedDetail.lines.map((l, i) => (
                    <div key={i}>
                      <dd>{l.text}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="dreel-detail-empty">No further detail for this box.</p>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}

/** `step` / `active` work as on SequenceFlowDiagram; leave both undefined for the built-in Play/Step bar. */
/** `followSteps` (opt-in, Full topology): open zoomed on the entry point and pan to each Simulate step. */
/** `pingStyle` (opt-in): Ping palette, numbered thick arrows, legend, box click syncs the reel; `enrichStep(step)` adds request form, tokens and standards to each reel step. */
export default function FlowchartFlowDiagram({ source, testId = "flowchart-flow-diagram", label = "Architecture diagram", step, active, details, followSteps = false, pingStyle = false, enrichStep }) {
  return (
    <div className={`fcd${pingStyle ? " fcd--ping" : ""}`} role="group" aria-label={label}>
      <ReactFlowProvider>
        <Inner source={source} testId={testId} step={step} active={active} details={details} followSteps={followSteps} pingStyle={pingStyle} enrichStep={enrichStep} />
      </ReactFlowProvider>
    </div>
  );
}
