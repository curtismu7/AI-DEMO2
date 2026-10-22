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
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import DiagramStepBar from "./DiagramStepBar";
import { parseSequence } from "../utils/parseSequence";
import { markEdges, markNodes, stepEdges, useDiagramStepper } from "../hooks/useDiagramStepper";
import DiagramReel from "./DiagramReel";
import { buildNodeDetail, buildReelSteps } from "../utils/diagramReel";
import { useFitOnResize, useFitOnSource } from "../hooks/useFitOnResize";
import "./SequenceFlowDiagram.css";
import SequenceActorHeader from "./SequenceActorHeader";

/**
 * SequenceFlowDiagram — a sequence diagram (participants, lifelines, ordered
 * messages) drawn with React Flow. Reads Mermaid `sequenceDiagram` text so the
 * page's .mmd export/upload keeps working. Messages are the Play/Step steps.
 */

// Column width by how many participants share a row: wide sequences get tighter columns, so fitting the
// page width does not shrink the text. Message labels may be wider than a column; each has its own row.
const colFor = (n) => (n <= 4 ? 270 : n <= 6 ? 225 : n <= 8 ? 185 : 155);
const PART_H = 64;
const TOP = 120; // room for participant boxes of 4 lines before the first row
const LINE_H = 17;
const FIT = { padding: 0.04 };
// Floor for the fitted zoom: 13px message labels stay >= 11px on screen (a little headroom for box bands).
const MIN_ZOOM = 0.88;

/**
 * Width of the React Flow area: the canvas width, or wider (the canvas scrolls sideways) when
 * fitView would shrink text below MIN_ZOOM. fitView zooms to width / (drawn width * (1 + padding));
 * the drawing is bounds.w less its 60px margin on each side.
 */
export function flowWidth(canvasW, bounds) {
  return Math.max(canvasW, Math.ceil((bounds.w - 120) * (1 + FIT.padding) * MIN_ZOOM));
}

