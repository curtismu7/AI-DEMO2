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

describe("BankingChips grey states", () => {
  it("marks an unverified (Authorize-unreachable) chip with the --unverified class", () => {
    mockToken = { hasActiveToken: true, tokenLoading: false, staleSession: false };
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        toolsError
        onChipClick={() => {}}
      />,
    );
    const btn = screen.getByText("My records").closest("button");
    expect(btn.className).toContain("banking-chips-dropdown__button--unverified");
    expect(btn).toHaveAttribute(
      "title",
      expect.stringContaining("couldn't reach PingOne or the demo authorize server"),
    );
  });

  it("prompts sign-in (not an authorize error) when there's no token", () => {
    mockToken = { hasActiveToken: false, tokenLoading: false, staleSession: false };
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        toolsError
        onChipClick={() => {}}
      />,
    );
    // A clickable sign-in CTA appears, and the unverified chip tooltip switches
    // from the misleading authorize-outage copy to a sign-in prompt.
    expect(screen.getByRole("button", { name: /sign in to use these actions/i })).toBeInTheDocument();
    const btn = screen.getByText("My records").closest("button");
    expect(btn).toHaveAttribute("title", "Sign in to use these actions.");
  });
});
