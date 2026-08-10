// Focus Mode — horizontal token chain with a raised detail sheet.
// Spec: docs/superpowers/specs/2026-08-08-focus-mode-filmstrip-design.md
//
// A SIBLING of TokenChainTraceRail, never a fork and never an edit to it: that
// rail mounts on ~20 surfaces, so its geometry is not ours to change. This
// subscribes to the same store, derives steps with the same helpers, and renders
// the same child panels. Only the geometry is new — the chain lies along the
// bottom so a click can raise a sheet across the whole width, instead of living
// in the narrowest column on screen.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { MCP_STEP_IDS } from "../services/tokenChainTrace/buildTraceSteps";
import { resolveInspectClaims } from "../services/tokenChainTrace/resolveInspectClaims";
import { isFlagOn, shouldShowTrustTab } from "../utils/tokenChainTrust";
import { useTokenChainOptional } from "../context/TokenChainContext";
import { useProofOfEnforcementOptional } from "../context/ProofOfEnforcementContext";
import { buildLiveTokenChainSteps } from "./TokenChainTraceRail";
import TokenChainNodeRail from "./TokenChainNodeRail";
import TokenChainPresenter from "./TokenChainPresenter";
import StepDetailPanel from "./StepDetailPanel";
import ChainViewMenu from "./ChainViewMenu";
import TraceTokenSummary from "./TraceTokenSummary";
import TraceMcpPanel from "./TraceMcpPanel";
import TraceTrustPanel from "./TraceTrustPanel";
import { SimpleStepper, DetailedStepper } from "./agent-clinical/TokensPane";
import ClaimDetailsModal from "./ClaimDetailsModal";
import TokenLegendModal from "./TokenLegendModal";
import TokenChainDemoTrackTab from "./TokenChainDemoTrackTab";
import "./TokenChainFilmstrip.css";

const VIEW_MODE_KEY = "tctr:view-mode";

// Same ids ChainViewMenu emits; the filmstrip decides what a view is.
const VIEW_LABELS = {
  tokens: "Tokens",
  mcp: "MCP",
  trust: "Trust",
  simple: "Simple",
  detailed: "Detailed",
  demoTrack: "Demo Track",
};

function readStoredViewMode() {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === "classic" ? "classic" : "live";
  } catch {
    return "live";
  }
}

