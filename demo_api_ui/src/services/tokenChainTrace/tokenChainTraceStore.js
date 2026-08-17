// Singleton trace store for the TokenChainTraceRail. Mirrors the subscribe/
// getState pattern of agentFlowDiagramService. Ingest methods are called from
// the existing event funnels (TokenChainContext, useAgentState, AIAgent) and
// from two passive listeners wired below.
import { buildTraceSteps } from "./buildTraceSteps";
import { agentFlowDiagram } from "../agentFlowDiagramService";

const EMPTY_TRACE = () => ({
  // Identifies THIS run. Consumers that render per-run evidence (ProofStrip via
  // ProofOfEnforcementContext) key on it so a later run cannot repaint an older
  // one's result. A counter, not startedAt — two runs can share a millisecond.
  runId: null,
  // The BFF flowTraceId this run's pipeline events are keyed to. Producers tag
  // every SSE-delivered mcpResult / token event with it; ingest drops payloads
  // whose flowTraceId belongs to a DIFFERENT run (a prior run's late, out-of-
  // order SSE result landing on this run's fresh trace).
  flowTraceId: null,
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, authorizeEvaluations: null, outcome: null,
  // 'declined' once the human refuses a step-up / HITL approval gate. Without
  // it the trace ends at authorize.outcome === 'STEP_UP' and the Proof verdict
  // cannot tell "gate fired, human approved" from "gate fired, human refused".
  approvalOutcome: null,
});

// Session-scoped evidence (the sign-in token) outlives any single tool call —
// beginTrace carries it forward and ingestTokenEvents must not wipe it when a
// per-call event array (e.g. an attack sim's) arrives without it.
const SESSION_EVENT_IDS = ["user-token", "session-token-introspection", "user-token-introspection"];

let trace = EMPTY_TRACE();
let runSeq = 0;
// The flowTraceId of the run currently owning the trace. Set when a run binds
// its id (beginTrace / bindFlowTrace). Used to reject late evidence from a run
// that is no longer current.
let activeFlowTraceId = null;
// A full presenter reset is an explicit boundary, not another run. Tagged
// evidence from the cleared run must stay rejected until beginTrace starts the
// next run, even though there is temporarily no activeFlowTraceId to compare.
let explicitlyReset = false;
const listeners = new Set();

// True when `flowTraceId` identifies a DIFFERENT run than the one that owns the
// trace right now. Untagged evidence (no flowTraceId) and the brief window
// before a run binds its id are accepted — this only drops evidence that a
// prior run positively stamped with its own id, which is the cross-run leak.
function isForeignRun(flowTraceId) {
  if (flowTraceId == null) return false;
  if (explicitlyReset) return true;
  return (
    activeFlowTraceId != null &&
    flowTraceId !== activeFlowTraceId
  );
}

// Synthesize a standard authorize shape from a gw-authorize token event so
// consumers that read trace.authorize don't need per-site fallback logic.
function _gwAuthorizeToAuthorize(ev) {
  return {
    engine: ev.authorizeEngine || ev.backend || 'pingone',
    decision: ev.decision || ev.authorizeDecision || null,
    decisionId: ev.decisionId || null,
    decisionContext: ev.tool ? `tool:${ev.tool}` : null,
    path: ev.url || null,
    request: ev.authorizeRequest
      || (ev.parameters ? { method: 'POST', url: ev.url || '', parameters: ev.parameters } : null),
    response: ev.authorizeResponse || ev.rawResponse || null,
    source: 'gw-authorize',
  };
}

// If a gw-authorize event exists in trace.tokenEvents and trace.authorize has
// not been set by ingestAuthorize (which owns the non-gateway path), synthesize
// trace.authorize from the event. Called after every tokenEvents mutation so
// downstream consumers only need to read trace.authorize, never scan tokenEvents.
function _syncGwAuthorize() {
  const gwEv = trace.tokenEvents.find((e) => e && e.id === 'gw-authorize');
  if (!gwEv) return;
  if (!trace.authorize) {
    trace.authorize = _gwAuthorizeToAuthorize(gwEv);
    return;
  }
  // A carried gate (beginTrace's { outcome, priorGate }) occupies the slot with
  // no decision. The gateway's real verdict must still land — otherwise the run
  // story fabricates "INDETERMINATE" for a run whose only decision was PERMIT.
  // Keep the gate fields (outcome/priorGate) so ProofStrip still scores UC7/UC8.
  if (trace.authorize.decision == null) {
    const fromEv = _gwAuthorizeToAuthorize(gwEv);
    trace.authorize = { ...fromEv, ...trace.authorize, decision: fromEv.decision };
  }
}

const GATE_OUTCOMES = new Set(["STEP_UP", "HITL_REQUIRED"]);

