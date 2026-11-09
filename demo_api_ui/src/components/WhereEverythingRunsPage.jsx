// WhereEverythingRunsPage.jsx - /where-everything-runs: a movable ReactFlow map of where the platform's software runs
// (the Mac in Docker, Kubernetes namespaces, SaaS), with a Today / After toggle. After = Kubernetes for servers only,
// every front end in Docker on the Mac. The in-app twin of the standalone env-map-LAB app.
//
// The BFF cannot run kubectl or docker, so this page draws a bundled, sanitized SAMPLE (config/whereRunsSample.js).
// A Real snapshot of your own machine is the standalone's job (ENV_MAP_URL below).
//
// Ping UI Standard (docs/ping-ui-primitives.md): banner first (P2), frame and sections (P3), the detail panel is a card (P4),
// the "what changes" counts are a key-value list (P5), every chip carries a word (P7), one primary button (P9: "Reset layout").
// Every status here is recorded sample data, not something this page checked, so state chips are neutral; only the
// what-if plan chips (computed by this page from each workload's role) use the info tone.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import PageHeader from "./common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, StatusChip } from "./pingUi";
import { WHERE_RUNS_SAMPLE } from "../config/whereRunsSample";
import { ROLE_WORD, buildFlow, buildViews, chooseViewport } from "../utils/whereRunsModel";
import "./WhereEverythingRunsPage.css";

export const ENV_MAP_URL = "http://localhost:7805";
export const AFTER_NOTE = "After: Kubernetes for servers only, every front end in Docker on the Mac. Computed from each workload's role; it is a what-if, not a plan.";

const STATE_WORD = { up: "up", off: "at 0", down: "down", partial: "partly up", na: "service" };
const CHANGE_SECTIONS = [
  ["toDeploy", "To deploy on Kubernetes"],
  ["toScaleUp", "To scale up"],
  ["removed", "Removed from Kubernetes"],
  ["movedToLocal", "Moved to the Mac"],
  ["alreadyLocal", "Already on the Mac"],
  ["leavesLocal", "Already on Kubernetes"],
  ["stoppedLocalServers", "Stopped on the Mac, not planned"],
];

function Region({ data }) {
  const r = data.region;
  return (
    <div className={`wr-region wr-tone-${data.tone}`} data-testid={`wr-region-${r.envId}`}>
      <div className="wr-region__label"><b>{r.label}</b><span>{r.subtitle}</span></div>
    </div>
  );
}

const workloadCount = (n) => `${n} ${n === 1 ? "workload" : "workloads"}`;
const SIDES = [["l", Position.Left], ["r", Position.Right], ["t", Position.Top], ["b", Position.Bottom]];
function Card({ data, selected }) {
  const c = data.card;
  return (
    <div className={`wr-card wr-tone-${data.tone}${selected ? " is-selected" : ""}${c.off ? " wr-card--off" : ""}`} style={{ "--wr-card-w": `${data.cw}px` }} data-testid={`wr-card-${c.id}`}>
      {SIDES.map(([id, position]) => (
        <React.Fragment key={id}>
          <Handle id={id} type="source" position={position} isConnectable={false} />
          <Handle id={`${id}-in`} type="target" position={position} isConnectable={false} />
        </React.Fragment>
      ))}
      <div className="wr-card__title">
        <PickButton card={c} selected={selected} />
        {c.chip && <StatusChip tone="neutral">{c.chip}</StatusChip>}
      </div>
      <div className="wr-card__sub">{c.subtitle}</div>
    </div>
  );
}
const nodeTypes = { region: Region, card: Card };

