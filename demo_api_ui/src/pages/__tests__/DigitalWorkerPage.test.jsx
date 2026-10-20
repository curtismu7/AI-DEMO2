/* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the "draggable" class is what shows they move */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DigitalWorkerPage from "../DigitalWorkerPage";
import { INITIAL_EDGES } from "../digitalWorkerDiagram";

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
// Prop probe: the page's contract with the studio is the props it passes, and a
// runNonce bump is invisible in the real studio's DOM.
vi.mock("../PersonalAgentStudioPage", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ scenario, vertical, runNonce }) => createElement("div", {
      "data-testid": "studio",
      "data-scenario": scenario ? scenario.id : "",
      "data-vertical": vertical || "",
      "data-nonce": runNonce,
    }),
  };
});

import apiClient from "../../services/apiClient";

const UC38 = {
  id: "UC38", useCaseId: "personal-agent-concierge", title: "Workload Agent: MFA-gated protected action",
  primaryTool: "create_transfer", runPrompt: "transfer $600 from checking to savings",
};

beforeEach(() => {
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/verticals/list") return Promise.resolve({ data: [{ id: "banking", displayName: "Banking" }, { id: "airlines", displayName: "Airlines" }] });
    if (url.startsWith("/api/use-cases/UC38")) return Promise.resolve({ data: { useCase: UC38 } });
    if (url.startsWith("/api/autonomous-runs/flag")) return Promise.resolve({ data: { enabled: false } });
    return Promise.resolve({ data: {} });
  });
});

function renderPage(route = "/digital-worker") {
  return render(<MemoryRouter initialEntries={[route]}><DigitalWorkerPage /></MemoryRouter>);
}

describe("DigitalWorkerPage diagram rule", () => {
  it("nodes are draggable and editing tools stay", () => {
    localStorage.clear();
    const { container } = renderPage();
    const nodes = container.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBeGreaterThan(0);
    nodes.forEach((n) => expect(n.classList.contains("draggable")).toBe(true));
    expect(screen.getByText("+ Add box")).toBeTruthy();
    expect(screen.getByText("Undo")).toBeTruthy();
  });

  it("Simulate walks the arrows at the chosen speed and Reset clears the walkthrough", () => {
    localStorage.clear();
    renderPage();
    const bar = screen.getByTestId("dw-steps");
    expect(bar.querySelector(".dc-steptime-select")).toBeTruthy();
    fireEvent.click(within(bar).getByText("Simulate"));
    expect(within(bar).getByText(`Step 1 of ${INITIAL_EDGES.length}`)).toBeTruthy();
    fireEvent.click(within(bar).getByText("Reset"));
    expect(within(bar).getByText("Simulate")).toBeTruthy();
  });

  // Regression: the step bar sat in the canvas under the absolutely positioned .dw-bar, so a real click on
  // Simulate hit the toolbar instead (jsdom has no layout, so the click test above could not see it).
  it("step bar lives inside the floating toolbar, not underneath it", () => {
    localStorage.clear();
    renderPage();
    expect(screen.getByTestId("dw-steps").parentElement.classList.contains("dw-bar")).toBe(true);
  });
});

describe("DigitalWorkerPage run sections", () => {
  it("renders the lede, the governed run section, and the unattended panel", async () => {
    renderPage();
    expect(screen.getByText("An assistant answers questions. A worker takes action — it holds delegated identity, spends it across tools, and every action is governed.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Governed worker run" })).toBeTruthy();
    expect(screen.getByText("UC38 · wire transfer with step-up MFA and HITL")).toBeTruthy();
    // The run stays available while the catalog loads, then the click enables.
    expect(screen.getByRole("button", { name: "Run worker task" })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Run worker task" })).toBeEnabled();
    // The panel self-fetches its flag, then shows its unarmed state.
    expect(await screen.findByRole("switch", { name: /arm the worker/i })).toBeTruthy();
  });

  it("clicking Run worker task performs the two use-case fetches and mounts the studio on nonce 1", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Run worker task" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/verticals/list"));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/use-cases/UC38?vertical=banking"));
    const studio = await screen.findByTestId("studio");
    expect(studio.dataset.scenario).toBe("UC38");
    expect(studio.dataset.vertical).toBe("banking");
    expect(studio.dataset.nonce).toBe("1");
  });

  it("a second click bumps runNonce without refetching the catalog", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Run worker task" }));
    await screen.findByTestId("studio");
    fireEvent.click(screen.getByRole("button", { name: "Run worker task" }));
    await waitFor(() => expect(screen.getByTestId("studio").dataset.nonce).toBe("2"));
    expect(apiClient.get.mock.calls.filter(([url]) => url.startsWith("/api/use-cases/UC38"))).toHaveLength(1);
  });

  it("honours a ?vertical deep link", async () => {
    renderPage("/digital-worker?vertical=airlines");
    fireEvent.click(await screen.findByRole("button", { name: "Run worker task" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/use-cases/UC38?vertical=airlines"));
    expect((await screen.findByTestId("studio")).dataset.vertical).toBe("airlines");
  });

  it("names the failed catalog load instead of leaving a dead button", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === "/api/verticals/list") return Promise.resolve({ data: [{ id: "banking", displayName: "Banking" }] });
      if (url.startsWith("/api/use-cases/UC38")) return Promise.reject(new Error("catalog down"));
      if (url.startsWith("/api/autonomous-runs/flag")) return Promise.resolve({ data: { enabled: false } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("The governed run could not be loaded for this vertical.");
    expect(screen.getByRole("button", { name: "Run worker task" })).toBeDisabled();
    expect(screen.queryByTestId("studio")).toBeNull();
  });
});