export default function TokenChainFilmstrip() {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  const [viewMode, setViewMode] = useState(readStoredViewMode);
  const [activeStepId, setActiveStepId] = useState(null);
  const [view, setView] = useState(null); // chain-level view id, or null for step detail
  const [presenting, setPresenting] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [inspectType, setInspectType] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [trustFlags, setTrustFlags] = useState({ ffDpop: false, ffRar: false });
  const moreRef = useRef(null);

  const tokenChain = useTokenChainOptional();
  const proofUseCase = useProofOfEnforcementOptional()?.verdict || null;

  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* private mode — session-only */
    }
  }, [viewMode]);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data?.flags) return;
        const byId = {};
        for (const f of data.flags) byId[f.id] = f;
        setTrustFlags({ ffDpop: isFlagOn(byId.ff_dpop?.value), ffRar: isFlagOn(byId.ff_rar?.value) });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDocClick = (e) => { if (!moreRef.current?.contains(e.target)) setMoreOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const { trace } = snap;
  const classicSteps = snap.steps;
  const steps = viewMode === "classic" ? classicSteps : buildLiveTokenChainSteps(classicSteps, trace);

  // Clearing a run must drop the selection, the sheet and the presenter, or the
  // next run reopens whatever was left behind.
  useEffect(() => {
    if (steps.length === 0) {
      setPresenting(false);
      setActiveStepId(null);
    }
  }, [steps.length]);

  const hasTraceActivity = Boolean(
    trace.startedAt || trace.prompt || trace.tokenEvents?.length || trace.phases?.length ||
    trace.mcpResult || trace.authorize || trace.llmDetail || trace.llmReply || trace.outcome ||
    trace.routingMode,
  );
  const mcpDone = classicSteps.filter((s) => MCP_STEP_IDS.includes(s.id) && s.status === "done").length;
  const showTrust = shouldShowTrustTab({
    ffDpop: trustFlags.ffDpop, ffRar: trustFlags.ffRar, events: trace.tokenEvents,
  });

  const onInspect = useCallback((tokenType) => setInspectType(tokenType), []);

  const handleClear = useCallback(() => {
    tokenChainTraceStore.reset();
    tokenChain?.clearEvents?.();
    setInspectType(null);
    setLegendOpen(false);
    setActiveStepId(null);
    setView(null);
  }, [tokenChain]);

  const inspectClaims = inspectType ? resolveInspectClaims(trace.tokenEvents, inspectType) : null;
  const activeStep = activeStepId ? steps.find((s) => s.id === activeStepId) : null;
  const sheetOpen = Boolean(view || activeStep);

  const closeSheet = () => { setView(null); setActiveStepId(null); };

  const renderView = () => {
    switch (view) {
      case "tokens": return <TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} standalone />;
      case "mcp": return <TraceMcpPanel steps={classicSteps} trace={trace} onInspect={onInspect} useCase={proofUseCase} />;
      case "trust": return <TraceTrustPanel events={trace.tokenEvents} />;
      case "simple": return <SimpleStepper events={tokenChain?.events ?? []} />;
      case "detailed": return <DetailedStepper events={tokenChain?.events ?? []} />;
      case "demoTrack": return <TokenChainDemoTrackTab />;
      default: return null;
    }
  };

  return (
    <section className="tcfs" aria-label="Token chain">
      <div className="tcfs-head">
        <span className="tcfs-title">Token Chain</span>
        <span className="tcfs-dots">
          <span className="tcfs-dot tcfs-dot--user" /> User
          <span className="tcfs-arrow">→</span>
          <span className="tcfs-dot tcfs-dot--agent" /> Agent
          <span className="tcfs-arrow">→</span>
          <span className="tcfs-dot tcfs-dot--mcp" /> MCP
        </span>
        <span className="tcfs-badge">CHAINED</span>
        <div className="tcfs-actions">
          <ChainViewMenu
            steps={steps}
            showTrust={showTrust}
            mcpCount={mcpDone}
            onOpenView={(id) => { setView(id); setActiveStepId(null); }}
          />
          <div className="tcfs-more" ref={moreRef}>
            <button
              type="button"
              className="tcfs-more-trigger"
              aria-haspopup="true"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              More
            </button>
            {moreOpen ? (
              <div className="tcfs-more-pop">
                <div className="tcfs-mode" role="group" aria-label="Token chain view mode">
                  <button type="button" className={viewMode === "live" ? "active" : ""}
                    aria-pressed={viewMode === "live"} onClick={() => setViewMode("live")}>Live</button>
                  <button type="button" className={viewMode === "classic" ? "active" : ""}
                    aria-pressed={viewMode === "classic"} onClick={() => setViewMode("classic")}>Classic</button>
                </div>
                <button type="button" className="tcfs-more-btn" onClick={handleClear}
                  disabled={!hasTraceActivity} aria-label="Clear token chain">Clear</button>
                <button type="button" className="tcfs-more-btn" onClick={() => setLegendOpen(true)}>Legend</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="tcfs-label">
        {trace.prompt
          ? `${viewMode === "live" ? "Live pipeline" : "Pipeline"} — "${trace.prompt.message}"`
          : `${viewMode === "live" ? "Live pipeline" : "Pipeline"} — awaiting agent action`}
      </div>

      {viewMode === "live" && steps.length === 0 ? (
        <div className="tcfs-empty">Run an agent flow to build the token chain.</div>
      ) : (
        <div className="tcfs-track">
          <TokenChainNodeRail
            steps={steps}
            activeId={activeStepId}
            onPresent={() => {
              if (!activeStepId && steps.length > 0) setActiveStepId(steps[0].id);
              setPresenting(true);
            }}
            onSelect={(id) => { setActiveStepId(id); setView(null); }}
          />
        </div>
      )}

      {sheetOpen ? (
        <div className="tcfs-sheet" role="region"
          aria-label={view ? `${VIEW_LABELS[view] || "Chain"} view` : "Step detail"}>
          <div className="tcfs-sheet-head">
            <span className="tcfs-sheet-title">{view ? VIEW_LABELS[view] || "Chain" : "Step detail"}</span>
            <button type="button" className="tcfs-sheet-close" onClick={closeSheet} aria-label="Close detail">
              ✕
            </button>
          </div>
          <div className="tcfs-sheet-body">
            {view ? renderView() : <StepDetailPanel step={activeStep} onInspect={onInspect} />}
          </div>
        </div>
      ) : null}

      {presenting ? (
        <TokenChainPresenter
          steps={steps}
          activeId={activeStepId}
          onSelect={setActiveStepId}
          onClose={() => setPresenting(false)}
        />
      ) : null}

      <ClaimDetailsModal isOpen={!!inspectType} tokenType={inspectType || "user"}
        liveClaims={inspectClaims} onClose={() => setInspectType(null)} />
      <TokenLegendModal isOpen={legendOpen} onClose={() => setLegendOpen(false)} />
    </section>
  );
}
