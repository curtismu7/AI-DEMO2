import { chatReplyMessage, llmReplyMessage, llmDenialMessage, LLM_POLICY_DENIED } from "../privilegeChat";

describe("chatReplyMessage", () => {
  it("shapes a full /chat reply", () => {
    const data = {
      reply: "Found 2 tools",
      tools: [{ name: "a" }, { name: "b" }],
      suggested_tools: [{ name: "a" }],
      policy: { total: 2 },
      decision: { tool: "a", outcome: "ALLOWED" },
      execution: { ok: true },
      steps: ["mcp_initialized"],
    };
    expect(chatReplyMessage(data)).toEqual({
      content: "Found 2 tools",
      extra: {
        available_tools: ["a", "b"],
        suggested_tools: [{ name: "a" }],
        policy: { total: 2 },
        decision: { tool: "a", outcome: "ALLOWED" },
        execution: { ok: true },
        steps: ["mcp_initialized"],
      },
    });
  });

  it("defaults every field for an empty reply", () => {
    expect(chatReplyMessage({})).toEqual({
      content: "Done.",
      extra: { available_tools: [], suggested_tools: [], policy: null, decision: null, execution: null, steps: [] },
    });
  });
});

describe("llmReplyMessage", () => {
  it("carries the reply and a route/latency step", () => {
    expect(llmReplyMessage("anthropic", { reply: "hi", route: "/v1/x", latencyMs: 12 })).toEqual({
      content: "hi",
      extra: { steps: ["anthropic · /v1/x · 12 ms"] },
    });
  });
});

describe("llmDenialMessage", () => {
  it("speaks the denial with the reason and the denying route", () => {
    expect(llmDenialMessage("anthropic", { reason: "blocked by policy", provider: "anthropic", route: "/v1/x" })).toEqual({
      content: "⚠️ Privilege denied this call. blocked by policy",
      extra: { steps: ["anthropic · /v1/x · denied by policy"] },
    });
  });

  it("falls back to the message, the lane's provider and an empty route", () => {
    expect(llmDenialMessage("google", { message: "nope" })).toEqual({
      content: "⚠️ Privilege denied this call. nope",
      extra: { steps: ["google ·  · denied by policy"] },
    });
  });

  it("exposes the denial code both surfaces match on", () => {
    expect(LLM_POLICY_DENIED).toBe("llm_policy_denied");
  });
});
