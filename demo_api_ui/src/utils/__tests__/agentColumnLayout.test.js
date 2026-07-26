// demo_api_ui/src/utils/__tests__/agentColumnLayout.test.js
import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_COL_DEFAULT_WIDTH,
  AGENT_COL_MAX_WIDTH,
  AGENT_COL_MIN_WIDTH,
  AGENT_COL_WIDTH_KEY,
  persistAgentColWidth,
  readStoredAgentColWidth,
} from "../agentColumnLayout";

describe("agentColumnLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns default width when nothing stored", () => {
    expect(readStoredAgentColWidth()).toBe(AGENT_COL_DEFAULT_WIDTH);
  });

  it("clamps stored width to min/max", () => {
    localStorage.setItem(AGENT_COL_WIDTH_KEY, "50");
    expect(readStoredAgentColWidth()).toBe(AGENT_COL_MIN_WIDTH);
    localStorage.setItem(AGENT_COL_WIDTH_KEY, "9999");
    expect(readStoredAgentColWidth()).toBe(AGENT_COL_MAX_WIDTH);
  });

  it("persists width", () => {
    persistAgentColWidth(640);
    expect(localStorage.getItem(AGENT_COL_WIDTH_KEY)).toBe("640");
    expect(readStoredAgentColWidth()).toBe(640);
  });
});
