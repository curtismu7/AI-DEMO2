// Compact full-pipeline trace rail for the portal token rails and the agent
// TokenChainModal. Single-column by construction (no viewport media queries).
// Spec: docs/superpowers/specs/2026-07-02-token-chain-trace-rail-design.md
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import apiClient from "../services/apiClient";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { MCP_STEP_IDS, buildRunStory, chainBadge } from "../services/tokenChainTrace/buildTraceSteps";
import { resolveInspectClaims } from "../services/tokenChainTrace/resolveInspectClaims";
import { isFlagOn, shouldShowTrustTab } from "../utils/tokenChainTrust";
import { buildA2aChainDetail } from "../utils/a2aChainDetail";
import { useTokenChainOptional } from "../context/TokenChainContext";
import { useProofOfEnforcementOptional } from "../context/ProofOfEnforcementContext";
import TraceStepCard from "./TraceStepCard";
import TokenChainNodeRail from "./TokenChainNodeRail";
import StepDetailPanel from "./StepDetailPanel";
import ChainViewMenu from "./ChainViewMenu";
import DemoTrackBand from "./DemoTrackBand";
import TokenChainPresenter from "./TokenChainPresenter";
import TraceTokenSummary from "./TraceTokenSummary";
import { deriveAgentClass, AGENT_CLASS_LABEL, AGENT_CLASS_TITLE } from "../services/tokenChainTrace/deriveAgentClass";
import TraceMcpPanel from "./TraceMcpPanel";
import TraceTrustPanel from "./TraceTrustPanel";
import { SimpleStepper, DetailedStepper } from "./agent-clinical/TokensPane";
import ClaimDetailsModal from "./ClaimDetailsModal";
import TokenLegendModal from "./TokenLegendModal";
import TokenChainDemoTrackTab from "./TokenChainDemoTrackTab";
import "./TokenChainTraceRail.css";

const ZOOM_KEY = "tctr:zoom";
const VIEW_MODE_KEY = "tctr:view-mode";
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

function readStoredViewMode() {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === "classic" ? "classic" : "live";
  } catch {
    return "live";
  }
}

const SKIPPED_STEP_REASONS = {
  signin: "No sign-in token evidence was recorded for this run.",
  agent: "The agent service did not participate in this run.",
  llm: "No LLM reasoning was used on this run.",
  "agent-token": "No separate agent identity token was acquired.",
  exchange: "Token exchange was skipped; no delegated token was issued.",
  authorize: "PingOne Authorize was skipped; no policy decision was recorded.",
  stepup: "No step-up or human approval challenge was required.",
  "intent-binding": "No RAR intent-binding check was required.",
  gateway: "The Agent Gateway was not in this run's path.",
  "api-key-swap": "The run did not use the API-key credential-swap path.",
  mcp: "No MCP tool call occurred.",
  api: "No downstream resource-server call occurred.",
  database: "No SQL database access was observed for this run.",
  reply: "No final reply evidence was recorded.",
  "a2a-agent1-actor": "The main agent identity token was not observed.",
  "a2a-exchange1": "The user-to-main-agent exchange was not observed.",
  "a2a-agent2-actor": "The specialist agent identity token was not observed.",
  "a2a-exchange2": "The nested specialist delegation exchange was not observed.",
  "a2a-agent-card": "Specialist Agent Card discovery was not observed.",
  "a2a-protocol-message": "The A2A SendMessage handoff was not observed.",
};

function statusFromA2aEvent(event) {
  if (!event) return "pending";
  const status = String(event.status || "").toLowerCase();
  return ["error", "failed", "failure", "denied"].includes(status) ? "error" : "done";
}

export function buildA2aTokenChainSteps(tokenEvents) {
  const events = Array.isArray(tokenEvents) ? tokenEvents : [];
  const detail = buildA2aChainDetail(events);
  if (!detail.present) return [];
  const byId = (id) => events.find((event) => event?.id === id) || null;
  const mainAgent = detail.generalist || "Main agent";
  const specialist = detail.specialist || "Specialist agent";
  const definitions = [
    ["a2a-agent1-actor", `Main agent — ${mainAgent}`, "A2A"],
    ["a2a-exchange1", "A2A Exchange #1 — user + main agent", "A2A"],
    ["a2a-agent2-actor", `Specialist agent — ${specialist}`, "A2A"],
    ["a2a-exchange2", "A2A Exchange #2 — nested specialist delegation", "A2A"],
    ["a2a-agent-card", `Agent Card — ${specialist} discovery`, "A2A"],
    ["a2a-protocol-message", `A2A SendMessage — ${specialist} handoff`, "A2A"],
  ];

  return definitions.map(([id, title, lane]) => {
    const event = byId(id);
    return {
      id,
      title,
      lane,
      status: statusFromA2aEvent(event),
      detail: {
        narrative: event
          ? `${title} was observed in this run.`
          : SKIPPED_STEP_REASONS[id],
        claims: event?.claims,
        request: event?.exchangeRequest || event?.protocolRequest,
        response: event?.protocolResponse || event?.agentCard,
        tokenEvent: event || undefined,
      },
    };
  });
}

