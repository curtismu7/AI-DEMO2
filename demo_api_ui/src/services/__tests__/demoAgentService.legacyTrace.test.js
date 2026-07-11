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
