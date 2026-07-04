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

describe("BankingChips grey states", () => {
  it("marks an unverified (Authorize-unreachable) chip with the --unverified class", () => {
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
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        toolsError
        needsSignIn
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
