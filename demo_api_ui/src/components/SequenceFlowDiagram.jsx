import React, { useMemo, useRef } from "react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  getStraightPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import DiagramStepBar from "./DiagramStepBar";
import { parseSequence } from "../utils/parseSequence";
import { markEdges, stepEdges, useDiagramStepper } from "../hooks/useDiagramStepper";
import { useFitOnResize } from "../hooks/useFitOnResize";
import "./SequenceFlowDiagram.css";

/**
 * SequenceFlowDiagram — a sequence diagram (participants, lifelines, ordered
 * messages) drawn with React Flow. Reads Mermaid `sequenceDiagram` text so the
 * page's .mmd export/upload keeps working. Messages are the Play/Step steps.
 */

const COL = 230;
const PART_W = 190;
const PART_H = 60;
const TOP = 90;
const LINE_H = 15;
const FIT = { padding: 0.04 };

function Participant({ data }) {
  return (
    <div className="sfx-part">
      {data.label.split("\n").map((l, i) => (
        <div key={i} className={i ? "sfx-part__sub" : "sfx-part__title"}>{l}</div>
      ))}
    </div>
  );
}
function Lifeline({ data }) {
  return <div className="sfx-lifeline" style={{ height: data.h }} />;
}
function Anchor() {
  const h = { opacity: 0, width: 1, height: 1 };
  return (
    <div className="sfx-anchor">
      <Handle id="sl" type="source" position={Position.Left} style={h} />
      <Handle id="sr" type="source" position={Position.Right} style={h} />
      <Handle id="tl" type="target" position={Position.Left} style={h} />
      <Handle id="tr" type="target" position={Position.Right} style={h} />
    </div>
  );
}
function Note({ data }) {
  return <div className="sfx-note" style={{ width: data.w }}>{data.text}</div>;
}
function Fragment({ data }) {
  return <div className="sfx-frag" style={{ width: data.w }}>{data.text}</div>;
}
function BoxBand({ data }) {
  return (
    <div className="sfx-box" style={{ width: data.w, height: data.h }}>
      <span className="sfx-box__label">{data.label}</span>
    </div>
  );
}

function MessageEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className="sfx-label nodrag nopan"
          style={{ transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 4}px)` }}
        >
          {data.text}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
function SelfEdge({ id, sourceX, sourceY, style, markerEnd, data }) {
  const x = sourceX + 46;
  const path = `M ${sourceX} ${sourceY} H ${x} V ${sourceY + 26} H ${sourceX}`;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div className="sfx-label sfx-label--self nodrag nopan" style={{ transform: `translate(0, -50%) translate(${x + 8}px, ${sourceY + 13}px)` }}>
          {data.text}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { part: Participant, lifeline: Lifeline, anchor: Anchor, note: Note, frag: Fragment, box: BoxBand };
const edgeTypes = { msg: MessageEdge, self: SelfEdge };

const ARROW = { type: "arrowclosed", width: 16, height: 16 };

export function buildSequenceFlow(source) {
  const model = parseSequence(source);
  const cx = Object.fromEntries(model.participants.map((p, i) => [p.id, 60 + i * COL + PART_W / 2]));
  const nodes = [];
  const edges = [];
  const steps = [];
  const names = Object.fromEntries(model.participants.map((p) => [p.id, p.label.split("\n")[0]]));
  let y = TOP;
  let n = 0;

  model.items.forEach((it, i) => {
    if (it.type === "message") {
      const lines = it.text.split("\n").length;
      y += 18 + lines * LINE_H;
      const self = it.from === it.to;
      const a = `a${i}s`;
      const b = `a${i}t`;
      const rightward = cx[it.to] >= cx[it.from];
      nodes.push({ id: a, type: "anchor", position: { x: cx[it.from] - 3, y: y - 3 }, data: {}, draggable: false, selectable: false, zIndex: 3 });
      nodes.push({ id: b, type: "anchor", position: { x: cx[it.to] - 3, y: y + (self ? 23 : -3) }, data: {}, draggable: false, selectable: false, zIndex: 3 });
      n += 1;
      const text = model.autonumber ? `${n}. ${it.text}` : it.text;
      edges.push({
        id: `m${i}`,
        source: a,
        target: b,
        sourceHandle: self || rightward ? "sr" : "sl",
        targetHandle: self ? "tr" : rightward ? "tl" : "tr",
        type: self ? "self" : "msg",
        markerEnd: ARROW,
        style: it.dashed ? { strokeDasharray: "6 4" } : undefined,
        data: { text },
        selectable: false,
        zIndex: 2,
      });
      steps.push(`${names[it.from]} → ${names[it.to]}: ${it.text.replace(/\n/g, " ")}`);
      if (self) y += 26;
    } else if (it.type === "note") {
      const xs = it.over.map((id) => cx[id]);
      const x0 = Math.min(...xs) - 90;
      const w = Math.max(...xs) - Math.min(...xs) + 180;
      const lines = it.text.split("\n").length;
      y += 14;
      nodes.push({ id: `n${i}`, type: "note", position: { x: x0, y }, data: { text: it.text, w }, draggable: false, selectable: false });
      y += lines * LINE_H + 18;
    } else if (it.type === "fragment") {
      const all = Object.values(cx);
      y += 12;
      nodes.push({
        id: `f${i}`,
        type: "frag",
        position: { x: Math.min(...all) - 100, y },
        data: { text: `${it.kind}${it.text ? ` · ${it.text}` : ""}`, w: Math.max(...all) - Math.min(...all) + 200 },
        draggable: false,
        selectable: false,
      });
      y += 18;
    }
  });

  const height = y + 30 - 60;
  model.participants.forEach((p) => {
    nodes.push({ id: `p-${p.id}`, type: "part", position: { x: cx[p.id] - PART_W / 2, y: 20 }, data: { label: p.label }, draggable: false, zIndex: 4 });
    nodes.push({ id: `l-${p.id}`, type: "lifeline", position: { x: cx[p.id] - 1, y: 20 + PART_H }, data: { h: height }, draggable: false, selectable: false, zIndex: 0 });
  });
  model.boxes.forEach((b, i) => {
    const xs = b.ids.map((id) => cx[id]);
    if (!xs.length) return;
    const x0 = Math.min(...xs) - PART_W / 2 - 14;
    nodes.push({
      id: `box${i}`,
      type: "box",
      position: { x: x0, y: -10 },
      data: { label: b.label, w: Math.max(...xs) - Math.min(...xs) + PART_W + 28, h: height + PART_H + 40 },
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
  });
  return { nodes, edges, steps };
}

function Inner({ source, step, active, height }) {
  const ref = useRef(null);
  useFitOnResize(ref, FIT);
  const { nodes, edges, steps } = useMemo(() => buildSequenceFlow(source), [source]);
  const stepper = useDiagramStepper(steps.length);
  const driven = step !== undefined || active !== undefined;
  const shown = useMemo(() => {
    if (active !== undefined) return markEdges(edges, active);
    return stepEdges(edges, step !== undefined ? step : stepper.step);
  }, [edges, stepper.step, step, active]);
  return (
    <>
      {!driven && <DiagramStepBar stepper={stepper} caption={steps[stepper.step]} />}
      <div className="sfx-canvas" data-testid="sequence-flow-canvas" ref={ref} style={height ? { height } : undefined}>
        <ReactFlow
          nodes={nodes}
          edges={shown}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={FIT}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </>
  );
}

/**
 * Leave `step` and `active` undefined for the built-in Play/Step bar. A page that drives the
 * highlight itself passes `step` (one message in focus, later ones fade) or `active` (an
 * array of message indexes to accent).
 */
export default function SequenceFlowDiagram({ source, label = "Sequence diagram", step, active, height }) {
  return (
    <div className="sfx" role="group" aria-label={label}>
      <ReactFlowProvider>
        <Inner source={source} step={step} active={active} height={height} />
      </ReactFlowProvider>
    </div>
  );
}
