import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import TokenChainDisplay, { getTokenChainProgress } from "../TokenChainDisplay";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";
import { createMockIdJagTrace } from "../../utils/idJagMockTrace";

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ events: [], history: [], mcpToolCalls: [], mcpAuthMode: "consumer", nlRoutingEvent: null, clearEvents: vi.fn(), clearMcpToolCalls: vi.fn(), resolvedIdentity: null }),
}));
vi.mock("../../context/EducationUIContext", () => ({ useEducationUIOptional: () => null }));
vi.mock("../../hooks/useDraggablePanel", () => ({
  useDraggablePanel: () => ({ pos: { x: 0, y: 0 }, size: { width: 640, height: 420 }, handleDragStart: vi.fn(), createResizeHandler: vi.fn() }),
}));

beforeEach(() => {
  tokenChainTraceStore.reset();
  global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
});

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

describe("TokenChainDisplay ID-JAG provenance", () => {
  it("shows the mock fixture and labels its claim cards as a mock replay", () => {
    render(<TokenChainDisplay />);
    act(() => tokenChainTraceStore.replayTrace(createMockIdJagTrace()));
    expect(screen.getByText("Mock replay", { selector: ".trace-provenance" })).toBeInTheDocument();
    expect(screen.getByText("Mock PingFederate issued an ID-JAG")).toBeInTheDocument();
    expect(screen.getByText("Mock MCP authorization server redeemed the ID-JAG")).toBeInTheDocument();
    expect(screen.queryByText("Live run", { selector: ".trace-provenance" })).not.toBeInTheDocument();
  });

  it("shows live PF claims without a stand-in caption", () => {
    render(<TokenChainDisplay />);
    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: "show my balance", provenance: "live-id-jag", mode: "id-jag" });
      tokenChainTraceStore.ingestTokenEvents([
        { id: "pf-id-jag-issued", label: "PingFederate issued an ID-JAG", status: "active", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", claims: { iss: "https://pf.example" } },
        { id: "pf-id-jag-redeemed", label: "Downstream AS redeemed the ID-JAG", status: "exchanged", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", claims: { iss: "https://as.example" } },
      ]);
    });
    expect(screen.getByText("PingFederate ID-JAG", { selector: ".trace-provenance" })).toBeInTheDocument();
    expect(screen.getByText("PingFederate issued an ID-JAG")).toBeInTheDocument();
    expect(screen.queryByText(/ID-JAG equivalent \(stand-in\)/)).not.toBeInTheDocument();
  });
});
