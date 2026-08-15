import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FloatingTokenChainPanel from "../FloatingTokenChainPanel";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ clearEvents: vi.fn() }),
}));

// Confirms the swap from the illustrative education/TokenChainPanel to the
// real TokenChainTraceRail: a chip-fired trace's aud/scope diff must render
// inside the floating panel, not just inside TokenChainModal.
describe("FloatingTokenChainPanel", () => {
  beforeEach(() => tokenChainTraceStore.reset());
  afterEach(cleanup);

  it("exposes a Clear control on the floating panel header", () => {
    render(<FloatingTokenChainPanel isOpen onClose={() => {}} />);
    const clears = screen.getAllByRole("button", { name: /clear token chain/i });
    expect(clears.length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector(".ftcp-btn--clear")).toBeTruthy();
  });

  it("renders TokenChainTraceRail's live step data, not the illustrative panel", () => {
    tokenChainTraceStore.beginTrace({ prompt: "get_my_accounts" });
    tokenChainTraceStore.ingestTokenEvents([
      { id: "user-token", label: "User Token", claims: { aud: "https://banking-api.example.com", scope: "openid read write" } },
      { id: "exchanged-token", label: "Delegated Token", claims: { aud: "https://mcp.example.com", scope: "read", act: { sub: "agent-service" } } },
    ]);

    render(<FloatingTokenChainPanel isOpen onClose={() => {}} />);

    // Real rail chrome, absent from the old illustrative panel. Legend moved
    // into the rail's More tray when the toolbar was consolidated.
    fireEvent.click(screen.getByRole("button", { name: /^More$/ }));
    expect(screen.getByText("Legend")).toBeTruthy();
    expect(screen.getByText(/Pipeline/)).toBeTruthy();

    // Expand the token summary to confirm the real aud-rebound diff renders.
    fireEvent.click(screen.getByText(/Token Summary/));
    expect(screen.getAllByText(/rebound/).length).toBeGreaterThan(0);
  });

  it("Inspect claims opens ClaimDetailsModal with this run's real values, not static examples", () => {
    tokenChainTraceStore.beginTrace({ prompt: "get_my_accounts" });
    tokenChainTraceStore.ingestTokenEvents([
      { id: "exchanged-token", label: "Delegated Token", claims: { aud: "https://mcp.example.com", scope: "read" } },
    ]);

    render(<FloatingTokenChainPanel isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByText(/Token Summary/));
    fireEvent.click(screen.getAllByText("Inspect")[0]);

    expect(screen.getByText("Live — this run")).toBeTruthy();
    expect(screen.getByText("https://mcp.example.com")).toBeTruthy();
  });
});
