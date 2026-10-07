import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { markEdges, markNodes, stepEdges, useDiagramStepper } from "../hooks/useDiagramStepper";
import DiagramReel from "./DiagramReel";
import { buildNodeDetail, buildReelSteps } from "../utils/diagramReel";
import { useFitOnResize } from "../hooks/useFitOnResize";
import "./SequenceFlowDiagram.css";

/**
 * SequenceFlowDiagram — a sequence diagram (participants, lifelines, ordered
 * messages) drawn with React Flow. Reads Mermaid `sequenceDiagram` text so the
 * page's .mmd export/upload keeps working. Messages are the Play/Step steps.
 */

const COL = 270;
const PART_W = 220;
const PART_H = 64;
const TOP = 90;
const LINE_H = 17;
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
  // Two or more `box` groups are separate flows. Draw them stacked, each with its own
  // participant row, instead of side by side, so the diagram stays narrow enough to read.
  const stacked = model.boxes.length > 1;
  const groupOf = (p) => (stacked ? p.box || "__none" : "__all");
  const groupIds = [...new Set(model.participants.map(groupOf))];
  const colIndex = {};
  const perGroup = {};
  model.participants.forEach((p) => {
    const g = groupOf(p);
    perGroup[g] = (perGroup[g] || 0) + 1;
    colIndex[p.id] = perGroup[g] - 1;
  });
  const cx = Object.fromEntries(model.participants.map((p) => [p.id, 60 + colIndex[p.id] * COL + PART_W / 2]));
  const byId = Object.fromEntries(model.participants.map((p) => [p.id, p]));
  const nodes = [];
  const edges = [];
  const steps = [];
  const names = Object.fromEntries(model.participants.map((p) => [p.id, p.label.split("\n")[0]]));
  const spans = {}; // group id -> { head, end }
  let cur = null;
  let y = TOP;
  let n = 0;

  const open = (g) => {
    if (cur !== null) spans[cur].end = y + 20;
    const head = cur === null ? 20 : y + 40;
    if (cur !== null) y = head + PART_H + 6;
    spans[g] = { head, end: 0 };
    cur = g;
  };
  open(groupIds[0] ?? "__all");
  const groupCx = (g) => model.participants.filter((p) => groupOf(p) === g).map((p) => cx[p.id]);

  model.items.forEach((it, i) => {
    if (it.type === "message") {
      const g = groupOf(byId[it.from]);
      if (stacked && g !== cur) open(g);
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
      const all = groupCx(cur);
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
  spans[cur].end = y + 30;

  model.participants.forEach((p) => {
    const span = spans[groupOf(p)] || spans[cur];
    nodes.push({ id: `p-${p.id}`, type: "part", position: { x: cx[p.id] - PART_W / 2, y: span.head }, data: { label: p.label }, draggable: false, zIndex: 4 });
    nodes.push({ id: `l-${p.id}`, type: "lifeline", position: { x: cx[p.id] - 1, y: span.head + PART_H }, data: { h: Math.max(20, span.end - span.head - PART_H) }, draggable: false, selectable: false, zIndex: 0 });
  });
  model.boxes.forEach((b, i) => {
    const xs = b.ids.map((id) => cx[id]);
    if (!xs.length) return;
    const span = stacked ? spans[groupOf(byId[b.ids[0]])] : spans[cur];
    const top = (stacked ? span.head : 20) - 30;
    nodes.push({
      id: `box${i}`,
      type: "box",
      position: { x: Math.min(...xs) - PART_W / 2 - 14, y: top },
      data: { label: b.label, w: Math.max(...xs) - Math.min(...xs) + PART_W + 28, h: span.end - top + 10 },
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
  });
  // Natural size of the drawing, so the canvas can be sized to it (see Inner).
  const widest = Math.max(1, ...Object.values(perGroup));
  const bounds = { w: 120 + (widest - 1) * COL + PART_W, h: spans[cur].end + 40 };
  // For the movie reel: the messages in order, and each participant as a node with its own detail lines.
  const messages = model.items.filter((i) => i.type === "message").map((i) => [i.from, i.to, i.text]);
  const people = model.participants.map((p) => {
    const [head, ...rest] = p.label.split("\n");
    return { id: p.id, label: head, sub: rest };
  });
  return { nodes, edges, steps, bounds, messages, people };
}

function Inner({ source, step, active, details }) {
  const ref = useRef(null);
  useFitOnResize(ref, FIT);
  const [canvasW, setCanvasW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { nodes, edges, steps, bounds, messages, people } = useMemo(() => buildSequenceFlow(source), [source]);
  // Fit to the page WIDTH and let the canvas grow to the drawing's height, so a 28-message
  // sequence stays at a readable size instead of shrinking to fit one screen.
  const zoom = canvasW ? Math.min(1.1, canvasW / bounds.w) : 1;
  const fitHeight = canvasW ? Math.max(520, Math.round(bounds.h * zoom) + 24) : undefined;
  const stepper = useDiagramStepper(steps.length);
  const driven = step !== undefined || active !== undefined;
  const shown = useMemo(() => {
    if (active !== undefined) return markEdges(edges, active);
    return stepEdges(edges, step !== undefined ? step : stepper.step);
  }, [edges, stepper.step, step, active]);
  const reelSteps = useMemo(
    () => (driven ? [] : buildReelSteps({ edges: messages, nodes: people, details })),
    [driven, messages, people, details],
  );
  const [nodeDetail, setNodeDetail] = useState(null);
  const current = driven ? null : reelSteps[stepper.step];
  const lit = useMemo(() => markNodes(nodes, current ? [`p-${current.from}`, `p-${current.to}`] : []), [nodes, current]);
  const onNodeClick = (_, node) => {
    if (driven || node.type !== "part") return;
    setNodeDetail(buildNodeDetail(people.find((p) => `p-${p.id}` === node.id), details));
  };
  return (
    <>
      {!driven && <DiagramStepBar stepper={stepper} caption={steps[stepper.step]} />}
      {!driven && (
        <DiagramReel steps={reelSteps} stepper={stepper} nodeDetail={nodeDetail} onClearNode={() => setNodeDetail(null)} testId="sequence-reel" />
      )}
      <div className="sfx-canvas" data-testid="sequence-flow-canvas" ref={ref} style={fitHeight ? { height: fitHeight } : undefined}>
        <ReactFlow
          nodes={lit}
          edges={shown}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={FIT}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
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
 * array of message indexes to accent). `details` maps a participant id to the text shown in the
 * movie reel's details row.
 */
export default function SequenceFlowDiagram({ source, label = "Sequence diagram", step, active, details }) {
  return (
    <div className="sfx" role="group" aria-label={label}>
      <ReactFlowProvider>
        <Inner source={source} step={step} active={active} details={details} />
      </ReactFlowProvider>
    </div>
  );
}
