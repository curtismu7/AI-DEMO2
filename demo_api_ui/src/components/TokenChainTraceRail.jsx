// Compact full-pipeline trace rail for the portal token rails and the agent
// TokenChainModal. Single-column by construction (no viewport media queries).
// Spec: docs/superpowers/specs/2026-07-02-token-chain-trace-rail-design.md
import React, { useEffect, useState, useCallback } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { MCP_STEP_IDS } from "../services/tokenChainTrace/buildTraceSteps";
import { resolveInspectClaims } from "../services/tokenChainTrace/resolveInspectClaims";
import { isFlagOn, shouldShowTrustTab } from "../utils/tokenChainTrust";
import TraceStepCard from "./TraceStepCard";
import TraceTokenSummary from "./TraceTokenSummary";
import TraceMcpPanel from "./TraceMcpPanel";
import TraceTrustPanel from "./TraceTrustPanel";
import ClaimDetailsModal from "./ClaimDetailsModal";
import TokenLegendModal from "./TokenLegendModal";
import "./TokenChainTraceRail.css";

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

  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);
  useEffect(() => subscribeTrustFlags(setTrustFlags), []);
  const onInspect = useCallback((tokenType) => setInspectType(tokenType), []);

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

  // Drop Trust selection if the use case ends while that tab is open.
  useEffect(() => {
    if (!showTrust && tab === "trust") {
      setTab(mcpRouteOnly ? "mcp" : "chain");
    }
  }, [showTrust, tab, mcpRouteOnly]);

  return (
    <div className="tctr">
      <div className="tctr-head">
        <span className="tctr-title">Token Chain</span>
        <button type="button" className="tctr-legend-btn" onClick={() => setLegendOpen(true)}>
          Legend
        </button>
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
      </div>

      {tab === "chain" ? (
        <>
          <div className="tctr-sec-label">
            {trace.prompt ? `Pipeline — "${trace.prompt.message}"` : "Pipeline — awaiting agent action"}
          </div>

          {steps.map((step) => (
            <TraceStepCard key={step.id} step={step} onInspect={onInspect} />
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
      ) : tab === "trust" ? (
        <TraceTrustPanel events={trace.tokenEvents} />
      ) : (
        <TraceMcpPanel steps={steps} trace={trace} onInspect={onInspect} />
      )}

      <ClaimDetailsModal isOpen={!!inspectType} tokenType={inspectType || "user"}
        liveClaims={inspectClaims} onClose={() => setInspectType(null)} />
      <TokenLegendModal isOpen={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}
