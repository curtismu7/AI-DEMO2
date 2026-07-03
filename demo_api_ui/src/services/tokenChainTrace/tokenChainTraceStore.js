// Singleton trace store for the TokenChainTraceRail. Mirrors the subscribe/
// getState pattern of agentFlowDiagramService. Ingest methods are called from
// the existing event funnels (TokenChainContext, useAgentState, AIAgent) and
// from two passive listeners wired below.
import { buildTraceSteps } from "./buildTraceSteps";
import { agentFlowDiagram } from "../agentFlowDiagramService";

const EMPTY_TRACE = () => ({
  startedAt: null, prompt: null, llmDetail: null, llmReply: null,
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
    trace = EMPTY_TRACE();
    trace.startedAt = Date.now();
    trace.prompt = prompt ? { message: String(prompt) } : null;
    emit();
  },
  ingestPhases(serverEvents) {
    if (!Array.isArray(serverEvents) || !serverEvents.length) return;
    ensureTrace();
    trace.phases = serverEvents.slice();
    emit();
  },
  ingestTokenEvents(events) {
    if (!Array.isArray(events) || !events.length) return;
    ensureTrace();
    trace.tokenEvents = events.slice();
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
  reset() { trace = EMPTY_TRACE(); emit(); },
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
