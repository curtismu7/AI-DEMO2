import { useEffect, useMemo, useRef } from "react";
import { BaseEdge, Controls, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ACTORS, CALLS } from "../utils/idJagCallSequence";
import { PF_ID_JAG_GROUPS } from "../config/pfIdJagDiagrams";
import { SEQ_LOOP_H, SEQ_LOOP_W, seqEdges, seqHeight, seqNodes, seqWidth } from "../config/pfIdJagSequence";
import { useFitOnResize } from "../hooks/useFitOnResize";
import SequenceActorHeader from "./SequenceActorHeader";

const FIT = { padding: 0.02 };

// An actor box (a lifeline head). Colour bar = the group, like the other figures on the page.
function ActorNode({ data }) {
  const bg = PF_ID_JAG_GROUPS[data.group].bg;
  return (
    <div className="ijc-actor" style={{ "--ijc-group": bg }}>
      <span className="ijc-actor__label">{data.label}</span>
    </div>
  );
}

// The dashed lifeline. It carries one hidden handle pair per call so each arrow lands on its own row.
function LifeNode({ data }) {
  return (
    <div className="ijc-life">
      {data.rows.map((y, i) => (
        <span key={i}>
          <Handle id={`s${i}`} type="source" position={Position.Right} className="ijc-h" style={{ top: y }} isConnectable={false} />
          <Handle id={`t${i}`} type="target" position={Position.Left} className="ijc-h" style={{ top: y }} isConnectable={false} />
          <Handle id={`v${i}`} type="source" position={Position.Right} className="ijc-h" style={{ top: y - SEQ_LOOP_H / 2 }} isConnectable={false} />
          <Handle id={`u${i}`} type="target" position={Position.Right} className="ijc-h" style={{ top: y + SEQ_LOOP_H / 2 }} isConnectable={false} />
        </span>
      ))}
    </div>
  );
}

// One call: a straight horizontal arrow (a small loop for a call to itself), a number badge on its start
// and the call's words above the line. The badge + words are one button.
function SeqEdge({ sourceX, sourceY, targetX, targetY, data, id }) {
  const { onSelect, state } = data.ui;
  const { self, dir, n, label, untraced, i } = data;
  const head = 9;
  let path;
  let tip;
  let labelX;
  let labelY;
  let badgeX;
  if (self) {
    path = `M${sourceX},${sourceY} h${SEQ_LOOP_W} V${targetY} h${-SEQ_LOOP_W + 1}`;
    tip = `M${sourceX},${targetY} l${head},-5 v10 z`;
    labelX = sourceX + SEQ_LOOP_W + 8;
    labelY = (sourceY + targetY) / 2;
    badgeX = labelX;
  } else {
    path = `M${sourceX},${sourceY} H${targetX - dir * 1}`;
    tip = `M${targetX},${targetY} l${-dir * head},-5 v10 z`;
    labelX = (sourceX + targetX) / 2;
    labelY = sourceY - 20;
    badgeX = labelX;
  }
  return (
    <>
      <BaseEdge id={id} path={path} className={`ijc-edge ijc-edge--${state}`} interactionWidth={16} />
      <path d={tip} className={`ijc-edge__head ijc-edge__head--${state}`} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`ijc-edge-label ijc-edge-label--${state} ${self ? "is-self" : ""}`}
          style={{ transform: `translate(${self ? "0" : "-50%"}, -50%) translate(${self ? labelX : badgeX}px, ${labelY}px)` }}
          aria-label={`Call ${n}: ${label}`}
          aria-current={state === "now" ? "step" : undefined}
          onClick={() => onSelect(i)}
        >
          <span className="ijc-edge-label__n">{n}</span>
          <span className="ijc-edge-label__text">{label}{untraced ? " (not traced)" : ""}</span>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { actor: ActorNode, life: LifeNode };
const EDGE_TYPES = { seq: SeqEdge };

function Inner({ activeIndex, onSelect, calls }) {
  const wrap = useRef(null);
  const { fitView } = useReactFlow();
  useFitOnResize(wrap, FIT);
  useEffect(() => { fitView(FIT); }, [fitView]);
  const nodes = useMemo(() => seqNodes(calls), [calls]);
  const edges = useMemo(() => seqEdges(calls).map((e) => ({
    ...e,
    data: { ...e.data, ui: { onSelect, state: e.data.i === activeIndex ? "now" : e.data.i < activeIndex ? "done" : "next" } },
  })), [calls, activeIndex, onSelect]);
  const firstCallOf = (actorId) => calls.findIndex((c) => c.from === actorId || c.to === actorId);
  return (
    <div ref={wrap} className="ijc-seq__canvas" style={{ aspectRatio: `${seqWidth()} / ${seqHeight(calls.length)}` }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={FIT}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        panOnDrag={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => { if (node.type === "actor") { const k = firstCallOf(node.id); if (k >= 0) onSelect(k); } }}
        aria-label="ID-JAG calls, sequence diagram"
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

// ID-JAG sequence diagram as a ReactFlow figure in the shared Ping look (light grey canvas, thick black arrows,
// orange numbered badges, blue dashed arrow for the call in focus). Actor boxes sit on the lifelines and are not
// draggable; Simulate / Step / Reset / speed and the per-call detail (request form, MOCK tokens, standards) are the
// player's, next to it. Every call appears whether or not a live run recorded it.
export default function IdJagCallSequence({ activeIndex, onSelect, calls = CALLS }) {
  const callState = (i) => (i === activeIndex ? "active" : i < activeIndex ? "done" : "idle");
  const headerActors = ACTORS.map((a) => {
    const states = calls.flatMap((c, i) => (c.from === a.id || c.to === a.id ? [callState(i)] : []));
    const state = states.includes("active") ? "active" : states.includes("done") ? "done" : "idle";
    return { id: a.id, name: a.label, state };
  });
  return (
    <div className="ijc-seq" data-testid="idjag-sequence">
      <SequenceActorHeader actors={headerActors} segments={calls.map((_, i) => ({ state: callState(i) }))} />
      <ReactFlowProvider>
        <Inner activeIndex={activeIndex} onSelect={onSelect} calls={calls} />
      </ReactFlowProvider>
    </div>
  );
}