// Fit everything, but never start below MIN_ZOOM (whereRunsModel): a big view first, pan for the rest.
function Canvas({ view, viewName, resetNonce }) {
  const flow = useMemo(() => buildFlow(view), [view]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  const [sel, setSel] = useState(null);
  const [zoom, setZoom] = useState(null);
  const { fitView, getViewport, setViewport } = useReactFlow();
  const timer = useRef(null);

  const bigStart = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await fitView({ padding: 0.02 });
      const fitted = getViewport();
      const next = chooseViewport(fitted);
      if (next !== fitted) await setViewport(next);
      setZoom(next.zoom);
    }, 80);
  }, [fitView, getViewport, setViewport]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // A new view starts from the computed layout.
  useEffect(() => { setNodes(flow.nodes); setEdges(flow.edges); setSel(null); bigStart(); }, [flow, setNodes, setEdges, bigStart]);
  // Reset layout: box positions back to the computed ones.
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return; }
    setNodes(flow.nodes); setSel(null); bigStart();
  }, [resetNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => nodes.map((n) => (n.type === "card" ? { ...n, selected: n.id === sel } : n)), [nodes, sel]);
  const info = sel ? flow.cardInfo.get(sel) : null;
  return (
    <div className="wr-stage" data-testid="wr-stage" data-view={viewName} data-zoom={zoom === null ? "" : zoom.toFixed(3)}>
      {/* Mounted with the canvas, before any text lands in it, so the pick is announced once. */}
      <p className="wr-sr" role="status" data-testid="wr-selection-status">{info ? `Showing ${info.card.title}, ${workloadCount(info.card.count)}.` : ""}</p>
      <div className="wr-canvas" role="region" aria-label="Diagram of where everything runs">
        <ReactFlow
          nodes={shown} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          minZoom={0.15} maxZoom={1.6} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable fitView
          onNodeClick={(_e, n) => { if (n.type === "card") setSel(n.id); }}
          onPaneClick={() => setSel(null)}
          onMove={(_e, vp) => setZoom((z) => (z !== null && Math.abs(z - vp.zoom) < 0.001 ? z : vp.zoom))}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <SidePanel info={info} view={view} />
    </div>
  );
}