/**
 * The gate this run is about to hand to its resume, or null.
 *
 * A step-up resume re-enters sendAgentMessage, whose beginTrace() would drop
 * the STEP_UP outcome — leaving the retry with a bare PERMIT that ProofStrip
 * scores as "Mismatch" (UC7). HITL never hit this because its retry stays
 * inside one trace.
 *
 * Two guards keep the carry-over from becoming sticky:
 *  - `priorGate` absent — a gate already carried once has it set, so a gate is
 *    handed on exactly once and the third run is scored on its own decision.
 *  - the resume replays the identical prompt, which is what separates it from
 *    the user simply asking something else next.
 */
function gateToCarry(from, nextPrompt) {
  if (!from || !from.authorize || nextPrompt == null) return null;
  const { outcome, priorGate } = from.authorize;
  if (!GATE_OUTCOMES.has(outcome) || priorGate) return null;
  // Declined: the human refused, so nothing was permitted and there is no gate
  // to discharge.
  if (from.approvalOutcome === "declined") return null;
  return from.prompt?.message === String(nextPrompt) ? outcome : null;
}

function emit() {
  const snap = getState();
  listeners.forEach((fn) => { try { fn(snap); } catch { /* listener errors are theirs */ } });
}

function getState() {
  return { trace: { ...trace }, steps: buildTraceSteps(trace) };
}

function ensureTrace() {
  if (trace.startedAt == null) trace.startedAt = Date.now();
  // Evidence can arrive without a beginTrace (passive listeners); that is still
  // a run and still needs an id, or its verdict has nowhere to be filed.
  if (trace.runId == null) trace.runId = ++runSeq;
}

