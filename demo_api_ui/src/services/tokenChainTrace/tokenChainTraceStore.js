// Singleton trace store for the TokenChainTraceRail. Mirrors the subscribe/
// getState pattern of agentFlowDiagramService. Ingest methods are called from
// the existing event funnels (TokenChainContext, useAgentState, AIAgent) and
// from two passive listeners wired below.
import { buildTraceSteps } from "./buildTraceSteps";
import { agentFlowDiagram } from "../agentFlowDiagramService";

const EMPTY_TRACE = () => ({
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
});

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
    const SESSION_EVENT_IDS = ["user-token", "session-token-introspection", "user-token-introspection"];
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
    trace.tokenEvents = events.slice();
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
    trace.authorize = evaluation;
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
    trace.mcpResult = payload;
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
    if (e && e.detail) tokenChainTraceStore.ingestMcpResult(e.detail);
  });
}
