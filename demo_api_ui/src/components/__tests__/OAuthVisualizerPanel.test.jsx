import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OAuthVisualizerPanel from "../OAuthVisualizerPanel";

vi.mock("../oauthVisualizer/MermaidFlowDiagram", () => ({ default: () => <div data-testid="oauth-diagram" /> }));
vi.mock("../DraggableModal", () => ({ default: ({ isOpen, children }) => isOpen ? <div role="dialog">{children}</div> : null }));

describe("OAuthVisualizerPanel", () => {
  it("renders the selected flow, controls, and first step", () => {
    render(<OAuthVisualizerPanel embedded onOpenPopout={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "OAuth Visualizer" })).toBeTruthy();
    expect(screen.getByText("Authorization Code")).toBeTruthy();
    expect(screen.getByRole("button", { name: /run flow/i })).toBeTruthy();
    expect(screen.getByTestId("oauth-diagram")).toBeTruthy();
  });

  it("supports selecting another flow and opening its step detail", () => {
    render(<OAuthVisualizerPanel embedded />);
    fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "client-credentials" } });
    expect(screen.getByText("Authenticate client")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /receive access token/i }));
    expect(screen.getByText(/run the flow to capture/i)).toBeTruthy();
  });

  it("renders the pop-out body only when opened", () => {
    const { rerender } = render(<OAuthVisualizerPanel isOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<OAuthVisualizerPanel isOpen />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