export const tokenChainTraceStore = {
  subscribe(fn) { listeners.add(fn); fn(getState()); return () => listeners.delete(fn); },
  getState,
  beginTrace({ prompt, flowTraceId } = {}) {
    // Session-scoped evidence (the sign-in token) outlives any single tool
    // call — carry it into the new trace so the sign-in step doesn't regress
    // to "pending" on every chip click. Per-call events are dropped.
    // Strip useCaseId from the carry-over: stampUseCaseId tags user-token on the
    // first demo run, and firstUseCaseId would otherwise keep scoring every later
    // run against that sticky slug (e.g. always "A2A delegation — Incomplete").
    const sessionEvents = trace.tokenEvents
      .filter((e) => e && SESSION_EVENT_IDS.includes(e.id))
      .map((e) => {
        const { useCaseId: _uc, ...rest } = e;
        return rest;
      });
    const carried = gateToCarry(trace, prompt);

    trace = EMPTY_TRACE();
    explicitlyReset = false;
    trace.startedAt = Date.now();
    trace.runId = ++runSeq;
    trace.prompt = prompt ? { message: String(prompt) } : null;
    trace.tokenEvents = sessionEvents;
    if (carried) trace.authorize = { outcome: carried, priorGate: carried };
    // Bind this run's flowTraceId (may be null here on paths that mint the id
    // after beginTrace — those call bindFlowTrace once it exists).
    activeFlowTraceId = flowTraceId ?? null;
    trace.flowTraceId = activeFlowTraceId;
    try {
      agentFlowDiagram.clearServerEvents();
      // Wipe compliance-step "done" bits from the prior run so the flow
      // diagram doesn't render an old run's lit nodes until the new run's
      // first STATE_SNAPSHOT lands.
      agentFlowDiagram.resetComplianceSteps(null, null);
    } catch { /* display-only */ }
    emit();
  },
  /**
   * Bind (or re-bind) the flowTraceId of the current run when it is minted
   * after beginTrace — the AG-UI path calls beginTrace in sendAsNlInner but
   * generates the flowTraceId inside useAgentRun a moment later. Once bound,
   * any late evidence from a prior run is dropped by isForeignRun.
   */
  bindFlowTrace(flowTraceId) {
    if (!flowTraceId || explicitlyReset) return;
    activeFlowTraceId = flowTraceId;
    trace.flowTraceId = flowTraceId;
  },
  ingestPhases(serverEvents) {
    if (!Array.isArray(serverEvents) || !serverEvents.length) return;
    ensureTrace();
    trace.phases = serverEvents.slice();
    emit();
  },
  ingestRoutingMode(mode, detail = null) {
    if (!mode) return;
    ensureTrace();
    trace.routingMode = mode;
    trace.routingDetail = detail && typeof detail === "object" ? { ...detail } : null;
    emit();
  },
  ingestTokenEvents(events) {
    if (!Array.isArray(events) || !events.length) return;
    const acceptedEvents = events.filter((event) => !isForeignRun(event?.flowTraceId));
    if (!acceptedEvents.length) return;
    ensureTrace();
    const incoming = new Set(acceptedEvents.map((e) => e && e.id));
    const carried = trace.tokenEvents.filter(
      (e) => e && SESSION_EVENT_IDS.includes(e.id) && !incoming.has(e.id),
    );
    trace.tokenEvents = [...carried, ...acceptedEvents];
    _syncGwAuthorize();
    emit();
  },
  ingestTokenEvent(event) {
    if (!event || !event.id) return;
    // Same run-identity guard as ingestMcpResult: a late gw-authorize / gateway
    // token event from a prior run must not land on this run's trace.
    if (isForeignRun(event.flowTraceId)) return;
    ensureTrace();
    const idx = trace.tokenEvents.findIndex((e) => e.id === event.id);
    if (idx >= 0) {
      trace.tokenEvents = [
        ...trace.tokenEvents.slice(0, idx),
        event,
        ...trace.tokenEvents.slice(idx + 1),
      ];
    } else {
      trace.tokenEvents = [...trace.tokenEvents, event];
    }
    _syncGwAuthorize();
    emit();
  },
  ingestAuthorize(evaluation) {
    if (!evaluation) return;
    ensureTrace();
    const prev = trace.authorize;
    // HITL/step-up challenge then approve→retry PERMITs. Keep the block-kind
    // outcome so ProofStrip still scores the gate that fired (UC7/UC8), instead
    // of overwriting with a bare PERMIT and rendering "Mismatch".
    const priorGate =
      prev &&
      (prev.outcome === "HITL_REQUIRED" || prev.outcome === "STEP_UP")
        ? prev.outcome
        : null;
    if (
      priorGate &&
      evaluation.decision === "PERMIT" &&
      !evaluation.outcome
    ) {
      trace.authorize = { ...evaluation, outcome: priorGate, priorGate };
    } else {
      trace.authorize = evaluation;
    }
    emit();
  },
  ingestAuthorizeEvaluations(list) {
    if (!Array.isArray(list) || !list.length) return;
    ensureTrace();
    trace.authorizeEvaluations = list;
    emit();
  },
  ingestLlmDetail(value) {
    if (!value) return;
    ensureTrace();
    trace.llmDetail = value;
    emit();
  },
  ingestLlmReply(text) {
    if (!text) return;
    ensureTrace();
    trace.llmReply = String(text);
    emit();
  },
  ingestMcpResult(payload) {
    if (!payload) return;
    // Drop a result a PRIOR run produced that arrived after this run began —
    // otherwise a public/local-tool run (no MCP evidence of its own) repaints
    // the rail with the previous run's create_transfer error.
    if (isForeignRun(payload.flowTraceId)) return;
    ensureTrace();
    // Normalize SSE shape (toolName/resultJson) to the rail's mcpResult model.
    const next = {
      ...payload,
      tool: payload.tool || payload.toolName || null,
      requestJson: payload.requestJson ?? null,
      result: payload.result ?? payload.resultJson ?? null,
      denied: Boolean(payload.denied),
    };
    trace.mcpResult = next;
    emit();
  },
  /** The human refused a step-up / HITL approval gate — nothing was executed. */
  ingestApprovalDeclined() {
    ensureTrace();
    trace.approvalOutcome = "declined";
    emit();
  },
  completeTrace(ok) { trace.outcome = ok ? "ok" : "error"; emit(); },
  /** Full demo reset — empty pipeline (nothing done) ready for the next run. */
  reset() {
    trace = EMPTY_TRACE();
    activeFlowTraceId = null;
    explicitlyReset = true;
    try {
      agentFlowDiagram.clearServerEvents();
      agentFlowDiagram.resetComplianceSteps(null, null);
    } catch { /* display-only */ }
    emit();
  },
};

// Passive wiring — phases stream through agentFlowDiagram already; MCP results
// arrive on a window event fired by TokenChainContext's SSE handler.
agentFlowDiagram.subscribe((snap) => {
  if (snap && Array.isArray(snap.serverEvents) && snap.serverEvents.length) {
    tokenChainTraceStore.ingestPhases(snap.serverEvents);
  }
});
if (typeof window !== "undefined") {
  window.addEventListener("mcp-tool-result-sse", (e) => {
    if (!e || !e.detail) return;
    // A late result from a prior run carries that run's flowTraceId — drop the
    // whole event (mcpResult AND its authorize evaluations) so it cannot repaint
    // the run that is current now.
    if (isForeignRun(e.detail.flowTraceId)) return;
    tokenChainTraceStore.ingestMcpResult(e.detail);
    if (e.detail.mcpAuthorizeEvaluation) {
      tokenChainTraceStore.ingestAuthorize(e.detail.mcpAuthorizeEvaluation);
    }
    if (e.detail.mcpAuthorizeEvaluations) {
      tokenChainTraceStore.ingestAuthorizeEvaluations(e.detail.mcpAuthorizeEvaluations);
    }
  });
}
