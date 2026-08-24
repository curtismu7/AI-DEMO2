// Guards the architecture diagram's mermaid source: mermaid.parse rejects
// invalid diagram syntax, which a render smoke test in jsdom cannot cover
// (mermaid.render needs real layout measurement).
import { describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { ARCHITECTURE_SOURCE } from "./McpGatewayOauthFlowPage";

describe("McpGatewayOauthFlowPage mermaid sources", () => {
  it("architecture source parses as valid mermaid", async () => {
    await expect(mermaid.parse(ARCHITECTURE_SOURCE)).resolves.toBeTruthy();
  });
});
