// Compact full-pipeline trace rail for the portal token rails and the agent
// TokenChainModal. Single-column by construction (no viewport media queries).
// Spec: docs/superpowers/specs/2026-07-02-token-chain-trace-rail-design.md
import React, { useEffect, useState, useCallback } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { MCP_STEP_IDS, buildRunStory } from "../services/tokenChainTrace/buildTraceSteps";
import { resolveInspectClaims } from "../services/tokenChainTrace/resolveInspectClaims";
import { isFlagOn, shouldShowTrustTab } from "../utils/tokenChainTrust";
import { useTokenChainOptional } from "../context/TokenChainContext";
import { useProofOfEnforcementOptional } from "../context/ProofOfEnforcementContext";
import TraceStepCard from "./TraceStepCard";
import TraceTokenSummary from "./TraceTokenSummary";
import TraceMcpPanel from "./TraceMcpPanel";
import TraceTrustPanel from "./TraceTrustPanel";
import { SimpleStepper, DetailedStepper } from "./agent-clinical/TokensPane";
import ClaimDetailsModal from "./ClaimDetailsModal";
import TokenLegendModal from "./TokenLegendModal";
import TokenChainDemoTrackTab from "./TokenChainDemoTrackTab";
import "./TokenChainTraceRail.css";

const ZOOM_KEY = "tctr:zoom";
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;

/** Restore the presenter's saved rail scale, or 1 when unset/unreadable. */
function readStoredZoom() {
  try {
    const v = Number(window.localStorage.getItem(ZOOM_KEY));
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1;
  } catch {
    return 1;
  }
}

const CHAIN_DOTS = [
  { cls: "user", label: "User" },
  { cls: "agent", label: "Agent" },
  { cls: "mcp", label: "MCP" },
];

// mcpRouteOnly mode (vertical ops consoles): same trace data, but only the
// delegation-to-MCP hops, with the dots relabelled for the MCP route.
const MCP_ROUTE_DOTS = [
  { cls: "agent", label: "Agent (MCP Client)" },
  { cls: "mcp", label: "MCP Server" },
];

/**
 * Loads ff_dpop / ff_rar so Trust can appear for those use cases.
 * @param {(next: { ffDpop: boolean, ffRar: boolean }) => void} setFlags
 * @returns {() => void} unsubscribe / cancel
 */
function subscribeTrustFlags(setFlags) {
  let alive = true;
  const load = () => {
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data?.flags) return;
        const byId = {};
        for (const f of data.flags) byId[f.id] = f;
        setFlags({
          ffDpop: isFlagOn(byId.ff_dpop?.value),
          ffRar: isFlagOn(byId.ff_rar?.value),
        });
      })
      .catch(() => {});
  };
  load();
  const onFocus = () => load();
  window.addEventListener("focus", onFocus);
  return () => {
    alive = false;
    window.removeEventListener("focus", onFocus);
  };
}

