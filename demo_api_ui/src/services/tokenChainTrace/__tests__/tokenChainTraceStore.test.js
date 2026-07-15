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

test("beginTrace clears per-run evidence but keeps sign-in token", () => {
  tokenChainTraceStore.ingestLlmReply("old reply");
  tokenChainTraceStore.ingestRoutingMode("heuristic", { action: "view_coverage" });
  tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", status: "active", claims: { sub: "u1", scope: "read" } },
    { id: "two-ex-final-token", status: "exchanged", claims: { scope: "read" } },
  ]);
  tokenChainTraceStore.beginTrace({ prompt: "get_my_accounts" });
  const { trace, steps } = tokenChainTraceStore.getState();
  expect(trace.llmReply).toBeNull();
  expect(trace.routingMode).toBeNull();
  expect(trace.tokenEvents.map((e) => e.id)).toEqual(["user-token"]);
  expect(steps.find((s) => s.id === "signin").status).toBe("done");
  expect(steps.find((s) => s.id === "exchange").status).toBe("pending");
});

test("ingestAuthorize + ingestMcpResult reach the step model", () => {
  tokenChainTraceStore.ingestAuthorize({ engine: "pingone", decision: "PERMIT", decisionId: "d1" });
  tokenChainTraceStore.ingestMcpResult({ tool: "t", result: { ok: 1 }, durationMs: 5 });
  const byId = Object.fromEntries(
    tokenChainTraceStore.getState().steps.map((s) => [s.id, s]));
  expect(byId.authorize.detail.decision.outcome).toBe("PERMIT");
  expect(byId.api.status).toBe("done");
});

test("ingestRoutingMode after beginTrace marks llm/reply heuristic-ready", () => {
  tokenChainTraceStore.beginTrace({ prompt: "my accounts" });
  tokenChainTraceStore.ingestRoutingMode("heuristic", { action: "get_my_accounts" });
  const { trace, steps } = tokenChainTraceStore.getState();
  expect(trace.routingMode).toBe("heuristic");
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  expect(byId.llm.status).toBe("done");
  expect(byId.llm.lane).toBe("HEURISTICS");
  expect(byId.reply.title).toBe("Heuristics composes reply → chat");
});

test("reset clears everything including sign-in token (full demo wipe)", () => {
  tokenChainTraceStore.beginTrace({ prompt: "my accounts" });
  tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", status: "active", claims: { sub: "u1" } },
    { id: "exchanged-token", status: "exchanged", claims: { sub: "u1" } },
  ]);
  tokenChainTraceStore.completeTrace(true);
  tokenChainTraceStore.reset();
  const { trace } = tokenChainTraceStore.getState();
  expect(trace.startedAt).toBeNull();
  expect(trace.prompt).toBeNull();
  expect(trace.tokenEvents).toEqual([]);
  expect(trace.outcome).toBeNull();
});
