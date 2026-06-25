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
});
