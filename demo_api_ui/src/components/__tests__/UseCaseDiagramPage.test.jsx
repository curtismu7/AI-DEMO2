import { describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import UseCaseDiagramPage from "../UseCaseDiagramPage";
import UseCaseDiagramsGalleryPage from "../UseCaseDiagramsGalleryPage";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/use-case-diagrams" element={<UseCaseDiagramsGalleryPage />} />
        <Route path="/use-case-diagrams/:ucId" element={<UseCaseDiagramPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("UseCaseDiagramPage", () => {
  it("overlays the live walk when the store holds a matching UC1 run", () => {
    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: "balance" });
      tokenChainTraceStore.ingestTokenEvent({ id: "request_accepted", status: "done", useCaseId: "delegated-access-with-proof" });
      tokenChainTraceStore.ingestTokenEvent({ id: "gw-authorize", status: "done", decision: "PERMIT", useCaseId: "delegated-access-with-proof" });
      tokenChainTraceStore.completeTrace(true);
    });
    renderAt("/use-case-diagrams/UC1");
    expect(screen.getByTestId("ucd-mode")).toHaveTextContent("Live run overlay");
    act(() => tokenChainTraceStore.reset());
  });

  it("shows the curated walkthrough when the store is empty", () => {
    act(() => tokenChainTraceStore.reset());
    renderAt("/use-case-diagrams/UC1");
    expect(screen.getByTestId("ucd-mode")).toHaveTextContent("Curated walkthrough");
  });

  it("renders the five header fields from shared data, not config copies", () => {
    renderAt("/use-case-diagrams/UC1");
    expect(screen.getByTestId("ucd-title").textContent).toBe("Delegated access (consent only)"); // from demoStepGuides
    expect(screen.getByTestId("ucd-desc").textContent.length).toBeGreaterThan(40);
    expect(screen.getByTestId("ucd-value").textContent.length).toBeGreaterThan(20);
    expect(screen.getByTestId("ucd-step").textContent).toMatch(/^\d+$/);
    expect(screen.getByTestId("ucd-result").textContent).toBe("PERMIT"); // from config result
  });

  it("cues the live step and links to /use-cases#UCxx (the reverse of the hub's Diagram chip)", () => {
    renderAt("/use-case-diagrams/UC1");
    const cue = screen.getByRole("link", { name: /run this step/i });
    expect(cue.getAttribute("href")).toBe("/use-cases#UC1");
  });

  it("always shows an explicit back button in the header", () => {
    renderAt("/use-case-diagrams/UC1");
    const back = screen.getByTestId("ucd-back");
    expect(back.getAttribute("href")).toBe("/dashboard");
    expect(back.textContent).toMatch(/back/i);
  });

  it("opens idle with the Simulate button visible (walk starts on click)", () => {
    renderAt("/use-case-diagrams/UC1");
    expect(screen.getByRole("button", { name: "Simulate" })).toBeTruthy();
    expect(screen.getByTestId("ucd-floating-panel").textContent).toContain("Press Simulate to walk the diagram");
  });

  it("unknown ucId shows the fallback listing valid ids", () => {
    renderAt("/use-case-diagrams/UC999");
    expect(screen.getByTestId("ucd-missing")).toBeTruthy();
    expect(screen.getByTestId("ucd-missing").textContent).toContain("UC1");
  });

  it("a config whose guide id vanished still renders (empty description, no crash)", () => {
    renderAt("/use-case-diagrams/UC6");
    expect(screen.getByTestId("ucd-desc")).toBeTruthy();
  });

  it("node click fills the floating drawer with node detail (and re-click clears)", () => {
    renderAt("/use-case-diagrams/UC1");
    // StaticFlowDiagram testId is `ucd-uc1`, node cards are `${testId}-node-${id}`
    fireEvent.click(screen.getByTestId("ucd-uc1-node-gw"));
    expect(screen.getByTestId("ucd-floating-panel").textContent).toContain("Agent gateway");
    expect(screen.getByTestId("ucd-floating-panel").textContent).toContain("TOKEN");
    fireEvent.click(screen.getByTestId("ucd-uc1-node-gw")); // click again clears
    expect(screen.getByTestId("ucd-floating-panel").textContent).not.toContain("Agent gateway");
  });

  it("Prev/Next step the walk while paused", () => {
    renderAt("/use-case-diagrams/UC1");
    fireEvent.click(screen.getByRole("button", { name: "Step →" })); // idle -> paused at step 1
    expect(screen.getByTestId("ucd-floating-panel").textContent).toContain("1 / 5");
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByTestId("ucd-floating-panel").textContent).toContain("2 / 5");
  });

  it("gallery lists every registered config with deep links", () => {
    renderAt("/use-case-diagrams");
    // card accessible name is the guide title text; assert deep-link hrefs instead
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/use-case-diagrams/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/use-case-diagrams/UC1", "/use-case-diagrams/UC7", "/use-case-diagrams/UC6"]));
  });

  it("gallery gives every card a Run-this-step reverse link to the live launcher", () => {
    renderAt("/use-case-diagrams");
    const runs = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/use-cases#"));
    expect(runs.length).toBeGreaterThanOrEqual(29);
    expect(runs.map((a) => a.getAttribute("href"))).toContain("/use-cases#UC1");
  });
});
