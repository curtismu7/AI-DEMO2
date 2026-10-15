import { describe, expect, it } from "vitest";
import { PERSONAL_AGENT_CLIENTS } from "../personalAgentClients";

describe("personal agent client catalog", () => {
  it("distinguishes the browser LibreChat client from the Mac LM Studio client", () => {
    expect(PERSONAL_AGENT_CLIENTS).toEqual([
      expect.objectContaining({
        id: "librechat",
        label: "LibreChat",
        runtime: "Browser personal agent",
        externalUrl: "http://localhost:3080",
      }),
      expect.objectContaining({
        id: "lm-studio",
        label: "LM Studio",
        runtime: "Mac personal agent",
        setupPath: "/privilege-mcp-client?client=lm-studio",
      }),
      expect.objectContaining({
        id: "dot",
        label: "Dot",
        runtime: "Hosted always-on agent",
        setupPath: "/personal-agent/dot",
      }),
    ]);
  });

  it("names the controls shared by both personal-agent forms", () => {
    for (const client of PERSONAL_AGENT_CLIENTS) {
      expect(client.chips).toEqual(
        expect.arrayContaining(["Personal agent", "OAuth consent", "Per-tool policy"]),
      );
    }
  });
});
