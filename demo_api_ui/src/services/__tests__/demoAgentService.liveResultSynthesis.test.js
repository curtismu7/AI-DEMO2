// A chat run's MCP result can reach the trace live, as an mcp-result frame,
// before the run's envelope arrives. The end-of-run synthesis carries no result,
// request or timing, so it must fill in around a live result for the same run
// rather than replace it — otherwise forwarding the live frame is undone the
// moment the run finishes.
import { ingestLegacyRunTrace } from "../demoAgentService";
import { tokenChainTraceStore } from "../tokenChainTrace/tokenChainTraceStore";

const LIVE = {
  tool: "get_my_accounts",
  flowTraceId: "ft-live",
  requestJson: { name: "get_my_accounts", arguments: {} },
  result: { accounts: [{ id: "chk-1" }] },
  durationMs: 42,
};

beforeEach(() => {
  tokenChainTraceStore.reset();
  tokenChainTraceStore.beginTrace({ prompt: "show my accounts" });
});

test("a successful run keeps the live result, request and timing", () => {
  tokenChainTraceStore.ingestMcpResult(LIVE);
  ingestLegacyRunTrace(
    { agentPath: "heuristic", success: true, reply: "ok", toolsCalled: ["get_my_accounts"] },
    { flowTraceId: "ft-live" },
  );
  const { mcpResult } = tokenChainTraceStore.getState().trace;
  expect(mcpResult.result).toEqual(LIVE.result);
  expect(mcpResult.requestJson).toEqual(LIVE.requestJson);
  expect(mcpResult.durationMs).toBe(42);
});

test("a failed run adds the envelope's error without losing the live request", () => {
  tokenChainTraceStore.ingestMcpResult(LIVE);
  ingestLegacyRunTrace(
    {
      agentPath: "heuristic",
      success: false,
      error: "gateway_policy_denied",
      gatewayErrorCode: "weather_scope_denied",
      reply: "denied",
      toolsCalled: ["get_weather"],
    },
    { flowTraceId: "ft-live" },
  );
  const { mcpResult } = tokenChainTraceStore.getState().trace;
  expect(mcpResult).toMatchObject({ status: "error", error: "weather_scope_denied", denied: true });
  expect(mcpResult.requestJson).toEqual(LIVE.requestJson);
});

test("a result from a different run is not treated as live", () => {
  tokenChainTraceStore.ingestMcpResult({ ...LIVE, flowTraceId: "ft-old" });
  ingestLegacyRunTrace(
    { agentPath: "heuristic", success: true, reply: "ok", toolsCalled: ["get_my_accounts"] },
    { flowTraceId: "ft-new" },
  );
  const { mcpResult } = tokenChainTraceStore.getState().trace;
  expect(mcpResult.flowTraceId).toBe("ft-new");
  expect(mcpResult.result).toBeNull();
});
