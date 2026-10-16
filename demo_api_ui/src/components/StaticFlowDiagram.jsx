/**
 * StaticFlowDiagram — fixed-layout token flows drawn with React Flow.
 *
 * Props:
 *   NODES        [{ id, group, label, sub?: string[], x, y }]
 *   EDGES        [[srcId, tgtId, label?, opts?]] — opts: { dashed, color, vertical }
 *                (vertical = leave the bottom of the source, enter the top of the target)
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
 *
 * Nodes keep their hand-placed x/y; React Flow supplies pan/zoom and fit-to-view.
 * Interaction: nodes are draggable so a presenter can nudge the layout clean;
 * connect stays off — these are teaching graphs, not editors. Drag is
 * view-only (positions reset on reload; nothing is saved).
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useFitOnResize } from "../hooks/useFitOnResize";
import { useDraggableNodes } from "../hooks/useDraggableNodes";
import { edgeCaptions, useDiagramStepper } from "../hooks/useDiagramStepper";
import DiagramStepBar from "./DiagramStepBar";
import DiagramReel from "./DiagramReel";
import { buildNodeDetail, buildReelSteps } from "../utils/diagramReel";
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

const FIT = { padding: 0.06 };
const HIDDEN = { opacity: 0, width: 1, height: 1 };

function FlowNode({ data }) {
  const { n, color, className, testId, onClick } = data;
  return (
    <div
      className={className}
      style={{ width: NODE_W, height: nodeH(n), borderColor: color }}
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
  const self = data.self;
  const [path, labelX, labelY] = self
    ? [`M ${sourceX} ${sourceY} C ${sourceX + 60} ${sourceY}, ${sourceX + 60} ${sourceY + 30}, ${sourceX} ${sourceY + 30}`, sourceX + 55, sourceY + 15]
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <g className={data.className}>
      <BaseEdge
        id={id}
        path={path}
        markerEnd="url(#sfd-arrow)"
        style={{ stroke: data.color, strokeWidth: 1.5, strokeDasharray: data.dashed ? "5 4" : undefined }}
      />
      {data.label && (
        <EdgeLabelRenderer>
          <div
            className={`sfd-edge-label nodrag nopan ${data.className}`}
            style={{ transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 2}px)` }}
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

function Inner({ NODES, EDGES, GROUPS, selectedPath, onNodeClick, testId, step, focusId, ariaLabel, walkStep, visited }) {
  const ref = useRef(null);
  useFitOnResize(ref, FIT);
  const byId = useMemo(() => new Map(NODES.map((n) => [n.id, n])), [NODES]);
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
            className: `sfd-node${dimmed ? " dimmed" : ""}${hot ? " step-hot" : ""}${seen ? " step-seen" : ""}`,
            onClick: () => onNodeClick({ id: n.id, data: n }),
          },
        };
      }),
    [NODES, GROUPS, selectedPath, stepEdge, focusId, testId, onNodeClick, walkStep, visited],
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
            sourceHandle: opts.vertical ? "sb" : self || forward ? "sr" : "sl",
            targetHandle: opts.vertical ? "tt" : self ? "tr" : forward ? "tl" : "tr",
            selectable: false,
            data: {
              label,
              self,
              dashed: opts.dashed,
              color: opts.color || "var(--sfd-edge)",
              className: `sfd-edge${dimmed ? " dimmed" : ""}${stepClass}`,
            },
          },
        ];
      }),
    [EDGES, byId, selectedPath, step, walkStep],
  );

  return (
    <div className="sfd" data-testid={testId} ref={ref} role={ariaLabel ? "group" : undefined} aria-label={ariaLabel}>
      <svg width="0" height="0" aria-hidden="true" className="sfd-defs">
        <defs>
          <marker id="sfd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="sfd-arrow" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
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
    return buildReelSteps({ edges: EDGES, nodes: NODES, details });
  }, [driver, walk, EDGES, NODES, details]);
  const [nodeDetail, setNodeDetail] = useState(null);
  // A page that handles node clicks itself keeps its own panel; otherwise the details row shows the node.
  const handleNodeClick = useCallback(
    (node) => {
      if (onNodeClick) onNodeClick(node);
      else if (driver) setNodeDetail(buildNodeDetail(NODES.find((n) => n.id === node.id), details));
    },
    [onNodeClick, driver, NODES, details],
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
        />
      </ReactFlowProvider>
      {driver && (
        <DiagramReel steps={reelSteps} stepper={driver} nodeDetail={nodeDetail} onClearNode={() => setNodeDetail(null)} testId={`${testId}-reel`} />
      )}
    </>
  );
}