export default function TokenChainTraceRail({ mcpRouteOnly = false }) {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  const [legendOpen, setLegendOpen] = useState(false);
  const [inspectType, setInspectType] = useState(null);
  const [tab, setTab] = useState(mcpRouteOnly ? "mcp" : "chain");
  const [trustFlags, setTrustFlags] = useState({ ffDpop: false, ffRar: false });
  const [zoom, setZoom] = useState(readStoredZoom);
  const tokenChain = useTokenChainOptional();
  // Names the running use case in each step's pop-out. Optional: several rail
  // mounts (Monitoring routes, standalone pages) sit outside the Proof provider.
  const proofUseCase = useProofOfEnforcementOptional()?.verdict || null;

  // Presenter text size — scales the whole rail so text, padding and dots stay
  // proportioned. Persisted so a projector setup survives a reload.
  useEffect(() => {
    try {
      window.localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      /* private mode / storage disabled — scale is session-only */
    }
  }, [zoom]);
  const stepZoom = useCallback((delta) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10)));
  }, []);

  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);
  useEffect(() => subscribeTrustFlags(setTrustFlags), []);
  const onInspect = useCallback((tokenType) => setInspectType(tokenType), []);

  /** Reset the rail to an empty “nothing done” pipeline for the next demo run. */
  const handleClear = useCallback(() => {
    tokenChainTraceStore.reset();
    tokenChain?.clearEvents?.();
    setInspectType(null);
    setLegendOpen(false);
    setTab(mcpRouteOnly ? "mcp" : "chain");
  }, [tokenChain, mcpRouteOnly]);

  const { trace } = snap;
  const steps = mcpRouteOnly
    ? snap.steps.filter((s) => MCP_STEP_IDS.includes(s.id))
    : snap.steps;
  const dots = mcpRouteOnly ? MCP_ROUTE_DOTS : CHAIN_DOTS;
  const mcpDone = steps.filter((s) => MCP_STEP_IDS.includes(s.id) && s.status === "done").length;
  const showTrust = shouldShowTrustTab({
    ffDpop: trustFlags.ffDpop,
    ffRar: trustFlags.ffRar,
    events: trace.tokenEvents,
  });
  const inspectClaims = inspectType ? resolveInspectClaims(trace.tokenEvents, inspectType) : null;
  const hasTraceActivity = Boolean(
    trace.startedAt || trace.prompt || (trace.tokenEvents && trace.tokenEvents.length) ||
    (trace.phases && trace.phases.length) || trace.mcpResult || trace.authorize ||
    trace.llmDetail || trace.llmReply || trace.outcome || trace.routingMode,
  );
  const runStory = buildRunStory(trace, snap.steps);

  // Drop Trust selection if the use case ends while that tab is open.
  useEffect(() => {
    if (!showTrust && tab === "trust") {
      setTab(mcpRouteOnly ? "mcp" : "chain");
    }
  }, [showTrust, tab, mcpRouteOnly]);

  return (
    <div className="tctr" style={{ zoom }}>
      <div className="tctr-head">
        <span className="tctr-title">Token Chain</span>
        <div className="tctr-head-actions">
          <div className="tctr-zoom" role="group" aria-label="Token chain text size">
            <button
              type="button"
              className="tctr-zoom-btn"
              onClick={() => stepZoom(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              title="Smaller token chain text"
              aria-label="Decrease token chain text size"
            >
              A-
            </button>
            <button
              type="button"
              className="tctr-zoom-pct"
              onClick={() => setZoom(1)}
              disabled={zoom === 1}
              title="Reset token chain text size"
              aria-label="Reset token chain text size"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="tctr-zoom-btn"
              onClick={() => stepZoom(ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              title="Larger token chain text"
              aria-label="Increase token chain text size"
            >
              A+
            </button>
          </div>
          <button
            type="button"
            className="tctr-clear-btn"
            onClick={handleClear}
            disabled={!hasTraceActivity}
            title="Clear token chain back to nothing done (ready for next demo run)"
            aria-label="Clear token chain"
          >
            Clear
          </button>
          <button type="button" className="tctr-legend-btn" onClick={() => setLegendOpen(true)}>
            Legend
          </button>
        </div>
      </div>

      <div className="tctr-chain-line">
        {dots.map((d, i) => (
          <React.Fragment key={d.cls}>
            {i > 0 && <span className="tctr-arrow">→</span>}
            <span className={`tctr-dot tctr-dot--${d.cls}`} /> {d.label}
          </React.Fragment>
        ))}
        <span className="tctr-badge">CHAINED</span>
      </div>

      <div className="tctr-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "chain"}
          className={`tctr-tab${tab === "chain" ? " tctr-tab--active" : ""}`}
          onClick={() => setTab("chain")}>
          Token Chain
        </button>
        <button type="button" role="tab" aria-selected={tab === "tokens"}
          className={`tctr-tab${tab === "tokens" ? " tctr-tab--active" : ""}`}
          onClick={() => setTab("tokens")}>
          Tokens
        </button>
        <button type="button" role="tab" aria-selected={tab === "mcp"}
          className={`tctr-tab${tab === "mcp" ? " tctr-tab--active" : ""}`}
          onClick={() => setTab("mcp")}>
          MCP <span className="tctr-tab-count">{mcpDone}</span>
        </button>
        {showTrust && (
          <button type="button" role="tab" aria-selected={tab === "trust"}
            className={`tctr-tab${tab === "trust" ? " tctr-tab--active" : ""}`}
            onClick={() => setTab("trust")}>
            Trust
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "simple"}
          className={`tctr-tab${tab === "simple" ? " tctr-tab--active" : ""}`}
          onClick={() => setTab("simple")}>
          Simple
        </button>
        <button type="button" role="tab" aria-selected={tab === "detailed"}
          className={`tctr-tab${tab === "detailed" ? " tctr-tab--active" : ""}`}
          onClick={() => setTab("detailed")}>
          Detailed
        </button>
        <button type="button" role="tab" aria-selected={tab === "demo-track"}
          className={`tctr-tab${tab === "demo-track" ? " tctr-tab--active" : ""}`}
          onClick={() => setTab("demo-track")}
          title="Guided Demo Track — live step tracker">
          Demo Track
        </button>
      </div>

      {tab === "chain" ? (
        <>
          {runStory && (
            <div
              className={`tctr-story tctr-story--${runStory.outcome}`}
              data-testid="tctr-run-story"
            >
              <div className="tctr-story-headline">{runStory.headline}</div>
              {runStory.bits.length > 0 && (
                <ul className="tctr-story-bits">
                  {runStory.bits.map((b) => (
                    <li key={b.slice(0, 48)}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="tctr-sec-label">
            {trace.prompt ? `Pipeline — "${trace.prompt.message}"` : "Pipeline — awaiting agent action"}
          </div>

          {steps.map((step) => (
            <TraceStepCard key={step.id} step={step} onInspect={onInspect} useCase={proofUseCase} />
          ))}

          <TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} />

          {/* Role reference table — content that left ExchangeModeToggle (hideTable) */}
          <details className="tctr-acc">
            <summary><span className="tctr-chev">▶</span> Exchange Mode Details</summary>
            <div className="tctr-acc-body">
              <div className="tctr-kv" style={{ gridTemplateColumns: "70px 1fr" }}>
                <span className="tctr-kv-k" style={{ color: "#be185d" }}>User</span>
                <span className="tctr-kv-v">PingOne OIDC login → subject_token (RFC 8693 §1.1)</span>
                <span className="tctr-kv-k" style={{ color: "#7e22ce" }}>Agent</span>
                <span className="tctr-kv-v">client credentials → actor_token (RFC 8693 §1.1)</span>
                <span className="tctr-kv-k" style={{ color: "#047857" }}>MCP</span>
                <span className="tctr-kv-v">RFC 8693 exchange → delegated token with nested act claim</span>
              </div>
            </div>
          </details>
        </>
      ) : tab === "tokens" ? (
        <TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} standalone />
      ) : tab === "trust" ? (
        <TraceTrustPanel events={trace.tokenEvents} />
      ) : tab === "simple" ? (
        <SimpleStepper events={tokenChain?.events ?? []} />
      ) : tab === "detailed" ? (
        <DetailedStepper events={tokenChain?.events ?? []} />
      ) : tab === "demo-track" ? (
        <TokenChainDemoTrackTab />
      ) : (
        <TraceMcpPanel steps={steps} trace={trace} onInspect={onInspect} useCase={proofUseCase} />
      )}

      <ClaimDetailsModal isOpen={!!inspectType} tokenType={inspectType || "user"}
        liveClaims={inspectClaims} onClose={() => setInspectType(null)} />
      <TokenLegendModal isOpen={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}
