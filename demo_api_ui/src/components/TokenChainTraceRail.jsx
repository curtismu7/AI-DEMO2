// Compact full-pipeline trace rail for the portal token rails and the agent
// TokenChainModal. Single-column by construction (no viewport media queries).
// Spec: docs/superpowers/specs/2026-07-02-token-chain-trace-rail-design.md
import React, { useEffect, useState, useCallback } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { MCP_STEP_IDS } from "../services/tokenChainTrace/buildTraceSteps";
import TraceStepCard from "./TraceStepCard";
import TraceTokenSummary from "./TraceTokenSummary";
import TraceMcpPanel from "./TraceMcpPanel";
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

export default function TokenChainTraceRail({ mcpRouteOnly = false }) {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  const [legendOpen, setLegendOpen] = useState(false);
  const [inspectType, setInspectType] = useState(null);
  const [tab, setTab] = useState(mcpRouteOnly ? "mcp" : "chain");

  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);
  const onInspect = useCallback((tokenType) => setInspectType(tokenType), []);

  const { trace } = snap;
  const steps = mcpRouteOnly
    ? snap.steps.filter((s) => MCP_STEP_IDS.includes(s.id))
    : snap.steps;
  const dots = mcpRouteOnly ? MCP_ROUTE_DOTS : CHAIN_DOTS;
  const mcpDone = steps.filter((s) => MCP_STEP_IDS.includes(s.id) && s.status === "done").length;

  return (
    <div className="tctr">
      <div className="tctr-head">
        <span className="tctr-title">🔗 Token Chain</span>
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
      ) : (
        <TraceMcpPanel steps={steps} trace={trace} onInspect={onInspect} />
      )}

      <ClaimDetailsModal isOpen={!!inspectType} tokenType={inspectType || "user"}
        onClose={() => setInspectType(null)} />
      <TokenLegendModal isOpen={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}