export function buildLiveTokenChainSteps(steps, trace) {
  const source = Array.isArray(steps) ? steps.slice() : [];
  const a2aSteps = buildA2aTokenChainSteps(trace?.tokenEvents);
  if (a2aSteps.length) {
    const insertAfter = source.findIndex((step) => step.id === "llm");
    source.splice(insertAfter + 1, 0, ...a2aSteps);
  }
  const hasActivity = Boolean(
    trace?.startedAt || trace?.prompt || trace?.tokenEvents?.length ||
    trace?.phases?.length || trace?.mcpResult || trace?.authorize ||
    trace?.llmDetail || trace?.llmReply || trace?.outcome || trace?.routingMode,
  );
  if (!hasActivity) return [];

  const complete = trace?.outcome === "ok" || trace?.outcome === "error";
  const projected = !complete
    // `|| detail.notRequired`: a hop marked "not required" is notinpath, and
    // this filter would drop it from an incomplete trace entirely — so the
    // Exchange hop would silently VANISH mid-run instead of explaining itself,
    // which is worse than the "in flight" it replaced. It has earned its place:
    // it carries the reason the step did not run.
    ? source.filter((step) => ["active", "done", "error"].includes(step.status)
      || step.detail?.notRequired)
    : source.map((step) => {
    const baseId = step.baseId || step.id;
    if (step.status === "notinpath" && SKIPPED_STEP_REASONS[baseId]) {
      return {
        ...step,
        detail: {
          ...step.detail,
          narrative: SKIPPED_STEP_REASONS[baseId],
        },
      };
    }
    if (step.status !== "pending") return step;
    return {
      ...step,
      status: "notinpath",
      detail: {
        ...step.detail,
        narrative: SKIPPED_STEP_REASONS[baseId] || "This possible step was not observed in the completed run.",
      },
    };
  });
  return projected.map((step, index) => ({ ...step, num: index + 1 }));
}

