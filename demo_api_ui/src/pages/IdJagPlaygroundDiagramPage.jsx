import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ReactFlow, ReactFlowProvider, useReactFlow, useNodesInitialized, Background, Controls, ConnectionMode, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./PingFederateIdJagImplementationPage.css";
import IdJagPathBar from "../components/IdJagPathBar";
import { nodeTypes, edgeTypes } from "./PingFederateIdJagImplementationPage";
import { useDraggableNodes } from "../hooks/useDraggableNodes";
import { PLAYGROUND_DIAGRAMS, PLAYGROUND_DIAGRAM_MODES, playgroundDiagramPath, stepParts } from "../utils/idJagPlaygroundDiagrams";

// One diagram per ID-JAG playground mode (/pingfederate-id-jag/playground/diagram/:mode).
// ?step=N lights playground step N; the URL is the step state, so every view is a deep link.

function PlaygroundFlow({ mode, d }) {
  const rf = useReactFlow();
  const measured = useNodesInitialized(); // a ?step deep link can only zoom once nodes have sizes
  const [params, setParams] = useSearchParams();
  const last = d.steps.length;
  const step = Math.min(last, Math.max(0, parseInt(params.get("step"), 10) || 0));
  const setStep = (n) => setParams(n ? { step: String(n) } : {}, { replace: true });
  const [playing, setPlaying] = useState(false);
  const [panel, setPanel] = useState(true);
  const [side, setSide] = useState(380);
  const lit = stepParts(d, step);
  const current = step ? d.steps[step - 1] : { t: "Overview", text: d.overview };

  const computed = useMemo(() => [
    ...d.nodes.map((n) => ({ id: n.id, type: "card", position: { x: n.x, y: n.y }, style: { width: 300 },
      data: { ...n, dim: !!step && !lit.nodes.includes(n.id), on: !!step && lit.nodes.includes(n.id) } })),
    ...d.notes.map((n) => ({ id: n.id, type: "note", position: { x: n.x, y: n.y }, style: { width: 300 },
      data: { text: n.text, dim: !!step && !lit.notes.includes(n.id) } })),
  // lit is derived from (d, step)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [d, step]);
  const { nodes, onNodesChange } = useDraggableNodes(computed);

  const edges = d.edges.map((e) => {
    const on = lit.edges.includes(e.id);
    return {
      id: e.id, source: e.from, target: e.to, sourceHandle: e.fh, targetHandle: e.th, label: e.label, type: "flow",
      data: { on, label: e.label, pulse: step && on ? step : 0, dur: 2 },
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: on ? 2.4 : 1.2, opacity: on ? 1 : 0.15, strokeDasharray: e.dashed ? "6 4" : undefined },
    };
  });

  // Zoom to the lit actors and callouts (or the whole map on the overview).
  useEffect(() => {
    const ids = step ? lit.focus.map((id) => ({ id })) : undefined;
    const t = setTimeout(() => rf.fitView({ nodes: ids, padding: step ? 0.15 : 0.05, duration: 500, maxZoom: 1 }), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, panel, measured]);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => (step >= last ? setPlaying(false) : setStep(step + 1)), 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, step]);

  const play = () => { if (!step || step >= last) setStep(1); setPlaying(true); };
  const go = (n) => { setPlaying(false); setStep(n); };
  const fullscreen = () => {
    const el = document.querySelector(".ijx");
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el && el.requestFullscreen) el.requestFullscreen();
    setTimeout(() => rf.fitView({ padding: 0.05, duration: 300 }), 250);
  };

  const startSplit = (e) => {
    e.preventDefault();
    const mv = (ev) => setSide(Math.min(720, Math.max(260, ev.clientX)));
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };

  return (
    <div className="ijx-app" style={{ gridTemplateColumns: panel ? `${side}px 6px 1fr` : "0 0 1fr" }}>
      <aside style={panel ? undefined : { padding: 0, border: 0, overflow: "hidden", visibility: "hidden" }}>
        <h1>ID-JAG Playground: {d.label}</h1>
        <p className="lede">{d.lede}</p>
        <nav className="modes" aria-label="Playground mode">
          {PLAYGROUND_DIAGRAM_MODES.map((m) => (
            <Link key={m} to={playgroundDiagramPath(m, step)} aria-current={m === mode ? "page" : undefined}>{PLAYGROUND_DIAGRAMS[m].label}</Link>
          ))}
        </nav>
        <div className="sim">
          <button className="pri" onClick={playing ? () => setPlaying(false) : play}>{playing ? "Pause" : "▶ Simulate"}</button>
          <button onClick={() => go(Math.max(0, step - 1))} disabled={step === 0}>◀ Back</button>
          <button onClick={() => go(Math.min(last, step + 1))} disabled={step === last}>Next ▶</button>
          <button onClick={() => go(0)}>Reset</button>
          <span className="hint">Drag nodes to rearrange</span>
        </div>
        <nav aria-label="Steps">
          {[{ n: 0, t: "Overview" }, ...d.steps].map((s) => (
            <button key={s.n} className={s.n === step ? "sel" : ""} aria-pressed={s.n === step} onClick={() => go(s.n)}>
              {s.n ? `${s.n} · ${s.t}` : s.t}
            </button>
          ))}
        </nav>
        <section>
          <h2>{step ? `Step ${step} · ${current.t}` : current.t}</h2>
          <p>{current.text}</p>
          <h3>{step ? "Calls in this step" : "Every call"}</h3>
          <ul data-testid="pgd-calls">{d.edges.filter((e) => lit.edges.includes(e.id)).map((e) => <li key={e.id}>{e.label}</li>)}</ul>
        </section>
        <p className="legend">Solid = request/response · dashed = where trust comes from (JWKS or registry read) or an alternate path</p>
        <p className="legend"><Link to="/pingfederate-id-jag/playground">Open the playground</Link> to run this mode for real.</p>
      </aside>
      <div className="split" style={panel ? undefined : { visibility: "hidden" }} onPointerDown={startSplit} title="Drag to resize panel" />
      <main>
        <div className="tools">
          <button onClick={() => setPanel(!panel)}>{panel ? "◀ Hide panel" : "▶ Show panel"}</button>
          <button onClick={fullscreen}>Fullscreen</button>
        </div>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} nodesDraggable connectionMode={ConnectionMode.Loose}
          fitView fitViewOptions={{ padding: 0.05 }} minZoom={0.1} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </main>
    </div>
  );
}

export default function IdJagPlaygroundDiagramPage() {
  const { mode } = useParams();
  const known = PLAYGROUND_DIAGRAMS[mode] ? mode : "oauth-mcp";
  return (
    <div className="ijx ijx--wrap" data-testid="idjag-playground-diagram">
      <IdJagPathBar current="play" />
      {/* key: a new mode starts from its own layout, not the last mode's dragged positions */}
      <ReactFlowProvider key={known}>
        <PlaygroundFlow mode={known} d={PLAYGROUND_DIAGRAMS[known]} />
      </ReactFlowProvider>
    </div>
  );
}