export default function WhereEverythingRunsPage() {
  const views = useMemo(() => buildViews(WHERE_RUNS_SAMPLE), []);
  const [viewName, setViewName] = useState("today");
  const [resetNonce, setResetNonce] = useState(0);
  return (
    <PingPage className="wr-page">
      <SimBanner data-testid="wr-banner">
        <strong>Sample data.</strong> This map is a bundled, sanitized sample (workload names and replica counts only), not a reading of any machine. The
        app server cannot run kubectl or docker, so nothing here was checked: every count and state is as recorded in the sample. For a Real snapshot of your own machine, open the standalone <a href={ENV_MAP_URL} target="_blank" rel="noreferrer">Where Everything Runs app</a> ({ENV_MAP_URL}).
      </SimBanner>
      <PageHeader
        eyebrow="Platform map"
        title="Where Everything Runs"
        summary="Where the platform's software runs: your Mac in Docker, Kubernetes namespaces and SaaS. Drag the boxes, click a box for its workloads, and flip to After to see Kubernetes for servers only with every front end in Docker on the Mac."
        badge="Sample data"
      />
      <PageFrame>
        <Section id="wr-arrangement-h" kicker="1 · Arrangement" title="Today or After" lede="Today is the sample as recorded. After is a what-if computed from each workload's role.">
          <div className="pu-actions wr-toolbar">
            <div className="wr-seg" role="group" aria-label="Which arrangement">
              <button type="button" className="pu-btn" aria-pressed={viewName === "today"} data-testid="wr-view-today" onClick={() => setViewName("today")}>Today</button>
              <button type="button" className="pu-btn" aria-pressed={viewName === "after"} data-testid="wr-view-after" onClick={() => setViewName("after")} title="After: Kubernetes for servers only, every front end in Docker on the Mac">After: Kubernetes for servers only</button>
            </div>
            {/* The one primary in both view states: the only action on the page that changes something (box positions). */}
            <button type="button" className="pu-btn pu-btn--primary" data-testid="wr-reset" onClick={() => setResetNonce((n) => n + 1)}>Reset layout</button>
            <span className="wr-legend">
              <span><i className="wr-sw wr-tone-local" />Mac (Docker)</span>
              <span><i className="wr-sw wr-tone-k8s0" />Kubernetes namespaces</span>
              <span><i className="wr-sw wr-tone-saas" />SaaS</span>
              <span><i className="wr-ln" />seen</span>
              <span><i className="wr-ln wr-ln--dashed" />configured only</span>
            </span>
          </div>
          <p className="pu-note" data-testid="wr-stamp">Sample taken {views.takenAt.slice(0, 10)}. {views.counts.workloads} workloads in {views.counts.environments} environments.</p>
          <div role="status">
            {viewName === "after" && <p className="wr-notice" data-testid="wr-after-note">{AFTER_NOTE}</p>}
          </div>
        </Section>
        <Section id="wr-map-h" kicker="2 · The map" title="Boxes and links" lede="Drag a box to move it. Select a box for its workloads.">
          <ReactFlowProvider>
            <Canvas key={viewName} view={views[viewName]} viewName={viewName} resetNonce={resetNonce} />
          </ReactFlowProvider>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// The keyboard way to pick a box: Tab to it, Enter or Space. The click bubbles to the node, which does the selecting.
// Defined after the page so the banner stays the first element in the file for the pattern check (P2).
function PickButton({ card, selected }) {
  return (
    <button type="button" className="wr-card__pick" aria-pressed={Boolean(selected)} aria-label={`${card.title}, ${workloadCount(card.count)}`} data-testid={`wr-pick-${card.id}`}>
      <b>{card.title}</b>
    </button>
  );
}

// The detail panel is a .pu-card. Defined after the page, with PickButton, so the banner is the first element in the file (P2).
function SidePanel({ info, view }) {
  if (!info) {
    return (
      <aside className="wr-side pu-card" aria-label="Box details" data-testid="wr-side">
        <h3 className="pu-h3">Pick a box</h3>
        <p className="pu-note">Click any box, or Tab to it and press Enter, to see the workloads behind it.</p>
        <p className="pu-note">Solid lines are links seen in config or logs. Dashed lines are configured only.</p>
        {view.changes && (
          <>
            <h3 className="pu-h3 wr-side__gap">What changes</h3>
            <dl className="pu-kv" data-testid="wr-changes">
              {CHANGE_SECTIONS.flatMap(([key, title]) => [
                <dt key={`${key}-k`}>{title}</dt>,
                <dd key={`${key}-v`} data-testid={`wr-change-${key}`}>{view.changes[key].length}</dd>,
              ])}
            </dl>
          </>
        )}
      </aside>
    );
  }
  const { card, region } = info;
  return (
    <aside className="wr-side pu-card" aria-label="Box details" data-testid="wr-side">
      <h3 className="pu-h3" data-testid="wr-side-title">{card.title}</h3>
      <p className="pu-note">{region.label}. {workloadCount(card.count)}.</p>
      <ul className="wr-items" data-testid="wr-side-list">
        {card.workloads.map((w) => (
          <li key={w.name}>
            <span className="pu-mono">{w.name}</span>
            <span className="wr-tags">
              <StatusChip tone="neutral">{STATE_WORD[w.state]}{w.state === "na" ? "" : ` ${w.ready}/${w.want}`}</StatusChip>
              <StatusChip tone="neutral">{ROLE_WORD[w.role]}</StatusChip>
              {w.plan === "deploy" && <StatusChip tone="info">to deploy, from {w.movedFrom}</StatusChip>}
              {w.plan === "scaleup" && <StatusChip tone="info">to scale up</StatusChip>}
              {w.plan === "moved" && <StatusChip tone="info">moved from {w.movedFrom}</StatusChip>}
            </span>
          </li>
        ))}
      </ul>
      {card.note && <p className="pu-note">{card.note}</p>}
    </aside>
  );
}
