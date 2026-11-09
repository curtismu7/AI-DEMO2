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
import PageHeader from "../components/common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip } from "../components/pingUi";
import AuthorizationFlowDetail, { StepList } from "./AuthorizationFlowDetail";
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
const appTheme = () => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
const laneIndex = Object.fromEntries(lanesFor(DEFAULT_VERTICAL).map((l, i) => [l.id, i]));

// The arrowhead colour is a CSS variable of the canvas (--af-arrow / --af-ok / --af-block), so the dark and light
// palettes in AuthorizationFlowPage.css restyle the markers without rebuilding the edges.
const ARROW_VAR = { plain: "var(--af-arrow)", ok: "var(--af-ok)", block: "var(--af-block)" };

function edgeFor(step, i, hot) {
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
    markerEnd: { type: MarkerType.ArrowClosed, color: ARROW_VAR[tone] },
    className: `af-edge af-edge--${tone}${hot ? " af-edge--hot" : ""}`,
  };
}

function Visualiser({ moment, stepper, theme, vertical, layoutKey }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(startNodes(vertical));
  // A new vertical renames the system-of-record lane; boxes the viewer has dragged stay where they are.
  useEffect(() => {
    const names = Object.fromEntries(lanesFor(vertical).map((l) => [l.id, l]));
    setNodes((ns) => ns.map((n) => ({ ...n, data: names[n.id] })));
  }, [vertical, setNodes]);
  const { fitView } = useReactFlow();
  const shown = stepper.step;
  const edges = useMemo(
    () => moment.steps.slice(0, shown + 1).map((s, i) => edgeFor(s, i, i === shown)),
    [moment, shown],
  );

  useEffect(() => {
    // Refit when the detail panel moves: the diagram's column changes width.
    const id = setTimeout(() => fitView({ padding: 0.03 }), 120);
    return () => clearTimeout(id);
  }, [fitView, layoutKey]);

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

  // Where the step detail sits: under the diagram, or in a column beside it.
  const [detailSide, setDetailSide] = useState(false);
  const reached = stepper.step;
  const chat = moment.steps.slice(0, reached + 1).filter((s) => s.chat).map((s) => s.chat);
  const done = reached === moment.steps.length - 1;
  const current = reached >= 0 ? moment.steps[reached] : null;

  // P9, one primary per view state: this button is the only primary. Idle it starts the walkthrough; once one is
  // running, paused or jumped into from the step list it restarts it. The shared step bar keeps Simulate, Pause,
  // Resume, Prev, Next, Stop and Reset as secondaries. The button stays mounted, so keyboard focus stays on it.
  const playing = stepper.active;

  return (
    <PingPage className="af-page">
      <SimBanner data-testid="af-banner">
        <strong>SCRIPTED, NOT LIVE</strong> — This is a scripted walkthrough of six moments for {profile.org}{" "}
        ({profile.label}). Nothing on this page calls PingOne, a gateway, a model or a phone: the messages, the token
        claims and the amounts are written into the page, no token is minted and no check runs. Pick another vertical
        to retell the same moments for that business.
      </SimBanner>
      <PageHeader
        eyebrow="Learn · Authorization"
        title="Authorization Flow"
        summary={`An assistant acts for a customer without becoming the authority. PingOne signs the customer in, runs both token exchanges and the CIBA push; ${profile.org} decides.`}
      />
      <PageFrame>
        <Section
          id="af-choose-h"
          kicker="1 · Choose"
          title="A vertical and a moment"
          lede="Each vertical tells the same six moments with its own business, tool and system of record."
        >
          <Card tone="neutral" className="af-pick">
            <label className="pu-label" htmlFor="af-vertical">Vertical</label>
            <select id="af-vertical" className="pu-select af-vertical" value={vertical} onChange={(e) => pickVertical(e.target.value)}>
              {VERTICAL_OPTIONS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <p className="pu-label af-pick__moments" id="af-moments-l">Moment</p>
            <div className="pu-actions af-chips" role="tablist" aria-label="Moments">
              {moments.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={x.id === momentId}
                  className="pu-btn af-chip"
                  onClick={() => setMomentId(x.id)}
                >
                  <span>{x.num}</span> {x.chip}
                </button>
              ))}
            </div>
            <div className="pu-actions">
              <button type="button" className="pu-btn pu-btn--primary" data-testid="af-simulate" onClick={stepper.simulate}>
                {playing ? "Restart this moment" : "Simulate this moment"}
              </button>
            </div>
          </Card>
        </Section>

        <Section
          id="af-walk-h"
          kicker="2 · Walk it"
          title="The messages, one at a time"
          lede="Each arrow is one message. Drag a box to move it; the arrows follow."
        >
          <div className={`af-grid${detailSide ? " af-grid--side" : ""}`}>
            <Card className="af-vis" role="region" aria-label="Authorization flow diagram">
              <DiagramStepBar stepper={stepper} caption={current ? current.label : ""} testId="af-step-bar" />
              <div className="af-toggles">
                <button type="button" className="pu-btn af-theme" aria-pressed={detailSide} onClick={() => setDetailSide((v) => !v)}>
                  Detail on the side
                </button>
                <button type="button" className="pu-btn af-theme" aria-pressed={theme === "dark"} onClick={toggleTheme}>
                  Dark diagram
                </button>
              </div>
              <ReactFlowProvider>
                <Visualiser moment={moment} stepper={stepper} theme={theme} vertical={vertical} layoutKey={detailSide} />
              </ReactFlowProvider>
              <p className="pu-note af-proves"><strong>{moment.num}</strong> {moment.proves}</p>
              <div role="status" className="af-outcome-slot">
                {done ? (
                  <p className={`pu-status-line af-outcome af-outcome--${moment.outcome.kind}`}>
                    <StatusChip>{moment.outcome.kind === "block" ? "Refused (scripted)" : "Succeeds (scripted)"}</StatusChip>
                    <span>{moment.outcome.text}</span>
                  </p>
                ) : null}
              </div>
            </Card>
            {detailSide ? <AuthorizationFlowDetail moment={moment} vertical={vertical} stepIndex={reached} /> : null}
          </div>
        </Section>

        <Section
          id="af-follow-h"
          kicker="3 · Follow along"
          title="Conversation and steps"
          lede="The chat grows as the walkthrough reaches each message. Pick a step to jump to it."
        >
          <div className="af-story">
            <Card title="Conversation" className="af-chat">
              <p className="pu-note af-chat__prompt">{moment.prompt}</p>
              <ol className="af-chat__log" aria-live="polite">
                {chat.length === 0 ? <li className="af-chat__empty">Press Simulate to run this moment.</li> : null}
                {chat.map((c, i) => (
                  <li key={i} className={`af-bubble af-bubble--${c.role}`} data-who={c.role === "user" ? "You" : "Assistant"}>{c.text}</li>
                ))}
              </ol>
            </Card>
            <Card title="Steps" tone="neutral" className="af-steps">
              <StepList moment={moment} vertical={vertical} stepIndex={reached} onPick={stepper.goTo} />
            </Card>
          </div>
        </Section>

        {detailSide ? null : (
          <Section
            id="af-detail-h"
            kicker="4 · Detail"
            title="What is really happening"
            lede="Follows the step in focus. The values are illustrative; the shapes are the real PingOne ones."
          >
            <AuthorizationFlowDetail moment={moment} vertical={vertical} stepIndex={reached} />
          </Section>
        )}
      </PageFrame>
    </PingPage>
  );
}
