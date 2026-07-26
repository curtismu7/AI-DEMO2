/**
 * Regression: on the legacy (non-AG-UI) /api/demo-agent/message path, an
 * LLM-routed run never filled Token Chain steps 3 (agent) and 4 (LLM) — only
 * the AG-UI streaming path ingested llm_detail. Chip runs and non-streaming
 * typed prompts showed the LLM step permanently pending.
 */
import { ingestLegacyRunTrace } from "../demoAgentService";
import { tokenChainTraceStore } from "../tokenChainTrace/tokenChainTraceStore";

beforeEach(() => {
  tokenChainTraceStore.reset();
  tokenChainTraceStore.beginTrace({ prompt: "show my accounts" });
});

const stepById = (id) => tokenChainTraceStore.getState().steps.find((s) => s.id === id);

test("LLM-routed legacy run fills agent + llm steps with synthesized llmDetail", () => {
  ingestLegacyRunTrace({
    agentPath: "llm",
    reply: "Here are your accounts.",
    success: true,
    toolsCalled: ["get_my_accounts"],
    inputTokens: 812,
    outputTokens: 96,
  });
  const { trace } = tokenChainTraceStore.getState();
  expect(trace.routingMode).toBe("llm");
  expect(trace.llmDetail).toMatchObject({
    toolCalls: [{ tool: "get_my_accounts" }],
    usage: { inputTokens: 812, outputTokens: 96 },
  });
  expect(stepById("agent").status).toBe("done");
  const llm = stepById("llm");
  expect(llm.status).toBe("done");
  // Not the heuristic variant — the LLM really ran
  expect(llm.lane).not.toBe("HEURISTICS");
  expect(stepById("reply").status).toBe("done");
});

test("heuristic legacy run keeps the heuristic step variant", () => {
  ingestLegacyRunTrace({
    agentPath: "heuristic",
    reply: "accounts table",
    success: true,
    toolsCalled: ["get_my_accounts"],
  });
  const { trace } = tokenChainTraceStore.getState();
  expect(trace.routingMode).toBe("heuristic");
  expect(trace.llmDetail).toBeNull();
  expect(stepById("llm").lane).toBe("HEURISTICS");
  expect(stepById("llm").status).toBe("done");
});

test("forceHeuristic wins over agentPath and errors complete the trace as failed", () => {
  ingestLegacyRunTrace(
    { agentPath: "llm", error: "MCP error: 503" },
    { forceHeuristic: true },
  );
  const { trace } = tokenChainTraceStore.getState();
  expect(trace.routingMode).toBe("heuristic");
  expect(trace.outcome).toBe("error");
});

// Regression: the agent success path (UC1) rendered "Incomplete" because
// ingestLegacyRunTrace never surfaced the tool result or the response's token
// events — so 'tool-dispatched' and 'token-exchange' evidence could not match.
test("successful agent run ingests token events + a tool-dispatched marker", () => {
  ingestLegacyRunTrace({
    agentPath: "llm",
    reply: "Your checking balance is $10877.02.",
    success: true,
    toolsCalled: ["get_account_balance"],
    tokenEvents: [
      { id: "user-token", timestamp: 1 },
      { id: "two-ex-exchange1", timestamp: 2, exchangeStep: 1 },
    ],
    mcpAuthorizeEvaluation: { decision: "PERMIT", engine: "pingone" },
  });
  const { trace } = tokenChainTraceStore.getState();
  expect(trace.tokenEvents.map((e) => e.id)).toEqual(
    expect.arrayContaining(["user-token", "two-ex-exchange1"]),
  );
  expect(trace.tokenEvents.some((e) => e.exchangeStep != null)).toBe(true);
  expect(trace.authorize).toMatchObject({ decision: "PERMIT" });
  expect(trace.mcpResult).toMatchObject({ tool: "get_account_balance", status: "success" });
});

test("a failed agent run synthesizes an error mcpResult for TraceRail", () => {
  ingestLegacyRunTrace({
    agentPath: "heuristic",
    success: false,
    reply: "❌ mcp_error",
    toolsCalled: ["get_weather"],
  });
  const { trace, steps } = tokenChainTraceStore.getState();
  expect(trace.mcpResult).toMatchObject({
    tool: "get_weather",
    status: "error",
    error: "mcp_error",
  });
  expect(trace.outcome).toBe("error");
  const mcp = steps.find((s) => s.id === "mcp");
  expect(mcp.status).toBe("error");
  expect(mcp.detail.why).toMatch(/get_weather|mcp_error/i);
});
