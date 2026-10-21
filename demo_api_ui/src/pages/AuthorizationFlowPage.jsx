import { useContext, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  ConnectionMode,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import DiagramStepBar from "../components/DiagramStepBar";
import { useDiagramStepper } from "../hooks/useDiagramStepper";
import { VerticalContext } from "../vertical/VerticalProvider";
import { DEFAULT_VERTICAL, PROFILES, SLOTS, VERTICAL_OPTIONS, lanesFor, momentsFor, profileFor } from "./authorizationFlowData";
import "./AuthorizationFlowPage.css";

// The six moments of the reference demo, on PingOne, in dollars. Lanes are draggable boxes; every message of the
// chosen moment is an arrow, revealed one at a time by the shared step bar (Simulate, Prev/Next, speed, Reset).
const LANE_GAP = 140;
const LANE_W = 118;
const HEAD_H = 70;
const SLOT_H = 36;
const slotY = (i) => HEAD_H + 18 + i * SLOT_H + SLOT_H / 2;
const LANE_H = HEAD_H + 36 + SLOTS * SLOT_H;

function LaneNode({ data }) {
  return (
    <div className="af-lane" style={{ height: LANE_H }}>
      <div className={`af-lane__head af-lane__head--${data.id}`}>
        <strong>{data.label}</strong>
        <span>{data.sub}</span>
      </div>
      <div className="af-lane__line" />
      {Array.from({ length: SLOTS }, (_, i) => (
        <span key={i}>
          <Handle id={`l${i}`} type="source" position={Position.Left} style={{ top: slotY(i), left: "50%" }} className="af-handle" />
          <Handle id={`r${i}`} type="source" position={Position.Right} style={{ top: slotY(i), left: "50%", right: "auto" }} className="af-handle" />
        </span>
      ))}
    </div>
  );
}

// The message label sits above its line, not on it: between neighbouring lanes the line is shorter than the label.
function MessageEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, label, className }) {
  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  const cx = (sourceX + targetX) / 2;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={className} />
      <EdgeLabelRenderer>
        <div
          className={`af-msg ${className || ""}`}
          style={{ transform: `translate(-50%, -100%) translate(${cx}px, ${sourceY - 2}px)` }}
        >
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { lane: LaneNode };
const edgeTypes = { msg: MessageEdge };
const startNodes = (vertical) => lanesFor(vertical).map((l, i) => ({
  id: l.id,
  type: "lane",
  position: { x: i * LANE_GAP, y: 0 },
  data: l,
  style: { width: LANE_W },
}));
const ARROW = {
  dark: { plain: "#7fb2e6", ok: "#3ddc97", block: "#ff5a5a" },
  light: { plain: "#12538d", ok: "#0a7a4a", block: "#c40d0f" },
};
const appTheme = () => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
const laneIndex = Object.fromEntries(lanesFor(DEFAULT_VERTICAL).map((l, i) => [l.id, i]));

function edgeFor(step, i, hot, theme) {
  const forward = laneIndex[step.from] < laneIndex[step.to];
  const tone = step.block ? "block" : step.ok ? "ok" : "plain";
  return {
    id: `s${i}`,
    source: step.from,
    target: step.to,
    sourceHandle: `${forward ? "r" : "l"}${i}`,
    targetHandle: `${forward ? "l" : "r"}${i}`,
    type: "msg",
    label: step.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: ARROW[theme][tone] },
    className: `af-edge af-edge--${tone}${hot ? " af-edge--hot" : ""}`,
  };
}

