// Singleton trace store for the TokenChainTraceRail. Mirrors the subscribe/
// getState pattern of agentFlowDiagramService. Ingest methods are called from
// the existing event funnels (TokenChainContext, useAgentState, AIAgent) and
// from two passive listeners wired below.
import { buildTraceSteps } from "./buildTraceSteps";
import { agentFlowDiagram } from "../agentFlowDiagramService";

const EMPTY_TRACE = () => ({
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
const listeners = new Set();

function emit() {
  const snap = getState();
  listeners.forEach((fn) => { try { fn(snap); } catch { /* listener errors are theirs */ } });
}

function getState() {
  return { trace: { ...trace }, steps: buildTraceSteps(trace) };
}

function ensureTrace() {
  if (trace.startedAt == null) trace.startedAt = Date.now();
}

export const tokenChainTraceStore = {
  subscribe(fn) { listeners.add(fn); fn(getState()); return () => listeners.delete(fn); },
  getState,
  beginTrace({ prompt } = {}) {
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
    trace = EMPTY_TRACE();
    trace.startedAt = Date.now();
    trace.prompt = prompt ? { message: String(prompt) } : null;
    trace.tokenEvents = sessionEvents;
    try {
      agentFlowDiagram.clearServerEvents();
    } catch { /* display-only */ }
    emit();
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
    ensureTrace();
    const incoming = new Set(events.map((e) => e && e.id));
    const carried = trace.tokenEvents.filter(
      (e) => e && SESSION_EVENT_IDS.includes(e.id) && !incoming.has(e.id),
    );
    trace.tokenEvents = [...carried, ...events];
    emit();
  },
  ingestTokenEvent(event) {
    if (!event || !event.id) return;
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
    try {
      agentFlowDiagram.clearServerEvents();
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
    tokenChainTraceStore.ingestMcpResult(e.detail);
    if (e.detail.mcpAuthorizeEvaluation) {
      tokenChainTraceStore.ingestAuthorize(e.detail.mcpAuthorizeEvaluation);
    }
    if (e.detail.mcpAuthorizeEvaluations) {
      tokenChainTraceStore.ingestAuthorizeEvaluations(e.detail.mcpAuthorizeEvaluations);
    }
  });
}
