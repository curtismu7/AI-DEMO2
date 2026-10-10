// UseCaseDiagramPage.jsx — the shared page behind /use-case-diagrams/:ucId.
//
// Reads the UC config from the registry; renders:
//   - header: title/what/businessValue from demoStepGuides, demo step number
//     from demoStepNumbers, result verdict from the config — imported, never copied;
//   - the diagram via StaticFlowDiagram with a page-owned useDiagramStepper
//     (Play/Step bar, movie reel and controls are the shared ones);
//   - the details panel: UC context block, node details on click, and per-hop
//     wire rows (walk[].tech) below the diagram.
//
// The open state matches the approved mock: hop 1 active and paused, entry
// node ringed — diagram and details visible with zero clicks.
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import StaticFlowDiagram from "./StaticFlowDiagram";
import DiagramStepBar from "./DiagramStepBar";
import { useDiagramStepper } from "../hooks/useDiagramStepper";
import { CONFIGS, getConfig } from "../config/useCaseDiagrams";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";
import { demoStepNumber } from "../config/demoStepNumbers";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { buildLiveUcWalk } from "../services/tokenChainTrace/ucLiveOverlay";
import "./UseCaseDiagramPage.css";

const TONE_CLASS = { ok: "ucd-pill--ok", warn: "ucd-pill--warn", err: "ucd-pill--err", info: "ucd-pill--info" };

function WireRows({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="ucd-wire" data-testid="ucd-wire">
      {rows.map((r, i) => (
        <div key={i} className="ucd-wire__row">
          <span className={`ucd-wire__tag ucd-wire__tag--${r.t.toLowerCase()}`}>{r.t}</span>
          <code>{r.c}</code>
        </div>
      ))}
    </div>
  );
}

export default function UseCaseDiagramPage() {
  const { ucId } = useParams();
  const cfg = getConfig(ucId);
  // The trace store decides whether this page shows the curated walk or the
  // live overlay: a run whose use-case slug matches this config's slug
  // rebuilds the walk from the hops that run actually performed.
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);

  const liveWalk = useMemo(
    () => (cfg ? buildLiveUcWalk(cfg, snap.trace, snap.steps) : null),
    [cfg, snap.trace, snap.steps],
  );
  const activeWalk = liveWalk || cfg?.walk || [];
  const stepper = useDiagramStepper(cfg ? activeWalk.length : 0);
  // the node the presenter picked on the diagram (null = panel shows the hop/UC)
  const [pickedNode, setPickedNode] = useState(null);

  const guide = cfg ? DEMO_STEP_GUIDES[cfg.id] : null;
  const stepNum = cfg ? demoStepNumber(cfg.id) : null;

  // Open state per the approved mock: hop 1 active and paused, entry node
  // ringed — diagram and its details are visible with zero clicks. goTo sets
  // paused=true, so Prev/Next work immediately.
  // A run landing on (or leaving) this page is a new story: restart the walk
  // so the stepper never points past the end of a switched walk.
  useEffect(() => {
    if (cfg) stepper.goTo(0);
    setPickedNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.id, activeWalk.length]);

  if (!cfg) {
    return (
      <main className="ucd-page" data-testid="ucd-missing">
        <h1>No diagram yet</h1>
        <p>No use-case diagram exists for “{ucId}”. Available:</p>
        <ul>
          {CONFIGS.map((c) => (
            <li key={c.id}><Link to={`/use-case-diagrams/${c.id}`}>{c.id}</Link></li>
          ))}
        </ul>
      </main>
    );
  }

  const hop = stepper.step >= 0 ? activeWalk[stepper.step] : null;
  // panel: node pick wins, then the active hop, then the UC context
  const picked = pickedNode != null ? cfg.NODES.find((n) => n.id === pickedNode) : null;
  const panel = picked
    ? {
        chip: picked.label.toUpperCase(),
        head: picked.label,
        lines: [{ who: "", text: picked.detail || "" }],
        tech: activeWalk.filter((w) => w.nodes.includes(pickedNode)).flatMap((w) => w.tech),
      }
    : hop
      ? {
          chip: `HOP ${stepper.step + 1} / ${activeWalk.length}`,
          head: hop.title,
          lines: hop.lines || [],
          tech: hop.tech,
        }
      : {
          chip: "DETAILS",
          head: guide?.title || cfg.id,
          lines: [],
          tech: activeWalk[0]?.tech || [],
        };

  return (
    <main className="ucd-page">
      <header className="ucd-head">
        <div className="ucd-head__row1">
          <Link to="/dashboard" className="ucd-back" data-testid="ucd-back"
            title="Back to the dashboard — Mission Control reopens where the demo left off">
            ← Back to dashboard
          </Link>
          {stepNum != null && (
            <Link to={`/use-cases#${cfg.id}`} className="ucd-cue" title={`Run this step live on /use-cases — it is step ${stepNum} of the demo script`}>
              Run this step ↗
            </Link>
          )}
          <h1 data-testid="ucd-title">{guide?.title || cfg.id}</h1>
          <span className={`ucd-pill ${TONE_CLASS[cfg.result.tone]}`} data-testid="ucd-result">{cfg.result.label}</span>
          <span className="ucd-pill ucd-pill--info" data-testid="ucd-mode">
            {liveWalk ? "Live run overlay" : "Curated walkthrough"}
          </span>
          <span className="ucd-id">{cfg.id}</span>
          <span className="ucd-meta">Demo step <b data-testid="ucd-step">{stepNum ?? "—"}</b></span>
        </div>
        <p className="ucd-desc" data-testid="ucd-desc">{guide?.what || ""}</p>
        <p className="ucd-value" data-testid="ucd-value"><span>Business value</span>{guide?.businessValue || ""}</p>
      </header>

      <DiagramStepBar
        stepper={stepper}
        testId={`ucd-stepbar-${cfg.id.toLowerCase()}`}
      />

      <StaticFlowDiagram
        NODES={cfg.NODES}
        EDGES={cfg.EDGES}
        GROUPS={cfg.GROUPS}
        walk={activeWalk}
        stepper={stepper}
        onNodeClick={(node) => setPickedNode((prev) => (prev === node.id ? null : node.id))}
        testId={`ucd-${cfg.id.toLowerCase()}`}
        ariaLabel={`${guide?.title || cfg.id} walkthrough`}
      />

      <section className="ucd-panel" data-testid="ucd-panel">
        <span className="ucd-panel__chip">{panel.chip}</span>
        <div className="ucd-panel__body">
          {hop || picked ? (
            <>
              <div className="ucd-panel__hop"><b>{panel.head}</b>{hop?.label ? ` — ${hop.label}` : ""}</div>
              {picked ? null : panel.lines.map((l, i) => (
                <p key={i} className="ucd-panel__line">{l.who ? `${l.who}: ` : ""}{l.text}</p>
              ))}
              <WireRows rows={panel.tech} />
            </>
          ) : (
            <>
              <p className="ucd-panel__hint">Press Simulate to walk the diagram; click a node for its detail.</p>
              <WireRows rows={panel.tech} />
            </>
          )}
        </div>
        <span className="ucd-panel__step" data-testid="ucd-hop-label">
          {stepper.step >= 0 ? `${stepper.step + 1} / ${activeWalk.length}` : `0 / ${activeWalk.length}`}
        </span>
      </section>

      <nav className="ucd-next" aria-label="More use-case diagrams">
        {CONFIGS.filter((c) => c.id !== cfg.id).map((c) => (
          <Link key={c.id} className="ucd-next__link" to={`/use-case-diagrams/${c.id}`}>{c.id}</Link>
        ))}
      </nav>
    </main>
  );
}