function Visualiser({ moment, stepper, theme, vertical }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(startNodes(vertical));
  // A new vertical renames the system-of-record lane; boxes the viewer has dragged stay where they are.
  useEffect(() => {
    const names = Object.fromEntries(lanesFor(vertical).map((l) => [l.id, l]));
    setNodes((ns) => ns.map((n) => ({ ...n, data: names[n.id] })));
  }, [vertical, setNodes]);
  const { fitView } = useReactFlow();
  const shown = stepper.step;
  const edges = useMemo(
    () => moment.steps.slice(0, shown + 1).map((s, i) => edgeFor(s, i, i === shown, theme)),
    [moment, shown, theme],
  );

  useEffect(() => {
    const id = setTimeout(() => fitView({ padding: 0.03 }), 50);
    return () => clearTimeout(id);
  }, [fitView]);

  return (
    <div className="af-canvas" data-af-theme={theme}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        fitView
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function AuthorizationFlowPage() {
  // The vertical: ?vertical= wins, then the app's active vertical, then banking.
  const activeId = useContext(VerticalContext)?.activeId;
  const [vertical, setVertical] = useState(() => {
    const asked = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("vertical") : null;
    return [asked, activeId].find((v) => v && PROFILES[v]) || DEFAULT_VERTICAL;
  });
  const profile = profileFor(vertical);
  const moments = useMemo(() => momentsFor(vertical), [vertical]);
  const [momentId, setMomentId] = useState(moments[0].id);
  const moment = moments.find((x) => x.id === momentId) || moments[0];
  const pickVertical = (id) => {
    setVertical(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("vertical", id);
      window.history.replaceState(null, "", url);
    } catch { /* no history in this environment */ }
  };
  const stepper = useDiagramStepper(moment.steps.length);
  const { stop } = stepper;
  // Starts on the app's theme and follows it until the toggle is used.
  const [theme, setTheme] = useState(appTheme);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned || typeof MutationObserver === "undefined") return undefined;
    const obs = new MutationObserver(() => setTheme(appTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, [pinned]);
  const toggleTheme = () => { setPinned(true); setTheme((t) => (t === "dark" ? "light" : "dark")); };

  useEffect(() => { stop(); }, [momentId, vertical, stop]);

  const reached = stepper.step;
  const chat = moment.steps.slice(0, reached + 1).filter((s) => s.chat).map((s) => s.chat);
  const done = reached === moment.steps.length - 1;
  const current = reached >= 0 ? moment.steps[reached] : null;

  return (
    <div className="af-page">
      <header className="af-page__head">
        <h1>Authorization Flow</h1>
        <p>
          An assistant acts for a customer without becoming the authority. PingOne signs the customer in, runs both
          token exchanges and the CIBA push; {profile.org} decides. This is a scripted walkthrough of the six moments:
          no live calls are made from this page.
        </p>
      </header>

      <label className="af-vertical">
        Vertical
        <select value={vertical} onChange={(e) => pickVertical(e.target.value)}>
          {VERTICAL_OPTIONS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>

      <div className="af-chips" role="tablist" aria-label="Moments">
        {moments.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === momentId}
            className={`af-chip${x.id === momentId ? " af-chip--on" : ""}`}
            onClick={() => setMomentId(x.id)}
          >
            <span>{x.num}</span> {x.chip}
          </button>
        ))}
      </div>

      <div className="af-grid">
        <section className="af-chat" aria-label="Conversation">
          <h2>Conversation</h2>
          <p className="af-chat__prompt">{moment.prompt}</p>
          <ol className="af-chat__log">
            {chat.length === 0 ? <li className="af-chat__empty">Press Simulate to run this moment.</li> : null}
            {chat.map((c, i) => (
              <li key={i} className={`af-bubble af-bubble--${c.role}`}>{c.text}</li>
            ))}
          </ol>
        </section>

        <section className="af-vis" aria-label="Authorization flow diagram">
          <DiagramStepBar stepper={stepper} caption={current ? current.label : ""} testId="af-step-bar" />
          <button type="button" className="af-theme" aria-pressed={theme === "dark"} onClick={toggleTheme}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <ReactFlowProvider>
            <Visualiser moment={moment} stepper={stepper} theme={theme} vertical={vertical} />
          </ReactFlowProvider>
          <p className="af-proves"><strong>{moment.num}</strong> {moment.proves}</p>
          {done ? (
            <p role="status" className={`af-outcome af-outcome--${moment.outcome.kind}`}>{moment.outcome.text}</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
