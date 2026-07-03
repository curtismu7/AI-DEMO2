import { tokenChainTraceStore } from "../tokenChainTraceStore";

beforeEach(() => tokenChainTraceStore.reset());

test("beginTrace resets state and stores prompt", () => {
  tokenChainTraceStore.ingestLlmReply("old");
  tokenChainTraceStore.beginTrace({ prompt: "transfer $250" });
  const { trace, steps } = tokenChainTraceStore.getState();
  expect(trace.prompt).toEqual({ message: "transfer $250" });
  expect(trace.llmReply).toBeNull();
  expect(steps.find((s) => s.id === "prompt").status).toBe("done");
});

test("subscribe fires immediately and on ingest", () => {
  const seen = [];
  const unsub = tokenChainTraceStore.subscribe((snap) => seen.push(snap.steps.length));
  expect(seen).toHaveLength(1);
  tokenChainTraceStore.ingestTokenEvents([{ id: "user-token", status: "active", claims: {} }]);
  expect(seen).toHaveLength(2);
  unsub();
  tokenChainTraceStore.ingestLlmReply("hi");
  expect(seen).toHaveLength(2);
});

test("ingestTokenEvents ignores empty arrays (keeps last good set)", () => {
  tokenChainTraceStore.ingestTokenEvents([{ id: "user-token", status: "active" }]);
  tokenChainTraceStore.ingestTokenEvents([]);
  expect(tokenChainTraceStore.getState().trace.tokenEvents).toHaveLength(1);
});

test("ingestAuthorize + ingestMcpResult reach the step model", () => {
  tokenChainTraceStore.ingestAuthorize({ engine: "pingone", decision: "PERMIT", decisionId: "d1" });
  tokenChainTraceStore.ingestMcpResult({ tool: "t", result: { ok: 1 }, durationMs: 5 });
  const byId = Object.fromEntries(
    tokenChainTraceStore.getState().steps.map((s) => [s.id, s]));
  expect(byId.authorize.detail.decision.outcome).toBe("PERMIT");
  expect(byId.api.status).toBe("done");
});
