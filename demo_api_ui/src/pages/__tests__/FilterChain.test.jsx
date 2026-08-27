import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilterChain } from "../TransactionTracePage";
import { GW_STAGE_META } from "../../services/tokenChainTrace/buildTraceSteps";

// The PingGateway MCP filters are the product features this trace exists to
// demonstrate. p1az-decision.groovy has always published them on the audit
// trail, but transaction-hop.groovy did not forward them, so the reel showed
// PingGateway's verdict with no sign of what produced it.
describe("FilterChain", () => {
  const chain = [
    { filter: "McpValidationFilter", result: "passed" },
    { filter: "McpAuditFilter", result: "passed" },
    { filter: "McpProtectionFilter", result: "passed" },
    { filter: "P1AZDecision", result: "forwarded", decision: "PERMIT" },
  ];

  // Shares GW_STAGE_META with the Token Chain rail. Asserting against the map
  // rather than hardcoded strings is what makes the two surfaces provably
  // agree: change a label in one place and both move, or this fails.
  it("uses the same human labels as the Token Chain rail, in order", () => {
    render(<FilterChain chain={chain} denyingFilter={null} />);
    const rendered = screen.getByTestId("filter-chain").textContent;
    expect(rendered).toContain(GW_STAGE_META.McpValidationFilter.label);
    expect(rendered).toContain(GW_STAGE_META.McpAuditFilter.label);
    expect(rendered).toContain(GW_STAGE_META.McpProtectionFilter.label);
    expect(rendered.indexOf(GW_STAGE_META.McpValidationFilter.label))
      .toBeLessThan(rendered.indexOf(GW_STAGE_META.P1AZDecision.label));
    // The raw Java class name is what the reel showed before the map was
    // shared — its absence is the regression guard.
    expect(rendered).not.toContain("McpValidationFilter");
  });

  it("falls back to the raw filter name when the map has no entry", () => {
    render(<FilterChain chain={[{ filter: "SomeFutureFilter", result: "passed" }]} denyingFilter={null} />);
    expect(screen.getByTestId("filter-chain").textContent).toContain("SomeFutureFilter");
  });

  // Absent must not read as "no filters ran". Hops from other services never
  // carry a chain, and ping-gateway omits it when the trail was unreadable —
  // transaction-hop.groovy fails open by design.
  it.each([[undefined], [null], [[]]])("renders nothing for %s rather than an empty shell", (value) => {
    const { container } = render(<FilterChain chain={value} denyingFilter={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks only the filter that actually stopped the call", () => {
    const denied = [
      { filter: "McpValidationFilter", result: "passed" },
      { filter: "P1AZDecision", result: "blocked", decision: "DENY" },
    ];
    render(<FilterChain chain={denied} denyingFilter="P1AZDecision" />);
    const pills = screen.getByTestId("filter-chain").querySelectorAll(".ttrace-filter");
    const blocked = [...pills].filter((p) => p.classList.contains("blocked"));
    expect(blocked).toHaveLength(1);
    expect(blocked[0].textContent).toContain(GW_STAGE_META.P1AZDecision.label);
  });

  // A PERMIT names no denying filter, so nothing should be flagged even though
  // every pill carries a result.
  it("flags nothing when no filter denied", () => {
    render(<FilterChain chain={chain} denyingFilter={null} />);
    const pills = screen.getByTestId("filter-chain").querySelectorAll(".ttrace-filter.blocked");
    expect(pills).toHaveLength(0);
  });
});
