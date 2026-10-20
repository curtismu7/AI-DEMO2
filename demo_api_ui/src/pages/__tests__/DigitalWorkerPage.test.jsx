/* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the "draggable" class is what shows they move */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DigitalWorkerPage from "../DigitalWorkerPage";
import { INITIAL_EDGES } from "../digitalWorkerDiagram";
import { PAGE_GUIDES } from "../../config/pageGuides";
import { lessonCatalog } from "../../learning/lessonCatalog";

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

describe("DigitalWorkerPage learning surfaces", () => {
  it("page guide lists the digital-worker-live lesson and the catalog has it", () => {
    expect(PAGE_GUIDES["/digital-worker"].lessons).toContain("digital-worker-live");
    expect(lessonCatalog.some((lesson) => lesson.id === "digital-worker-live")).toBe(true);
  });
});

describe("DigitalWorkerPage run sections", () => {
  it("renders the lede, the tabs, the studio, and the unattended panel", async () => {
    renderPage();
    expect(screen.getByText(/An assistant answers questions\. A worker takes action — it holds delegated identity, spends it across tools, and every action is governed\./)).toBeTruthy();
    expect(screen.getByText("UC38 · wire transfer with step-up MFA and HITL")).toBeTruthy();
    // The studio's own "Run UC38 action" is the one way to start a run: the page adds no second button.
    expect(await screen.findByTestId("studio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run worker task" })).toBeNull();
    // The unattended panel lives on its own tab; it self-fetches its flag, then shows its unarmed state.
    fireEvent.click(screen.getByRole("tab", { name: /Unattended/ }));
    expect(await screen.findByRole("switch", { name: /arm the worker/i })).toBeTruthy();
  });

  it("says it is loading until the governed run arrives", async () => {
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the governed run…");
    await screen.findByTestId("studio");
    expect(screen.queryByText("Loading the governed run…")).toBeNull();
  });

  it("puts the agent first and the diagram last", async () => {
    renderPage();
    await screen.findByTestId("studio"); // let the page's fetches settle
    const agent = screen.getByRole("region", { name: "Digital worker agent" });
    const diagram = screen.getByRole("region", { name: "Architecture diagram" });
    // DOCUMENT_POSITION_FOLLOWING: the diagram comes after the agent card.
    expect(agent.compareDocumentPosition(diagram) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(diagram).getByRole("heading", { name: "How it works" })).toBeTruthy();
  });

  it("opens on Attended and switches modes without unmounting either", async () => {
    renderPage();
    const attended = screen.getByRole("tab", { name: /Attended/ });
    const unattended = screen.getByRole("tab", { name: /Unattended/ });
    expect(attended.getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("dw-pane-unattended").hidden).toBe(true);

    fireEvent.click(unattended);
    expect(unattended.getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("dw-pane-attended").hidden).toBe(true);
    expect(document.getElementById("dw-pane-unattended").hidden).toBe(false);

    // Both panes stay in the DOM, so the studio's run and the panel's arm state survive a switch.
    await screen.findByTestId("studio");
    fireEvent.click(attended);
    expect(screen.getByTestId("studio")).toBeTruthy();
  });

  it("mounts UC38 from the two catalog fetches and never auto-runs it", async () => {
    renderPage();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/verticals/list"));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/use-cases/UC38?vertical=banking"));
    const studio = await screen.findByTestId("studio");
    expect(studio.dataset.scenario).toBe("UC38");
    expect(studio.dataset.vertical).toBe("banking");
    // No runNonce is passed, so mounting cannot fire the workload: only the studio's own button does.
    expect(studio.dataset.nonce).toBeUndefined();
  });

  it("honours a ?vertical deep link", async () => {
    renderPage("/digital-worker?vertical=airlines");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/use-cases/UC38?vertical=airlines"));
    expect((await screen.findByTestId("studio")).dataset.vertical).toBe("airlines");
  });

  it("names the failed catalog load instead of leaving a spinner", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === "/api/verticals/list") return Promise.resolve({ data: [{ id: "banking", displayName: "Banking" }] });
      if (url.startsWith("/api/use-cases/UC38")) return Promise.reject(new Error("catalog down"));
      if (url.startsWith("/api/autonomous-runs/flag")) return Promise.resolve({ data: { enabled: false } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("The governed run could not be loaded for this vertical.");
    expect(screen.queryByTestId("studio")).toBeNull();
    expect(screen.queryByText("Loading the governed run…")).toBeNull();
  });

  it("the jump link scrolls to the diagram without navigating", async () => {
    // Set on HTMLElement.prototype: the suite's setup may already define it there, shadowing Element's.
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      renderPage();
      await screen.findByTestId("studio");
      const notPrevented = fireEvent.click(screen.getByRole("link", { name: /Jump to the diagram/ }));
      expect(notPrevented).toBe(false); // preventDefault: no hash push onto the router history
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
