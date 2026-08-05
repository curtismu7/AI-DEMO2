import { buildRunStory } from "../buildTraceSteps";
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

test("ingestAuthorize keeps HITL_REQUIRED outcome across approve→retry PERMIT", () => {
  tokenChainTraceStore.ingestAuthorize({
    decision: "INDETERMINATE",
    outcome: "HITL_REQUIRED",
    engine: "pingone",
  });
  tokenChainTraceStore.ingestAuthorize({ decision: "PERMIT", engine: "pingone" });
  const { authorize } = tokenChainTraceStore.getState().trace;
  expect(authorize.decision).toBe("PERMIT");
  expect(authorize.outcome).toBe("HITL_REQUIRED");
  expect(authorize.priorGate).toBe("HITL_REQUIRED");
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

test("beginTrace strips sticky useCaseId from carried session token", () => {
  tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", status: "active", useCaseId: "a2a-delegation", claims: { sub: "u1" } },
    { id: "a2a-exchange1", status: "exchanged", useCaseId: "a2a-delegation" },
  ]);
  tokenChainTraceStore.beginTrace({ prompt: "show my accounts" });
  const { tokenEvents } = tokenChainTraceStore.getState().trace;
  expect(tokenEvents.map((e) => e.id)).toEqual(["user-token"]);
  expect(tokenEvents[0].useCaseId).toBeUndefined();
  expect(tokenEvents[0].claims).toEqual({ sub: "u1" });
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

test("reset rejects late tagged evidence from the cleared run", () => {
  tokenChainTraceStore.beginTrace({ prompt: "my accounts", flowTraceId: "flow-cleared" });
  tokenChainTraceStore.reset();

  tokenChainTraceStore.ingestTokenEvent({
    id: "gw-authorize",
    flowTraceId: "flow-cleared",
    decision: "PERMIT",
  });
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: {
      flowTraceId: "flow-cleared",
      type: "mcp-result",
      tool: "get_my_accounts",
      result: { ok: 1 },
      mcpAuthorizeEvaluation: { decision: "PERMIT" },
    },
  }));

  const { trace } = tokenChainTraceStore.getState();
  expect(trace.runId).toBeNull();
  expect(trace.tokenEvents).toEqual([]);
  expect(trace.mcpResult).toBeNull();
  expect(trace.authorize).toBeNull();
});

test("ingestAuthorizeEvaluations stores the ordered decision list", () => {
  const list = [
    { decision: "PERMIT", decisionId: "gate-1", decisionContext: "McpFirstTool" },
    { decision: "DENY", decisionId: "limit-1", decisionContext: "TransactionAmount" },
  ];
  tokenChainTraceStore.ingestAuthorizeEvaluations(list);
  expect(tokenChainTraceStore.getState().trace.authorizeEvaluations).toEqual(list);
});

test("ingestAuthorizeEvaluations ignores empty/non-array input", () => {
  tokenChainTraceStore.ingestAuthorizeEvaluations([]);
  expect(tokenChainTraceStore.getState().trace.authorizeEvaluations).toBeNull();
  tokenChainTraceStore.ingestAuthorizeEvaluations(undefined);
  expect(tokenChainTraceStore.getState().trace.authorizeEvaluations).toBeNull();
});

test("mcp-tool-result-sse window event ingests a singular authorize evaluation", () => {
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: {
      type: "mcp-result", tool: "get_my_accounts",
      mcpAuthorizeEvaluation: { decision: "PERMIT", decisionId: "gate-1" },
    },
  }));
  expect(tokenChainTraceStore.getState().trace.authorize).toEqual({ decision: "PERMIT", decisionId: "gate-1" });
});

test("mcp-tool-result-sse window event ingests a plural authorize evaluations array", () => {
  const evaluations = [
    { decision: "PERMIT", decisionId: "gate-1", decisionContext: "McpFirstTool" },
    { decision: "DENY", decisionId: "limit-1", decisionContext: "TransactionAmount" },
  ];
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: { type: "mcp-result", tool: "create_transfer", mcpAuthorizeEvaluations: evaluations },
  }));
  expect(tokenChainTraceStore.getState().trace.authorizeEvaluations).toEqual(evaluations);
});

