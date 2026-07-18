/**
 * Regression: the client's fetch to /api/agent/invoke hard-aborted at 30s
 * while the BFF's own axios call to agent-service used 70s (a value paired
 * with LLAMACPP_MAX_TOKENS). Any request landing in the 30-70s window had its
 * reply silently discarded by AIAgent.js's abort catch. Both sides now read
 * the same llm-timeouts.json — this asserts the client never again drifts
 * below the server's own deadline. See project-agent-client-timeout-mismatch.
 */
import { AGENT_INVOKE_TIMEOUT_MS } from "../demoAgentService";
import llmTimeouts from "../../../../llm-timeouts.json";

test("client abort timeout is never shorter than the BFF's reason-loop timeout", () => {
  expect(AGENT_INVOKE_TIMEOUT_MS).toBeGreaterThanOrEqual(llmTimeouts.REASON_LOOP_TIMEOUT_MS);
});