// ChainViewMenu names the views; the rail decides what one is. Its ids are
// camelCase, the tab state is the rail's existing kebab vocabulary — the only
// place the two differ is Demo Track.
const VIEW_ID_TO_TAB = {
  tokens: "tokens",
  mcp: "mcp",
  trust: "trust",
  simple: "simple",
  detailed: "detailed",
  demoTrack: "demo-track",
};

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
  const [viewMode, setViewMode] = useState(readStoredViewMode);
  // Chain-map selection. Purely a scroll/highlight aid over the cards below —
  // it never filters or reorders `steps`.
  const [activeStepId, setActiveStepId] = useState(null);
  // Presenter overlay — the same steps at projector size. Purely a second view.
  const [presenting, setPresenting] = useState(false);
  // Chain-view tab: the card stacked TWO renderings of the same chain (the
  // node map with Run/Present, then the step-detail list), which doubled the
  // column height and buried the page bottom. Tabs show one at a time;
  // 'detail' is the default ("If we pick one then I want the bottom one with
  // the detail", 2026-08-10). Persisted so a presenter's pick survives reloads.
  const [chainView, setChainView] = useState(() => {
    try {
      return localStorage.getItem("tctr_chain_view") === "map" ? "map" : "detail";
    } catch {
      return "detail";
    }
  });
  const pickChainView = (v) => {
    setChainView(v);
    try { localStorage.setItem("tctr_chain_view", v); } catch { /* private mode */ }
  };
  // The rail's settings tray: view mode, text size, Clear and Legend. They left
  // the header so the visible toolbar is Views and More, not twenty controls.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  // The presenter's script. The server owns it (demo_api_server/config/demoTrack.js)
  // and TokenChainDemoTrackTab reads the same endpoints — the band must not
  // become a second copy of a nine-step list that changes.
  const [track, setTrack] = useState([]);
  const [trackIndex, setTrackIndex] = useState(0);
  // Scope card lookups to THIS rail. The rail mounts on ~28 pages and
  // FloatingTokenChainPanel can put a second one over a dashboard that already
  // embeds one; a document-wide query would open the other rail's card and
  // leave this one's shut.
  const railRef = useRef(null);
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
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* private mode / storage disabled — mode is session-only */
    }
  }, [viewMode]);
  const stepZoom = useCallback((delta) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10)));
  }, []);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDocClick = (e) => {
      if (!moreRef.current?.contains(e.target)) setMoreOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // `n` is the step's position in the track, not a server field — deriving it
  // here is not a second source of truth; hardcoding the titles would be.
  // Promise.resolve() because apiClient is mocked to a bare vi.fn() in several
  // suites, where a raw .then() would throw inside the effect.
  useEffect(() => {
    if (mcpRouteOnly) return undefined;
    let alive = true;
    Promise.resolve(apiClient.get("/api/demo-track"))
      .then((res) => {
        const serverSteps = res?.data?.track?.steps;
        if (!alive || !Array.isArray(serverSteps)) return;
        setTrack(serverSteps.map((s, i) => ({
          n: i + 1,
          stepId: s.stepId,
          act: s.act,
          title: s.title,
          capability: s.capability,
          buyerStory: s.buyerStory,
        })));
        const at = serverSteps.findIndex((s) => s.stepId === res?.data?.run?.activeStepId);
        if (at >= 0) setTrackIndex(at);
      })
      .catch(() => { /* no track available — the band renders nothing */ });
    return () => { alive = false; };
  }, [mcpRouteOnly]);

  // Report the presenter's position, the same way TokenChainDemoTrackTab does.
  const onTrackSelect = useCallback((index) => {
    setTrackIndex(index);
    const stepId = track[index]?.stepId;
    if (!stepId) return;
    Promise.resolve(apiClient.post("/api/demo-track/active-step", { stepId }))
      .catch(() => { /* position is local either way */ });
  }, [track]);

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
  const classicSteps = useMemo(
    () => (mcpRouteOnly ? snap.steps.filter((s) => MCP_STEP_IDS.includes(s.id)) : snap.steps),
    [snap.steps, mcpRouteOnly],
  );
  const steps = useMemo(
    () => (viewMode === "classic" ? classicSteps : buildLiveTokenChainSteps(classicSteps, trace)),
    [viewMode, classicSteps, trace],
  );
  const dots = mcpRouteOnly ? MCP_ROUTE_DOTS : CHAIN_DOTS;
  // Clearing a run (or switching to a Live view that has not produced steps
  // yet) must drop both the selection and the presenter. Otherwise the flag
  // survives the empty state and the next run pops the full-screen projector
  // overlay open on its own.
  useEffect(() => {
    if (steps.length === 0) {
      setPresenting(false);
      setActiveStepId(null);
    }
  }, [steps.length]);

  const mcpDone = classicSteps.filter((s) => MCP_STEP_IDS.includes(s.id) && s.status === "done").length;
  const showTrust = shouldShowTrustTab({
    ffDpop: trustFlags.ffDpop,
    ffRar: trustFlags.ffRar,
    events: trace.tokenEvents,
  });
  const inspectClaims = inspectType ? resolveInspectClaims(trace.tokenEvents, inspectType) : null;
  const agentClass = deriveAgentClass(trace.tokenEvents);
  const hasTraceActivity = Boolean(
    trace.startedAt || trace.prompt || (trace.tokenEvents && trace.tokenEvents.length) ||
    (trace.phases && trace.phases.length) || trace.mcpResult || trace.authorize ||
    trace.llmDetail || trace.llmReply || trace.outcome || trace.routingMode,
  );
  const runStory = buildRunStory(trace, snap.steps);
  const badge = chainBadge(trace, snap.steps);

  // Drop Trust selection if the use case ends while that tab is open.
  useEffect(() => {
    if (!showTrust && tab === "trust") {
      setTab(mcpRouteOnly ? "mcp" : "chain");
    }
  }, [showTrust, tab, mcpRouteOnly]);

  return (
    <div className="tctr" style={{ zoom }} ref={railRef}>
      <div className="tctr-head">
        <div className="tctr-title-group">
          <span className="tctr-title">Token Chain</span>
          {agentClass ? (
            <span
              className={`tctr-agent-class tctr-agent-class--${agentClass}`}
              title={AGENT_CLASS_TITLE[agentClass]}
            >
              {AGENT_CLASS_LABEL[agentClass]}
            </span>
          ) : null}
        </div>
        <div className="tctr-toolbar">
          {tab !== "chain" ? (
            <button
              type="button"
              className="tctr-back-btn"
              onClick={() => setTab("chain")}
              title="Back to the inline token chain"
            >
              Token Chain
            </button>
          ) : null}
          <ChainViewMenu
            steps={steps}
            showTrust={showTrust}
            mcpCount={mcpDone}
            onOpenView={(viewId) => {
              // Topology opens the existing TokenTopologyPanel modal (App.js),
              // not an inline tab — same event the AIAgent header ⊞ uses.
              if (viewId === "topology") {
                window.dispatchEvent(new CustomEvent("token-topology-open"));
                return;
              }
              setTab(VIEW_ID_TO_TAB[viewId] || "chain");
            }}
          />
          <div className="tctr-more" ref={moreRef}>
            <button
              type="button"
              className="tctr-more-trigger"
              aria-haspopup="true"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              More
            </button>
            {/* Deliberately does NOT close on item click. Zoom is a repeat-press
                control and Live/Classic is a toggle; closing after each press
                would make the presenter reopen the tray three times to reach
                120%. Outside click and Escape close it. */}
            {moreOpen ? (
              <div className="tctr-more-pop">
                <div className="tctr-view-mode" role="group" aria-label="Token chain view mode">
                  <button
                    type="button"
                    className={viewMode === "live" ? "active" : ""}
                    aria-pressed={viewMode === "live"}
                    onClick={() => setViewMode("live")}
                  >
                    Live
                  </button>
                  <button
                    type="button"
                    className={viewMode === "classic" ? "active" : ""}
                    aria-pressed={viewMode === "classic"}
                    onClick={() => setViewMode("classic")}
                  >
                    Classic
                  </button>
                </div>
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
            ) : null}
          </div>
        </div>
      </div>

      <div className="tctr-chain-line">
        {dots.map((d, i) => (
          <React.Fragment key={d.cls}>
            {i > 0 && <span className="tctr-arrow">→</span>}
            <span className={`tctr-dot tctr-dot--${d.cls}`} /> {d.label}
          </React.Fragment>
        ))}
        <span className={`tctr-badge tctr-badge--${badge.tone}`}>{badge.label}</span>
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
                  {runStory.bits.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {/* Collapsed by default. This was the one `tctr-acc` carrying `open`;
              its sibling below already opens closed, so the rail now behaves
              consistently and the dashboard does not lead with a pipeline that
              is empty until an agent run happens. One click still expands it,
              and a run does not force it open — the user's choice sticks. */}
          <details className="tctr-acc">
            <summary>
              <span className="tctr-chev">▶</span>
              {trace.prompt
                ? `${viewMode === "live" ? "Live Pipeline" : "Pipeline"} — "${trace.prompt.message}"`
                : `${viewMode === "live" ? "Live Pipeline" : "Pipeline"} — awaiting agent action`}
            </summary>
            <div className="tctr-acc-body">
              {viewMode === "live" && steps.length === 0 && (
                <div className="tctr-live-empty">Run an agent flow to build the token chain.</div>
              )}
              <DemoTrackBand track={track} activeIndex={trackIndex} onSelect={onTrackSelect} />
            </div>
          </details>
          {/* One rendering at a time — Chain Map (presenter-facing nodes +
              Run/Present) or the Step Detail list. */}
          <div className="tctr-chain-tabs" role="tablist" aria-label="Token chain view">
            <button
              type="button"
              role="tab"
              aria-selected={chainView === "detail"}
              className={chainView === "detail" ? "active" : ""}
              onClick={() => pickChainView("detail")}
            >
              Step Detail
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chainView === "map"}
              className={chainView === "map" ? "active" : ""}
              onClick={() => pickChainView("map")}
            >
              Chain Map
            </button>
          </div>
          {chainView === "map" && (
          <TokenChainNodeRail
            steps={steps}
            activeId={activeStepId}
            onPresent={() => {
              if (!activeStepId && steps.length > 0) setActiveStepId(steps[0].id);
              setPresenting(true);
            }}
            onSelect={(id) => {
              setActiveStepId(id);
              // TraceStepCard already renders data-step-id on its <details>, so
              // the map can reveal a card without either component knowing about
              // the other's internals. On the map tab the cards are not mounted;
              // the querySelector simply finds nothing and the node stays the
              // selection indicator.
              const card = railRef.current?.querySelector(`.tctr-step[data-step-id="${id}"]`);
              if (card) {
                card.open = true;
                card.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }
            }}
          />
          )}
          {chainView === "map" && activeStepId ? (
            <StepDetailPanel
              step={steps.find((s) => s.id === activeStepId)}
              onInspect={onInspect}
            />
          ) : null}
          {presenting ? (
            <TokenChainPresenter
              steps={steps}
              activeId={activeStepId}
              onSelect={setActiveStepId}
              onClose={() => setPresenting(false)}
            />
          ) : null}

          {chainView === "detail" && steps.map((step) => (
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
        <TraceMcpPanel steps={classicSteps} trace={trace} onInspect={onInspect} useCase={proofUseCase} />
      )}

      <ClaimDetailsModal isOpen={!!inspectType} tokenType={inspectType || "user"}
        liveClaims={inspectClaims} onClose={() => setInspectType(null)} />
      <TokenLegendModal isOpen={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}
