import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TokenChainDisplay from "../TokenChainDisplay";

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({
    events: [],
    history: [],
    mcpToolCalls: [],
    mcpAuthMode: null,
    nlRoutingEvent: null,
    clearEvents: vi.fn(),
    clearMcpToolCalls: vi.fn(),
    resolvedIdentity: null,
  }),
}));

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => null,
}));

vi.mock("../../hooks/useDraggablePanel", () => ({
  useDraggablePanel: () => ({
    pos: { x: 0, y: 0 },
    size: { width: 640, height: 420 },
    handleDragStart: vi.fn(),
    createResizeHandler: vi.fn(),
  }),
}));

describe("TokenChainDisplay theme toggle", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
  });

  it("toggles panel-local light/dark theme", () => {
    const { container } = render(<TokenChainDisplay />);
    const root = container.querySelector(".tcd-root");

    expect(root).not.toBeNull();
    expect(root.getAttribute("data-theme")).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: /toggle token chain theme/i }));
    expect(root.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: /toggle token chain theme/i }));
    expect(root.getAttribute("data-theme")).toBe("light");
  });
});
