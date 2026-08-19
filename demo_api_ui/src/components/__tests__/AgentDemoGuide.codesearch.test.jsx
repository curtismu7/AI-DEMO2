import { DEMO_SCENARIOS } from "../AgentDemoGuide";

test("Agent Demo Guide includes a semantic code-search scenario", () => {
  const s = DEMO_SCENARIOS.find((x) => x.id === "code-search-rag");
  expect(s).toBeTruthy();
  expect(s.applicableSteps).toEqual(expect.arrayContaining([
    "token-exchange",
    "pingauthorize-policy",
    "mcp-tool-execution",
    "agent-llm-reasoning",
  ]));
  // Multi-step walkthrough: index -> search -> interpret.
  expect(s.steps.length).toBe(3);
});
