import { describe, it, expect } from "vitest";
import { getTokenChainProgress } from "../TokenChainDisplay";

/**
 * The ID-JAG steps emitted by the BFF in enterprise-managed native mode
 * (`id-jag-issued`, `id-jag-redeemed`) are rendered generically: TokenChainDisplay
 * maps over ctx.events with no known-id allow-list, and getTokenChainProgress
 * counts by STATUS rather than by id.
 *
 * This guards that property. If anyone later introduces an id allow-list or a
 * per-id progress table, these steps would silently vanish from the chain — the
 * failure mode where a feature ships, passes its server tests, and shows nothing.
 */

const chain = [
  { id: "user-token", label: "User token", status: "active" },
  { id: "enterprise-managed-mode", label: "Enterprise-Managed MCP", status: "active", idJagStandIn: false },
  { id: "id-jag-issued", label: "Enterprise IdP issued an ID-JAG", status: "active" },
  { id: "id-jag-redeemed", label: "MCP Authorization Server redeemed the ID-JAG", status: "active" },
  { id: "mcp-tool-result", label: "Tool result", status: "active" },
];

describe("token chain progress with native ID-JAG steps", () => {
  it("counts the ID-JAG steps instead of dropping them as unknown ids", () => {
    const progress = getTokenChainProgress(chain, true);
    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(5);
  });

  it("still reaches a completed chain when ID-JAG steps replace the exchange", () => {
    const progress = getTokenChainProgress(chain, true);
    expect(progress.state).toBe("completed");
    expect(progress.label).toBe("Chain complete");
  });

  it("counts the stand-in chain identically, so neither mode is favoured", () => {
    const standIn = [
      { id: "user-token", label: "User token", status: "active" },
      { id: "enterprise-managed-mode", label: "Enterprise-Managed MCP", status: "active", idJagStandIn: true },
      { id: "exchanged-token", label: "Exchanged token", status: "active" },
      { id: "mcp-tool-result", label: "Tool result", status: "active" },
    ];
    const progress = getTokenChainProgress(standIn, true);
    expect(progress.state).toBe("completed");
    expect(progress.completed).toBe(4);
  });

  it("surfaces a failed ID-JAG redemption as a failed chain", () => {
    const failed = [
      { id: "user-token", label: "User token", status: "active" },
      { id: "id-jag-issued", label: "Enterprise IdP issued an ID-JAG", status: "active" },
      { id: "id-jag-redeemed", label: "Redemption refused", status: "failed" },
    ];
    const progress = getTokenChainProgress(failed, true);
    expect(progress.state).toBe("failed");
  });
});
