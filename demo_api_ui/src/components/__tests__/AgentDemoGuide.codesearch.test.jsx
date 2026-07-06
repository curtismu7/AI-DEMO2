import { DEMO_SCENARIOS } from "../AgentDemoGuide";

test("Agent Demo Guide includes a semantic code-search scenario", () => {
  const s = DEMO_SCENARIOS.find((x) => x.id === "code-search-rag");
  expect(s).toBeTruthy();
  // Honest compliance mapping: retrieval only exercises LLM intent reasoning.
  expect(s.applicableSteps).toEqual(["agent-llm-reasoning"]);
  // Multi-step walkthrough: index -> search -> interpret.
  expect(s.steps.length).toBe(3);
});
