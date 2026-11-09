// WhereEverythingRunsPage.jsx - /where-everything-runs: a movable ReactFlow map of where the platform's software runs
// (the Mac in Docker, Kubernetes namespaces, SaaS), with a Today / After toggle. After = Kubernetes for servers only,
// every front end in Docker on the Mac. The in-app twin of the standalone env-map-LAB app.
//
// The BFF cannot run kubectl or docker, so this page draws a bundled, sanitized SAMPLE (config/whereRunsSample.js).
// A Real snapshot of your own machine is the standalone's job (ENV_MAP_URL below).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import PageHeader from "./common/PageHeader";
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
      <div className="wr-card__title"><b>{c.title}</b>{c.chip && <span className={`wr-chip${c.off ? " wr-chip--off" : ""}`}>{c.chip}</span>}</div>
      <div className="wr-card__sub">{c.subtitle}</div>
    </div>
  );
}
const nodeTypes = { region: Region, card: Card };

function SidePanel({ info, view }) {
  if (!info) {
    return (
      <aside className="wr-side" aria-live="polite" data-testid="wr-side">
        <h2>Pick a box</h2>
        <p className="wr-side__sub">Click any card to see the workloads behind it.</p>
        <p className="wr-side__note">Solid lines are links seen in config or logs. Dashed lines are configured only.</p>
        {view.changes && (
          <>
            <h2 className="wr-side__gap">What changes</h2>
            <ul className="wr-changes" data-testid="wr-changes">
              {CHANGE_SECTIONS.map(([key, title]) => (
                <li key={key} data-testid={`wr-change-${key}`}>{title} <span className="wr-count">{view.changes[key].length}</span></li>
              ))}
            </ul>
          </>
        )}
      </aside>
    );
  }
  const { card, region } = info;
  return (
    <aside className="wr-side" aria-live="polite" data-testid="wr-side">
      <h2 data-testid="wr-side-title">{card.title}</h2>
      <p className="wr-side__sub">{region.label}. {card.count} {card.count === 1 ? "workload" : "workloads"}.</p>
      <ul className="wr-items" data-testid="wr-side-list">
        {card.workloads.map((w) => (
          <li key={w.name}>
            <span className="wr-mono">{w.name}</span>
            <span className="wr-tags">
              <span className={`wr-tag wr-tag--${w.state}`}>{STATE_WORD[w.state]}{w.state === "na" ? "" : ` ${w.ready}/${w.want}`}</span>
              <span className="wr-tag">{ROLE_WORD[w.role]}</span>
              {w.plan === "deploy" && <span className="wr-tag wr-tag--plan">to deploy, from {w.movedFrom}</span>}
              {w.plan === "scaleup" && <span className="wr-tag wr-tag--plan">to scale up</span>}
              {w.plan === "moved" && <span className="wr-tag wr-tag--plan">moved from {w.movedFrom}</span>}
            </span>
          </li>
        ))}
      </ul>
      {card.note && <p className="wr-side__note">{card.note}</p>}
    </aside>
  );
}

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
      <div className="wr-canvas" aria-label="Diagram of where everything runs">
        <ReactFlow
          nodes={shown} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          minZoom={0.15} maxZoom={1.6} nodesConnectable={false} elementsSelectable fitView
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
    <div className="wr-page">
      <PageHeader
        eyebrow="Platform map"
        title="Where Everything Runs"
        summary="Where the platform's software runs: your Mac in Docker, Kubernetes namespaces and SaaS. Drag the boxes, click a box for its workloads, and flip to After to see Kubernetes for servers only with every front end in Docker on the Mac."
        badge="Sample data"
      />
      <div className="wr-body">
        <div className="wr-banner" role="note" data-testid="wr-banner">
          <strong>Sample data.</strong> This map is a bundled, sanitized sample (workload names and replica counts only), not a reading of any machine. The
          app server cannot run kubectl or docker. For a Real snapshot of your own machine, open the standalone <a href={ENV_MAP_URL} target="_blank" rel="noreferrer">Where Everything Runs app</a> ({ENV_MAP_URL}).
        </div>
        <div className="wr-toolbar">
          <span className="wr-seg" role="group" aria-label="Which arrangement">
            <button type="button" aria-pressed={viewName === "today"} data-testid="wr-view-today" onClick={() => setViewName("today")}>Today</button>
            <button type="button" aria-pressed={viewName === "after"} data-testid="wr-view-after" onClick={() => setViewName("after")} title="After: Kubernetes for servers only, every front end in Docker on the Mac">After: Kubernetes for servers only</button>
          </span>
          <button type="button" className="wr-btn" data-testid="wr-reset" onClick={() => setResetNonce((n) => n + 1)}>Reset layout</button>
          <span className="wr-legend">
            <span><i className="wr-sw wr-tone-local" />Mac (Docker)</span>
            <span><i className="wr-sw wr-tone-k8s0" />Kubernetes namespaces</span>
            <span><i className="wr-sw wr-tone-saas" />SaaS</span>
            <span><i className="wr-ln" />seen</span>
            <span><i className="wr-ln wr-ln--dashed" />configured only</span>
          </span>
        </div>
        <p className="wr-meta" data-testid="wr-stamp">Sample taken {views.takenAt.slice(0, 10)}. {views.counts.workloads} workloads in {views.counts.environments} environments.</p>
        {viewName === "after" && <p className="wr-notice" data-testid="wr-after-note">{AFTER_NOTE}</p>}
        <ReactFlowProvider>
          <Canvas key={viewName} view={views[viewName]} viewName={viewName} resetNonce={resetNonce} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
