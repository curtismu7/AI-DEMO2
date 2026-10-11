import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PrivilegeMcpLearningPage from "../PrivilegeMcpLearningPage";

vi.mock("../../hooks/useDividerDrag", () => ({
  default: () => ({ size: 260, handleProps: {} }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PrivilegeMcpLearningPage />
    </MemoryRouter>,
  );
}

describe("PrivilegeMcpLearningPage request flow", () => {
  it("renders the walkthrough diagram with the shared step bar", () => {
    renderPage();
    expect(screen.getByTestId("pfl-flow-steps")).toBeInTheDocument();
    expect(screen.getByTestId("pfl-flow-reel")).toBeInTheDocument();
  });

  it("keeps the walkthrough teaching the same story as the old chain", () => {
    // jsdom gives the React Flow canvas zero width, so edges and their labels
    // never mount — assert the teaching content through the reel instead: its
    // strip renders one card per walk step with the step's title and label.
    const { container } = renderPage();
    const reel = container.querySelector('[data-testid="pfl-flow-reel"]');
    expect(reel).not.toBeNull();
    const reelText = reel.textContent;
    expect(reelText).toContain("Client connects");
    expect(reelText).toContain("One public URL");
    expect(reelText).toContain("Gateway gates the call");
    expect(reelText).toContain("Policy-gated proxy call");
    // "Backend MCP Server" appears twice (diagram node + deployment table).
    expect(screen.getAllByText(/Backend MCP Server/i).length).toBeGreaterThan(0);
  });
});