test("mcp-tool-result-sse window event without authorize fields does not touch trace.authorize", () => {
  tokenChainTraceStore.ingestAuthorize({ decision: "DENY", decisionId: "prior" });
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: { type: "mcp-result", tool: "get_my_accounts" },
  }));
  expect(tokenChainTraceStore.getState().trace.authorize).toEqual({ decision: "DENY", decisionId: "prior" });
});

// ── Approval-gate carry-over across a resume ────────────────────────────────
// A step-up resume re-enters sendAgentMessage, whose beginTrace() wipes
// trace.authorize — taking the STEP_UP outcome with it. The retry then records
// a bare PERMIT and ProofStrip scores UC7 as "Mismatch". HITL never hit this
// because its retry does not cross a beginTrace.

test("beginTrace carries an unfulfilled STEP_UP gate into the resume of the same prompt", () => {
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $600" });
  tokenChainTraceStore.ingestAuthorize({ decision: "INDETERMINATE", outcome: "STEP_UP" });
  // MFA satisfied → the resume replays the identical prompt.
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $600" });
  tokenChainTraceStore.ingestAuthorize({ decision: "PERMIT" });
  const { authorize } = tokenChainTraceStore.getState().trace;
  expect(authorize.decision).toBe("PERMIT");
  expect(authorize.outcome).toBe("STEP_UP");
  expect(authorize.priorGate).toBe("STEP_UP");
});

test("carries an unfulfilled HITL_REQUIRED gate the same way", () => {
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $300" });
  tokenChainTraceStore.ingestAuthorize({ decision: "INDETERMINATE", outcome: "HITL_REQUIRED" });
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $300" });
  tokenChainTraceStore.ingestAuthorize({ decision: "PERMIT" });
  expect(tokenChainTraceStore.getState().trace.authorize.outcome).toBe("HITL_REQUIRED");
});

test("a DIFFERENT prompt does not inherit the previous run's gate", () => {
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $600" });
  tokenChainTraceStore.ingestAuthorize({ decision: "INDETERMINATE", outcome: "STEP_UP" });
  tokenChainTraceStore.beginTrace({ prompt: "show my accounts" });
  tokenChainTraceStore.ingestAuthorize({ decision: "PERMIT" });
  const { authorize } = tokenChainTraceStore.getState().trace;
  expect(authorize.outcome).toBeUndefined();
  expect(authorize.priorGate).toBeUndefined();
});

test("a declined gate is NOT carried — the human refused, nothing was permitted", () => {
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $600" });
  tokenChainTraceStore.ingestAuthorize({ decision: "INDETERMINATE", outcome: "STEP_UP" });
  tokenChainTraceStore.ingestApprovalDeclined();
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $600" });
  tokenChainTraceStore.ingestAuthorize({ decision: "PERMIT" });
  expect(tokenChainTraceStore.getState().trace.authorize.outcome).toBeUndefined();
});

test("the gate is carried once, not forever", () => {
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $600" });
  tokenChainTraceStore.ingestAuthorize({ decision: "INDETERMINATE", outcome: "STEP_UP" });
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $600" });
  tokenChainTraceStore.ingestAuthorize({ decision: "PERMIT" });
  // Third run of the same prompt: the gate was already discharged, so this run
  // must be scored on its own PERMIT.
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $600" });
  tokenChainTraceStore.ingestAuthorize({ decision: "PERMIT" });
  expect(tokenChainTraceStore.getState().trace.authorize.outcome).toBeUndefined();
});

test("a DENY is never carried forward as a gate", () => {
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $2500" });
  tokenChainTraceStore.ingestAuthorize({ decision: "DENY", outcome: "DENY" });
  tokenChainTraceStore.beginTrace({ prompt: "checkout headphones for $2500" });
  tokenChainTraceStore.ingestAuthorize({ decision: "PERMIT" });
  expect(tokenChainTraceStore.getState().trace.authorize.outcome).toBeUndefined();
});

