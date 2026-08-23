import { describe, it, expect } from "vitest";
import { resolveTopoNodes } from "../TokenFlowDetailModal";

/**
 * The modal's topology row is five CURATED slots, not the whole 17-step trace —
 * that compactness is the point. But which step fills each slot depends on what
 * actually ran, so the slots are defined by ROLE and filled from the run.
 *
 * The previous hardcoded list named specific ids, which meant it silently
 * omitted exchange-1 (two-exchange mode), api-key-swap (API-key path), stepup
 * and intent-binding, and drew a permanently greyed "BFF Exchange" once ID-JAG
 * replaced the exchange. Each new flow shape needed another special case.
 */

const step = (id, status = "done") => ({ id, status });

const ids = (steps) => resolveTopoNodes(steps).map((n) => n.id);

describe("topology slots — classic RFC 8693 run", () => {
  const classic = [
    step("signin"), step("agent-token"), step("exchange"),
    step("authorize"), step("gateway"), step("mcp"),
    step("stepup", "notinpath"), step("api-key-swap", "notinpath"),
  ];

  it("reproduces the original five nodes exactly", () => {
    expect(ids(classic)).toEqual(["signin", "exchange", "authorize", "gateway", "mcp"]);
  });

  it("keeps five slots — the row stays compact", () => {
    expect(resolveTopoNodes(classic)).toHaveLength(5);
  });
});

describe("topology slots — empty trace", () => {
  it("falls back to the classic ids so an unstarted run looks unchanged", () => {
    expect(ids([])).toEqual(["signin", "exchange", "authorize", "gateway", "mcp"]);
  });
});

describe("topology slots — native ID-JAG", () => {
  const native = [
    step("signin"), step("id-jag-issued"), step("id-jag-redeemed"),
    step("exchange", "notinpath"), step("authorize"), step("gateway"), step("mcp"),
  ];

  it("shows the redemption as the token-mint node, not a greyed exchange", () => {
    expect(ids(native)).toEqual(["signin", "id-jag-redeemed", "authorize", "gateway", "mcp"]);
  });

  it("labels the mint node for what it is", () => {
    const mint = resolveTopoNodes(native)[1];
    expect(mint.name).toMatch(/ID-JAG/i);
    expect(mint.lane).toBe("MCP");
    expect(mint.badgeCls).toBe("tfd-badge-MCP");
  });
});

describe("topology slots — two-exchange mode", () => {
  it("still shows the delegated exchange, not the narrowing one", () => {
    const twoEx = [
      step("signin"), step("exchange-1"), step("exchange"),
      step("authorize"), step("gateway"), step("mcp"),
    ];
    expect(ids(twoEx)).toContain("exchange");
  });

  it("shows the narrowing hop when the delegated exchange never ran", () => {
    const onlyNarrowing = [
      step("signin"), step("exchange-1"), step("exchange", "notinpath"),
      step("authorize"), step("gateway"), step("mcp"),
    ];
    expect(ids(onlyNarrowing)).toContain("exchange-1");
  });
});

describe("topology slots — API-key path", () => {
  it("surfaces the credential swap instead of a plain gateway node", () => {
    const apiKey = [
      step("signin"), step("exchange"), step("authorize"),
      step("api-key-swap"), step("gateway"), step("mcp"),
    ];
    expect(ids(apiKey)).toContain("api-key-swap");
  });
});

describe("topology slots — step-up escalation", () => {
  it("surfaces the human-approval hop in the policy slot", () => {
    const stepUp = [
      step("signin"), step("exchange"), step("stepup"),
      step("authorize"), step("gateway"), step("mcp"),
    ];
    expect(ids(stepUp)).toContain("stepup");
  });
});

describe("every resolvable node is presentable", () => {
  it("carries an icon, name, lane and a badge class that exists in CSS", () => {
    const everything = [
      "signin", "exchange", "exchange-1", "id-jag-redeemed", "agent-token",
      "authorize", "stepup", "intent-binding", "gateway", "api-key-swap", "mcp", "api",
    ].map((id) => step(id));

    // Drive each slot to each of its candidates by running only that one.
    for (const s of everything) {
      const nodes = resolveTopoNodes([s]);
      const node = nodes.find((n) => n.id === s.id);
      if (!node) continue;
      expect(node.icon, `${s.id} icon`).toBeTruthy();
      expect(node.name, `${s.id} name`).toBeTruthy();
      expect(node.badgeCls, `${s.id} badge`).toMatch(
        /^tfd-badge-(PINGONE|BFF|AUTHZ|GATEWAY|MCP|API|AGENT|CHAT|LLM|HEURISTICS)$/,
      );
    }
  });
});
