import { describe, expect, it } from "vitest";
import {
  AGENT_ROLES,
  EVIDENCE_FRAME_LABELS,
  PRIMARY_AGENT,
  RUN_PROVENANCE,
  formatTraceEventLabel,
  formatAgentLabel,
} from "../agentTerminology";

describe("agent terminology contract", () => {
  it("defines the Academy-aligned primary agent and delegation roles", () => {
    expect(PRIMARY_AGENT).toEqual({
      key: "banking-agent",
      displayName: "Banking Agent",
    });
    expect(AGENT_ROLES).toEqual({
      generalist: "Generalist agent",
      planner: "Planner",
      specialist: "Specialist agent",
    });
  });

  it("keeps run provenance and evidence labels consistent", () => {
    expect(RUN_PROVENANCE).toEqual({
      mock: "Mock replay",
      recorded: "Recorded run",
      live: "Live run",
    });
    expect(EVIDENCE_FRAME_LABELS).toEqual([
      "User prompt",
      "Agent route",
      "Token exchange",
      "Authorize",
      "Tool call",
      "Agent reply",
    ]);
  });

  it("puts the friendly name before technical runtime metadata", () => {
    expect(formatAgentLabel("Banking Agent", "langchain_agent")).toBe(
      "Banking Agent · langchain_agent",
    );
    expect(formatAgentLabel("Membership Specialist")).toBe(
      "Membership Specialist",
    );
  });

  it("normalizes trace labels while preserving unknown event labels", () => {
    expect(formatTraceEventLabel({ id: "a2a-agent1-actor", label: "old label" })).toBe(
      "Banking Agent · Generalist agent actor",
    );
    expect(formatTraceEventLabel({ id: "custom", label: "Custom evidence" })).toBe(
      "Custom evidence",
    );
  });
});
