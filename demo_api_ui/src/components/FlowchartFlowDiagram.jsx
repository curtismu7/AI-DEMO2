import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import DiagramStepBar from "./DiagramStepBar";
import { getElk } from "../utils/elkLayout";
import { parseFlowchart } from "../utils/parseFlowchart";
import { stepEdges, useDiagramStepper } from "../hooks/useDiagramStepper";
import { useFitOnResize } from "../hooks/useFitOnResize";
import "./FlowchartFlowDiagram.css";

/**
 * FlowchartFlowDiagram — a Mermaid `flowchart` (nested subgraphs, labelled edges, classDef
 * colours) drawn with React Flow and laid out by ELK. Edges in source order are the
 * Play/Step steps.
 */

const FIT = { padding: 0.04 };
let layoutSeq = 0;
const HIDDEN = { opacity: 0, width: 1, height: 1 };
const CHAR_W = 6.4;
const LINE_H = 15;
const GROUP_PAD = 16;
const GROUP_HEADER = 28;

const sizeOf = (label) => {
  const lines = label.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  return { width: Math.min(280, Math.max(120, Math.ceil(longest * CHAR_W) + 24)), height: lines.length * LINE_H + 16 };
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
  const { groups, nodes, edges, classDefs, classOf } = model;
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
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
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
      const style = colourStyle(classDefs[classOf[c.id]]);
      rfNodes.push({
        id: c.id,
        type: group ? "fgroup" : "fnode",
        position: { x: c.x, y: c.y },
        ...(parentId ? { parentId } : {}),
        data: group ? { label: group.label, style } : { label: node.label, shape: node.shape, style },
        ...(group ? { style: { width: c.width, height: c.height }, zIndex: 0 } : { zIndex: 1 }),
        draggable: false,
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
  layoutSeq += 1;
  return { id: layoutSeq, nodes: rfNodes, edges: rfEdges, steps };
}

function Inner({ source, height, testId }) {
  const ref = useRef(null);
  useFitOnResize(ref, FIT);
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
  const shown = useMemo(() => (flow ? stepEdges(flow.edges, stepper.step) : []), [flow, stepper.step]);

  if (error) return <p className="fcd-note">Couldn't lay out this diagram: {error}</p>;
  return (
    <>
      <DiagramStepBar stepper={stepper} caption={flow?.steps[stepper.step]} testId={`${testId}-steps`} />
      <div className="fcd-canvas" style={{ height }} data-testid={testId} ref={ref}>
        {flow ? (
          <ReactFlow
            key={flow.id}
            nodes={flow.nodes}
            edges={shown}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={FIT}
            minZoom={0.1}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : (
          <p className="fcd-note">Laying out diagram…</p>
        )}
      </div>
    </>
  );
}

export default function FlowchartFlowDiagram({ source, height = 720, testId = "flowchart-flow-diagram", label = "Architecture diagram" }) {
  return (
    <div className="fcd" role="group" aria-label={label}>
      <ReactFlowProvider>
        <Inner source={source} height={height} testId={testId} />
      </ReactFlowProvider>
    </div>
  );
}