// ── Cross-run evidence leak (flowTraceId run-identity guard) ─────────────────
// UC24 "What branches are near me?" runs a LOCAL/public tool (get_branch_hours)
// that emits no gateway/MCP evidence of its own. A prior step-up transfer run
// (create_transfer → step_up_required) publishes its mcp-result and gw-authorize
// asynchronously; when that late evidence lands on the singleton store AFTER the
// public run's beginTrace, the rail narrates a false "MCP call failed for
// create_transfer (step_up_required)" on a run that actually succeeded. Each run
// now binds a flowTraceId; ingest drops any payload tagged for a different run.

test("a late mcp-result from a prior run does not poison a public/local run", () => {
  // Run A — a step-up transfer that ends in a create_transfer step-up.
  tokenChainTraceStore.beginTrace({ prompt: "transfer $6,000", flowTraceId: "flow-A" });
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: {
      flowTraceId: "flow-A", type: "mcp-result", tool: "create_transfer",
      status: "error", error: "step_up_required",
    },
  }));
  tokenChainTraceStore.completeTrace(false);

  // Run B — UC24 public catalog read; a local tool, so no MCP evidence of its own.
  tokenChainTraceStore.beginTrace({ prompt: "What branches are near me?", flowTraceId: "flow-B" });
  tokenChainTraceStore.ingestRoutingMode("heuristic", { action: "get_branch_hours" });
  tokenChainTraceStore.completeTrace(true);

  // Late, out-of-order arrival of Run A's create_transfer result.
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: {
      flowTraceId: "flow-A", type: "mcp-result", tool: "create_transfer",
      status: "error", error: "step_up_required",
    },
  }));

  const { trace, steps } = tokenChainTraceStore.getState();
  expect(trace.mcpResult).toBeNull();
  expect(steps.find((s) => s.id === "mcp").status).not.toBe("error");
  expect(buildRunStory(trace, steps).outcome).not.toBe("error");
});

test("a late gw-authorize token event from a prior run does not reach the gateway step", () => {
  tokenChainTraceStore.beginTrace({ prompt: "transfer $6,000", flowTraceId: "flow-A" });
  tokenChainTraceStore.beginTrace({ prompt: "What branches are near me?", flowTraceId: "flow-B" });
  // Prior run's gateway authorize, delivered late onto the public run's trace.
  tokenChainTraceStore.ingestTokenEvent({
    id: "gw-authorize", flowTraceId: "flow-A", tool: "create_transfer", decision: "INDETERMINATE",
  });
  tokenChainTraceStore.completeTrace(true);
  const gateway = tokenChainTraceStore.getState().steps.find((s) => s.id === "gateway");
  expect(gateway.detail.why || "").not.toContain("create_transfer");
});

test("evidence tagged for the CURRENT run is still ingested (guard is not over-broad)", () => {
  tokenChainTraceStore.beginTrace({ prompt: "transfer $250", flowTraceId: "flow-B" });
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: { flowTraceId: "flow-B", type: "mcp-result", tool: "create_transfer", result: { ok: 1 } },
  }));
  expect(tokenChainTraceStore.getState().trace.mcpResult.tool).toBe("create_transfer");
});

test("untagged mcp-result payloads stay accepted (backward compatible)", () => {
  tokenChainTraceStore.beginTrace({ prompt: "my accounts", flowTraceId: "flow-B" });
  tokenChainTraceStore.ingestMcpResult({ tool: "get_my_accounts", result: { ok: 1 } });
  expect(tokenChainTraceStore.getState().trace.mcpResult.tool).toBe("get_my_accounts");
});

test("bindFlowTrace binds a run whose id is generated after beginTrace (AG-UI path)", () => {
  // sendAsNlInner calls beginTrace with no id; useAgentRun binds it moments later.
  tokenChainTraceStore.beginTrace({ prompt: "What branches are near me?" });
  tokenChainTraceStore.bindFlowTrace("flow-B");
  // Prior run's late result must be dropped once this run has bound its id.
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: { flowTraceId: "flow-A", type: "mcp-result", tool: "create_transfer", status: "error" },
  }));
  expect(tokenChainTraceStore.getState().trace.mcpResult).toBeNull();
  // This run's own result is still accepted.
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: { flowTraceId: "flow-B", type: "mcp-result", tool: "get_branch_hours", result: { ok: 1 } },
  }));
  expect(tokenChainTraceStore.getState().trace.mcpResult.tool).toBe("get_branch_hours");
});
