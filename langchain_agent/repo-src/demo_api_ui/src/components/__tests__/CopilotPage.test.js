import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

// Mock the flag hook so we control the gate, and stub the heavy chat surface
// (which pulls in MSAL + the Copilot SDK) so this test stays hermetic and fast.
let mockCopilotMode = false;
vi.mock("../../hooks/useAppFlags", () => ({
  useAppFlags: () => ({ appFlags: { copilotMode: mockCopilotMode } }),
}));
vi.mock("../CopilotAgent", () => ({
  default: () => <div data-testid="copilot-surface">surface</div>,
}));

import CopilotPage from "../CopilotPage";

describe("CopilotPage dark-ship gate", () => {
  it("renders the not-enabled notice when copilot_mode_enabled is off (default)", () => {
    mockCopilotMode = false;
    render(<CopilotPage />);
    expect(screen.getByText(/Copilot agent mode is turned off/i)).toBeInTheDocument();
    expect(screen.queryByTestId("copilot-surface")).not.toBeInTheDocument();
  });

  it("renders the chat surface when the flag is on", () => {
    mockCopilotMode = true;
    render(<CopilotPage />);
    expect(screen.getByTestId("copilot-surface")).toBeInTheDocument();
  });
});
