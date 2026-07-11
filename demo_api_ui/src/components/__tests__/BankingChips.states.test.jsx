// demo_api_ui/src/components/__tests__/BankingChips.states.test.jsx
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import BankingChips from "../BankingChips";

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    pageManifest: {
      identity: { displayName: "CareConnect" },
      dashboard: {
        chips10: [
          { id: "rec", label: "My records", message: "show my records", mode: "both", tool: "get_records" },
        ],
      },
    },
  }),
}));

// BankingChips derives needsSignIn from the session-token context; each test
// sets mockToken to the token state it needs.
let mockToken = { hasActiveToken: true, tokenLoading: false, staleSession: false };
vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => mockToken,
}));

describe("BankingChips chip states", () => {
  it("keeps an unverifiable chip (Authorize-unreachable) visible AND clickable", () => {
    mockToken = { hasActiveToken: true, tokenLoading: false, staleSession: false };
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        toolsError
        onChipClick={() => {}}
      />,
    );
    // Unverifiable != denied: the chip renders active — never hidden, never
    // disabled. Enforcement happens at the gateway's per-call Authorize
    // decision (fail-closed), not via chip affordance.
    const btn = screen.getByText("My records").closest("button");
    expect(btn.className).not.toContain("banking-chips-dropdown__button--unverified");
    expect(btn.className).not.toContain("banking-chips-dropdown__button--denied");
    expect(btn).not.toBeDisabled();
  });

  it("keeps a chip visible and clickable when its tool is absent from the loaded list (degraded/stale discovery)", () => {
    mockToken = { hasActiveToken: true, tokenLoading: false, staleSession: false };
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{ some_other_tool: { permitted: true } }}
        onChipClick={() => {}}
      />,
    );
    const btn = screen.getByText("My records").closest("button");
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("greys a chip ONLY on an explicit Authorize deny, with the reason in the tooltip", () => {
    mockToken = { hasActiveToken: true, tokenLoading: false, staleSession: false };
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{ get_records: { permitted: false, deniedReason: "insufficient_scope" } }}
        onChipClick={() => {}}
      />,
    );
    const btn = screen.getByText("My records").closest("button");
    expect(btn.className).toContain("banking-chips-dropdown__button--denied");
    expect(btn).toHaveAttribute("title", expect.stringContaining("insufficient_scope"));
  });

  it("still prompts sign-in when there's no token", () => {
    mockToken = { hasActiveToken: false, tokenLoading: false, staleSession: false };
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        toolsError
        onChipClick={() => {}}
      />,
    );
    // The sign-in CTA is session-state driven and unchanged; the chip itself
    // stays active (no unverified lockout).
    expect(screen.getByRole("button", { name: /sign in to use these actions/i })).toBeInTheDocument();
    const btn = screen.getByText("My records").closest("button");
    expect(btn).not.toBeDisabled();
  });
});
