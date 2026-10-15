import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType, ConnectionMode, ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LANES, STEPS, PANELS } from "./chatgptLoginSteps";
import "./ChatgptLoginPage.css";

const LANE_W = 250;
const GAP = 40;
const ROW = 56;
const TOP = 70;
const laneX = (i) => i * (LANE_W + GAP);
const laneMid = (i) => laneX(i) + LANE_W / 2;
const HEIGHT = TOP + STEPS.length * ROW + 30;

function LaneNode({ data }) {
  return (
    <div className="cl-lane">
      <div className="cl-lane__title">{data.title}</div>
      <div className="cl-lane__sub">{data.sub}</div>
    </div>
  );
}

function DotNode({ data }) {
  return (
    <div className={`cl-dot${data.state ? ` cl-dot--${data.state}` : ""}`}>
      {data.n}
      <Handle id="l" type="source" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
    </div>
  );
}

function SelfNode({ data }) {
  return (
    <div className={`cl-self${data.state ? ` cl-self--${data.state}` : ""}`}>
      <span className="cl-dot cl-dot--inline">{data.n}</span> {data.label}
    </div>
  );
}

const nodeTypes = { lane: LaneNode, dot: DotNode, self: SelfNode };

function build(current) {
  const nodes = LANES.map((l, i) => ({
    id: l.id, type: "lane", position: { x: laneX(i), y: 0 }, style: { width: LANE_W, height: HEIGHT },
    data: l, zIndex: -1, draggable: false, selectable: false,
  }));
  const edges = [];
  STEPS.forEach((s, i) => {
    const y = TOP + i * ROW;
    const state = s.n === current ? "now" : s.n < current ? "done" : "todo";
    if (s.from === s.to) {
      nodes.push({
        id: `s${s.n}`, type: "self", position: { x: laneX(s.from) + 15, y: y - 16 },
        style: { width: LANE_W - 30 }, data: { n: s.n, label: s.label, state }, draggable: false,
      });
      return;
    }
    const dir = s.to > s.from ? 1 : -1;
    const half = LANE_W / 2 - 14;
    nodes.push({ id: `a${s.n}`, type: "dot", position: { x: laneMid(s.from) + dir * half - 12, y: y - 12 }, data: { n: s.n, state }, draggable: false });
    nodes.push({ id: `b${s.n}`, type: "dot", position: { x: laneMid(s.to) - dir * half - 12, y: y - 12 }, data: { n: "", state }, draggable: false });
    edges.push({
      id: `e${s.n}`, source: `a${s.n}`, sourceHandle: dir > 0 ? "r" : "l", target: `b${s.n}`, targetHandle: dir > 0 ? "l" : "r",
      label: s.label, type: "straight", markerEnd: { type: MarkerType.ArrowClosed },
      className: `cl-edge cl-edge--${state}`, labelBgStyle: { fillOpacity: 0.95 },
    });
  });
  return { nodes, edges };
}

export default function ChatgptLoginPage() {
  const [current, setCurrent] = useState(1);
  const [playing, setPlaying] = useState(false);
  const { nodes, edges } = useMemo(() => build(current), [current]);
  const step = STEPS.find((s) => s.n === current);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setCurrent((c) => {
      if (c >= STEPS.length) { setPlaying(false); return c; }
      return c + 1;
    }), 1800);
    return () => clearInterval(t);
  }, [playing]);

  return (
    <div className="cl-page">
      <h1 className="cl-page__title">How ChatGPT Requests User Login</h1>
      <p className="cl-page__sub">MCP signals the requirement. ChatGPT opens the flow. Your identity service authenticates the user.</p>

      <div className="cl-bar">
        <button type="button" onClick={() => { setPlaying(false); setCurrent((c) => Math.max(1, c - 1)); }} disabled={current === 1}>Back</button>
        <button type="button" onClick={() => { setPlaying(false); setCurrent((c) => Math.min(STEPS.length, c + 1)); }} disabled={current === STEPS.length}>Next</button>
        <button type="button" onClick={() => { if (current === STEPS.length) setCurrent(1); setPlaying((p) => !p); }}>{playing ? "Pause" : "Play"}</button>
        <button type="button" onClick={() => { setPlaying(false); setCurrent(1); }}>Reset</button>
        <span>Step {current} of {STEPS.length}</span>
      </div>

      <div className="cl-main">
        <div className="cl-canvas">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              connectionMode={ConnectionMode.Loose}
              nodesConnectable={false}
              nodesDraggable={false}
              elementsSelectable={false}
              zoomOnDoubleClick={false}
              minZoom={0.3}
              fitView
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
        <aside className="cl-detail" aria-live="polite">
          <div className="cl-detail__n">Step {step.n}</div>
          <h2>{step.label}</h2>
          <p>{step.detail}</p>
          <pre>{step.wire}</pre>
        </aside>
      </div>

      <div className="cl-panels">
        {PANELS.map((p) => (
          <section key={p.title} className="cl-panel">
            <h3>{p.title}</h3>
            <ol>{p.items.map((it) => <li key={it}>{it}</li>)}</ol>
            <div className="cl-panel__foot">{p.foot}</div>
          </section>
        ))}
      </div>
      <p className="cl-page__src">OAuth authorization code + PKCE (RFC 7636) · MCP resource-bound access token (RFC 8707 / RFC 9728) · Source: developers.openai.com Apps SDK auth</p>
    </div>
  );
}
