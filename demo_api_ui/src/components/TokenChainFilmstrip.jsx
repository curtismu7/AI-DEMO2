// Focus Mode — horizontal token chain with a raised detail sheet.
// Spec: docs/superpowers/specs/2026-08-08-focus-mode-filmstrip-design.md
//
// A SIBLING of TokenChainTraceRail, never a fork and never an edit to it: that
// rail mounts on ~20 surfaces, so its geometry is not ours to change. This
// subscribes to the same store, derives steps with the same helpers, and renders
// the same child panels. Only the geometry is new — the chain lies along the
// bottom so a click can raise a sheet across the whole width, instead of living
// in the narrowest column on screen.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { MCP_STEP_IDS, chainBadge } from "../services/tokenChainTrace/buildTraceSteps";
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
// Same key TokenChainTraceRail persists under — one text-size setting shared
// across both surfaces rather than two independently-remembered ones.
const ZOOM_KEY = "tctr:zoom";
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;

function readStoredZoom() {
  try {
    const v = Number(window.localStorage.getItem(ZOOM_KEY));
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1;
  } catch {
    return 1;
  }
}

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

// Before any run, the bottom chain has nothing to render — a bare dashed box
// reads as broken. These are the pipeline stages a live run will fill in,
// shown empty (no fabricated claims/tokens) purely so the strip isn't blank.
const PREVIEW_STAGES = [
  { id: "signin", label: "Sign-in", color: "#f472b6", bg: "rgba(244,114,182,0.14)" },
  { id: "agent", label: "Agent", color: "#c084fc", bg: "rgba(192,132,252,0.14)" },
  { id: "exchange", label: "Token Exchange", color: "#60a5fa", bg: "rgba(96,165,250,0.14)" },
  { id: "authorize", label: "Authorize", color: "#fbbf24", bg: "rgba(251,191,36,0.14)" },
  { id: "mcp", label: "MCP", color: "#34d399", bg: "rgba(52,211,153,0.14)" },
  { id: "reply", label: "Reply", color: "#94a3b8", bg: "rgba(148,163,184,0.14)" },
];

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
  const [zoom, setZoom] = useState(readStoredZoom);
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
    try {
      window.localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      /* private mode — session-only */
    }
  }, [zoom]);

  const stepZoom = useCallback((delta) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10)));
  }, []);

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
  const steps = useMemo(
    () => (viewMode === "classic" ? classicSteps : buildLiveTokenChainSteps(classicSteps, trace)),
    [viewMode, classicSteps, trace],
  );
  const badge = chainBadge(trace, classicSteps);

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

  // Two regions, deliberately siblings rather than nested: the dashboard grid
  // places the spotlight beside the agent and the chain across the full width
  // beneath both. `.tcfs` is display:contents so these become grid items of the
  // dashboard, which is what lets one component serve both layouts.
  return (
    <section className="tcfs" aria-label="Token chain">
      <div className="tcfs-spotlight">
      <div className="tcfs-head">
        <span className="tcfs-title">Token Chain</span>
        <span className="tcfs-dots">
          <span className="tcfs-dot tcfs-dot--user" /> User
          <span className="tcfs-arrow">→</span>
          <span className="tcfs-dot tcfs-dot--agent" /> Agent
          <span className="tcfs-arrow">→</span>
          <span className="tcfs-dot tcfs-dot--mcp" /> MCP
        </span>
        <span className={`tcfs-badge tcfs-badge--${badge.tone}`}>{badge.label}</span>
        <div className="tcfs-actions">
          <ChainViewMenu
            steps={steps}
            showTrust={showTrust}
            mcpCount={mcpDone}
            onOpenView={(id) => {
              // Topology opens the existing TokenTopologyPanel modal (App.js),
              // not an inline sheet view — same event the AIAgent header ⊞ uses.
              if (id === "topology") {
                window.dispatchEvent(new CustomEvent("token-topology-open"));
                return;
              }
              setView(id);
              setActiveStepId(null);
            }}
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

        {sheetOpen ? (
          <section className="tcfs-sheet"
            aria-label={view ? `${VIEW_LABELS[view] || "Chain"} view` : "Step detail"}>
            <div className="tcfs-sheet-head">
              <span className="tcfs-sheet-title">{view ? VIEW_LABELS[view] || "Chain" : "Step detail"}</span>
              <div className="tcfs-zoom" role="group" aria-label="Token chain text size">
                <button
                  type="button"
                  className="tcfs-zoom-btn"
                  onClick={() => stepZoom(-ZOOM_STEP)}
                  disabled={zoom <= ZOOM_MIN}
                  title="Smaller text"
                  aria-label="Decrease token chain text size"
                >
                  A-
                </button>
                <button
                  type="button"
                  className="tcfs-zoom-pct"
                  onClick={() => setZoom(1)}
                  disabled={zoom === 1}
                  title="Reset text size"
                  aria-label="Reset token chain text size"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className="tcfs-zoom-btn"
                  onClick={() => stepZoom(ZOOM_STEP)}
                  disabled={zoom >= ZOOM_MAX}
                  title="Larger text"
                  aria-label="Increase token chain text size"
                >
                  A+
                </button>
              </div>
              <button type="button" className="tcfs-sheet-close" onClick={closeSheet} aria-label="Close detail">
                ✕
              </button>
            </div>
            {/* `tctr` is deliberate. The panels below — TraceMcpPanel,
                TraceTokenSummary, the steppers — get their dark palette from 28
                rules in TokenChainTraceRail.css scoped to
                `:root[data-theme="dark"] .tctr …`. Rendered outside that class
                they kept light-mode colours on this dark surface: measured
                rgb(17,17,16) text on rgb(11,20,38), a contrast ratio of 1.03:1
                — invisible. Carrying the class re-uses the rail's palette
                instead of duplicating 28 declarations that would then have to
                be kept in sync. */}
            <div className="tcfs-sheet-body tctr" style={{ zoom }}>
              {view ? renderView() : <StepDetailPanel step={activeStep} onInspect={onInspect} />}
            </div>
          </section>
        ) : (
          // The spotlight is the right column, so it must never be empty — an
          // empty half-screen reads as broken. Say what to do instead.
          <div className="tcfs-spotlight-empty">
            <div className="tcfs-spotlight-intro">
              <div className="tcfs-spotlight-intro-title">What this panel shows</div>
              <ul className="tcfs-spotlight-intro-list">
                <li>Every hop's token — issuer, audience, scopes, and the nested <code>act</code> chain (RFC 8693)</li>
                <li>Who is acting on whose behalf, proven cryptographically at each step</li>
                <li>Live claims you can inspect, not just a diagram</li>
              </ul>
              <div className="tcfs-spotlight-intro-value">
                Token exchange means every downstream service gets proof of the
                original user AND every agent that acted on their behalf — no
                blanket credentials, no impersonation, full auditability end to end.
              </div>
              <div className="tcfs-spotlight-intro-cta">
                {steps.length === 0
                  ? "Run an agent request below to populate it."
                  : "Pick a step on the chain below to see what it changed."}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="tcfs-chain">
        <details className="tcfs-chain-acc" open>
          <summary className="tcfs-label">
            <span className="tcfs-chev">▶</span>
            {trace.prompt
              ? `${viewMode === "live" ? "Live pipeline" : "Pipeline"} — "${trace.prompt.message}"`
              : `${viewMode === "live" ? "Live pipeline" : "Pipeline"} — awaiting agent action`}
          </summary>

          {viewMode === "live" && steps.length === 0 ? (
            <div className="tcfs-empty-preview">
              {PREVIEW_STAGES.map((s) => (
                <div key={s.id} className="tcfs-empty-chip" style={{ borderColor: s.color, background: s.bg }}>
                  <span className="tcfs-empty-chip-dot" style={{ background: s.color }} />
                  <span className="tcfs-empty-chip-label">{s.label}</span>
                </div>
              ))}
            </div>
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
        </details>
      </div>

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
