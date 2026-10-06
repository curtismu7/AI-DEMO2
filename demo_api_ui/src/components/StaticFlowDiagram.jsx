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
 *   height       canvas height in px
 *   ariaLabel    accessible name for the diagram (role="group")
 *   step         index of the EDGES entry in focus for a Play/Step walkthrough
 *                (-1 = off): that arrow is accented, later ones fade. Leave it
 *                undefined and the diagram shows its own Play/Step bar; pass a
 *                number to drive it from the page instead
 *   focusId      node id to ring while a page-driven walkthrough is on
 *
 * Nodes keep their hand-placed x/y; React Flow supplies pan/zoom and fit-to-view.
 * Interaction (drag, connect) is off — these are teaching graphs, not editors.
 */
import React, { useMemo, useRef } from "react";
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
import { edgeCaptions, useDiagramStepper } from "../hooks/useDiagramStepper";
import DiagramStepBar from "./DiagramStepBar";
import "./StaticFlowDiagram.css";

const NODE_W = 210;
const NODE_H_BASE = 44;
const NODE_H_PER_SUB = 15;
const nodeH = (n) => NODE_H_BASE + (n.sub ? n.sub.length * NODE_H_PER_SUB : 0);

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

function Inner({ NODES, EDGES, GROUPS, selectedPath, onNodeClick, testId, height, step, focusId, ariaLabel }) {
  const ref = useRef(null);
  useFitOnResize(ref, FIT);
  const byId = useMemo(() => new Map(NODES.map((n) => [n.id, n])), [NODES]);
  const stepEdge = step >= 0 ? EDGES[step] : null;

  const nodes = useMemo(
    () =>
      NODES.map((n) => {
        const g = GROUPS[n.group] || {};
        const active = selectedPath && n.path === selectedPath;
        const dimmed = selectedPath && n.path && !active;
        const hot = (stepEdge && (stepEdge[0] === n.id || stepEdge[1] === n.id)) || focusId === n.id;
        return {
          id: n.id,
          type: "sfd",
          position: { x: n.x, y: n.y },
          draggable: false,
          selectable: false,
          data: {
            n,
            color: g.bg || "var(--sfd-edge)",
            testId,
            className: `sfd-node${dimmed ? " dimmed" : ""}${hot ? " step-hot" : ""}`,
            onClick: () => onNodeClick({ id: n.id, data: n }),
          },
        };
      }),
    [NODES, GROUPS, selectedPath, stepEdge, focusId, testId, onNodeClick],
  );

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
        const stepClass = step < 0 ? "" : i === step ? " step-now" : i > step ? " step-future" : "";
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
    [EDGES, byId, selectedPath, step],
  );

  return (
    <div className="sfd" data-testid={testId} style={{ height }} ref={ref} role={ariaLabel ? "group" : undefined} aria-label={ariaLabel}>
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
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={FIT}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
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
  onNodeClick = () => {},
  testId = "static-flow-diagram",
  height = 640,
  step,
  focusId,
  ariaLabel,
}) {
  const controlled = step !== undefined;
  const stepper = useDiagramStepper(controlled ? 0 : EDGES.length);
  const captions = useMemo(
    () => edgeCaptions(EDGES, Object.fromEntries(NODES.map((n) => [n.id, n.label]))),
    [NODES, EDGES],
  );
  return (
    <>
      {!controlled && <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId={`${testId}-steps`} />}
      <ReactFlowProvider>
        <Inner
          NODES={NODES}
          EDGES={EDGES}
          GROUPS={GROUPS}
          selectedPath={selectedPath}
          onNodeClick={onNodeClick}
          testId={testId}
          height={height}
          step={controlled ? step : stepper.step}
          focusId={focusId}
          ariaLabel={ariaLabel}
        />
      </ReactFlowProvider>
    </>
  );
}