function Participant({ data }) {
  return (
    <div className="sfx-part" style={{ width: data.w }}>
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
// A wire form or mock token shown under its message, like the payload boxes of a hand-drawn sequence diagram.
function Payload({ data }) {
  return <pre className="sfx-payload" style={{ width: data.w }}>{data.text}</pre>;
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

const nodeTypes = { part: Participant, lifeline: Lifeline, anchor: Anchor, note: Note, payload: Payload, frag: Fragment, box: BoxBand };
const edgeTypes = { msg: MessageEdge, self: SelfEdge };

const ARROW = { type: "arrowclosed", width: 16, height: 16 };

// Monospace box width for a payload: the longest line, kept inside the participants' span.
const PAYLOAD_CH = 7.8; // IBM Plex Mono at the app's size; a system mono is narrower, so it only leaves slack
const PAYLOAD_LINE_H = 15;

export function buildSequenceFlow(source, payloads = []) {
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
  const COL = colFor(Math.max(1, ...Object.values(perGroup)));
  const PART_W = Math.min(220, COL - 24);
  const cx = Object.fromEntries(model.participants.map((p) => [p.id, 60 + colIndex[p.id] * COL + PART_W / 2]));
  const byId = Object.fromEntries(model.participants.map((p) => [p.id, p]));
  const nodes = [];
  const edges = [];
  const steps = [];
  const rows = []; // y of each message arrow, for scrolling a step into view
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
      rows.push(y);
      if (self) y += 26;
      const payload = payloads[n - 1];
      if (payload) {
        const plines = payload.split("\n");
        const allX = model.participants.map((p) => cx[p.id]);
        const w = Math.min(560, Math.max(220, Math.ceil(Math.max(...plines.map((l) => l.length)) * PAYLOAD_CH) + 40));
        const left = Math.min(cx[it.from], cx[it.to]) - 12;
        const x = Math.max(Math.min(...allX) - 80, Math.min(left, Math.max(...allX) + 80 - w));
        const h = plines.length * PAYLOAD_LINE_H + 16;
        y += 8;
        nodes.push({ id: `pl${n - 1}`, type: "payload", position: { x, y }, data: { text: payload, w }, draggable: false, selectable: false, zIndex: 1 });
        y += h + 6;
      }
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
    nodes.push({ id: `p-${p.id}`, type: "part", position: { x: cx[p.id] - PART_W / 2, y: span.head }, data: { label: p.label, w: PART_W }, draggable: false, zIndex: 4 });
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
  return { nodes, edges, steps, bounds, messages, people, rows };
}

function Inner({ source, step, active, details, driver, payloads }) {
  const ref = useRef(null);
  const flowRef = useRef(null);
  useFitOnResize(flowRef, FIT);
  useFitOnSource(source, FIT);
  const [canvasW, setCanvasW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { nodes, edges, steps, bounds, messages, people, rows } = useMemo(() => buildSequenceFlow(source, payloads), [source, payloads]);
  const rf = useReactFlow();
  // Fit to the page WIDTH and let the canvas grow to the drawing's height, so a 28-message
  // sequence stays at a readable size instead of shrinking to fit one screen.
  // Too narrow to fit at a readable size: keep MIN_ZOOM and scroll sideways.
  const zoom = canvasW ? Math.max(MIN_ZOOM, Math.min(1.1, canvasW / bounds.w)) : 1;
  const flowW = canvasW ? flowWidth(canvasW, bounds) : undefined;
  const fitHeight = canvasW ? Math.max(520, Math.round(bounds.h * zoom) + 24) : undefined;
  const stepper = useDiagramStepper(steps.length);
  const external = step !== undefined || active !== undefined || driver !== undefined;
  const reelStepper = driver || (external ? null : stepper);
  const shown = useMemo(() => {
    if (active !== undefined) return markEdges(edges, active);
    return stepEdges(edges, driver ? driver.step : step !== undefined ? step : stepper.step);
  }, [edges, stepper.step, step, active, driver]);
  const reelSteps = useMemo(
    () => {
      if (!reelStepper) return [];
      const built = buildReelSteps({ edges: messages, nodes: people, details });
      // the payload shown under a message is also its request form in the reel's details row
      return built.map((r, i) => (payloads?.[i] ? { ...r, lines: [...r.lines, { who: "Payload", code: payloads[i] }] } : r));
    },
    [reelStepper, messages, people, details, payloads],
  );
  const [nodeDetail, setNodeDetail] = useState(null);
  // Header strip state. Mirrors stepEdges: step < 0 leaves everything shown,
  // otherwise edges past the focus are not reached yet. `active` (page-driven)
  // lights just those messages.
  const focus = driver ? driver.step : step !== undefined ? step : stepper.step;
  const msgState = (i) => {
    if (active !== undefined) return active.includes(i) ? "active" : "idle";
    if (focus < 0) return "done";
    return i === focus ? "active" : i < focus ? "done" : "idle";
  };
  const headerActors = people.map((p) => {
    const states = messages.flatMap((m, i) => (m[0] === p.id || m[1] === p.id ? [msgState(i)] : []));
    const state = states.includes("active") ? "active" : states.includes("done") ? "done" : "idle";
    return { id: p.id, name: p.label, description: p.sub[0], state };
  });
  const headerSegments = messages.map((_, i) => ({ state: msgState(i) }));
  const current = reelStepper ? reelSteps[reelStepper.step] : null;
  const lit = useMemo(
    () => markNodes(nodes, current ? [`p-${current.from}`, `p-${current.to}`, `pl${reelStepper.step}`] : []),
    [nodes, current, reelStepper],
  );
  // A step picked on the movie reel (or reached by Simulate) scrolls its message into view; the arrow and its payload light up.
  useEffect(() => {
    const el = ref.current;
    if (focus < 0 || !el || rows[focus] === undefined) return;
    try {
      const { y, zoom } = rf.getViewport();
      const top = el.getBoundingClientRect().top + window.scrollY + y + rows[focus] * zoom;
      const vh = window.innerHeight;
      if (top < window.scrollY + 120 || top > window.scrollY + vh - 160) window.scrollTo({ top: Math.max(0, top - vh * 0.35), behavior: "smooth" });
    } catch (_) { /* scrolling is a convenience */ }
  }, [focus, rows, rf]);
  const onNodeClick = (_, node) => {
    if (!reelStepper || node.type !== "part") return;
    setNodeDetail(buildNodeDetail(people.find((p) => `p-${p.id}` === node.id), details));
  };
  return (
    <>
      {!external && <DiagramStepBar stepper={stepper} caption={steps[stepper.step]} />}
      {reelStepper && (
        <DiagramReel steps={reelSteps} stepper={reelStepper} nodeDetail={nodeDetail} onClearNode={() => setNodeDetail(null)} testId="sequence-reel" />
      )}
      <SequenceActorHeader actors={headerActors} segments={headerSegments} />
      <div className="sfx-canvas" data-testid="sequence-flow-canvas" ref={ref} style={fitHeight ? { height: fitHeight } : undefined}>
        <div className="sfx-flow" ref={flowRef} style={flowW > canvasW ? { width: flowW } : undefined}>
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
      </div>
    </>
  );
}

/**
 * Leave `step` and `active` undefined for the built-in Play/Step bar. A page that drives the
 * highlight itself passes `step` (one message in focus, later ones fade) or `active` (an
 * array of message indexes to accent). `details` maps a participant id to the text shown in the
 * movie reel's details row. A page that runs its own simulator passes `driver` ({ step, goTo }, step =
 * the message index) to get the diagram highlight and the movie reel without a second control bar.
 */
export default function SequenceFlowDiagram({ source, label = "Sequence diagram", step, active, details, driver, payloads }) {
  return (
    <div className="sfx" role="group" aria-label={label}>
      <ReactFlowProvider>
        <Inner source={source} step={step} active={active} details={details} driver={driver} payloads={payloads} />
      </ReactFlowProvider>
    </div>
  );
}
