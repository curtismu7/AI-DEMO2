// AgentStudioPreviewPage.test.jsx — the main Agent Studio page (spec page 1
// of 5) was never built; E7 fills that gap. These pin the three persona tabs,
// the wizard wiring to the shared FLOWS data, and the store writes.
import { render, screen, fireEvent, within } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentStudioPreviewPage from "../AgentStudioPreviewPage";
import { agentStudioMockStore } from "../../../data/agentStudioMockStore";

// PreviewBanner links to /platform-gaps — needs a router.
const renderPage = () =>
  render(
    <MemoryRouter>
      <AgentStudioPreviewPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
  agentStudioMockStore.reset();
});

afterEach(() => {
  window.localStorage.clear();
  agentStudioMockStore.reset();
});

describe("AgentStudioPreviewPage — spec page 1 (three persona tabs)", () => {
  it("renders the three persona tabs", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: /enterprise ai user/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /developer/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /admin/i })).toBeTruthy();
  });

  it("walks the Enterprise User flow and registers a governed agent on finish", () => {
    renderPage();
    const tablist = screen.getByRole("tablist", { name: /persona/i });
    // step through the 7-step enterpriseUser flow
    const steps = 7;
    for (let i = 0; i < steps; i += 1) {
      fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: /next step|finish/i }));
    }
    expect(agentStudioMockStore.getState().agents).toHaveLength(1);
    const [agent] = agentStudioMockStore.getState().agents;
    expect(agent.status).toBe("governed");
    expect(agent.source).toBe("Agent Studio");
    expect(within(tablist).getByRole("tab", { name: /enterprise ai user/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("walks the Developer flow and registers its agent", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /developer/i }));
    for (let i = 0; i < 7; i += 1) {
      fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: /next step|finish/i }));
    }
    expect(agentStudioMockStore.getState().agents).toHaveLength(1);
    expect(agentStudioMockStore.getState().agents[0].persona).toBe(
      "Developer / AI Engineer / Agent Builder",
    );
  });

  it("Admin tab approves a pending discovered agent into governance", () => {
    agentStudioMockStore.addDiscovered({
      name: "cursor-shadow-session (unmanaged)",
      source: "Browser & Device",
      detectedAt: "10:00",
    });
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /admin/i }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/cursor-shadow-session/i)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: /approve/i }));
    expect(agentStudioMockStore.getState().agents[0].status).toBe("governed");
  });
});
