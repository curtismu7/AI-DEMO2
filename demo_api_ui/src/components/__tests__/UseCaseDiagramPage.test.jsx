import { describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import UseCaseDiagramPage from "../UseCaseDiagramPage";
import UseCaseDiagramsGalleryPage from "../UseCaseDiagramsGalleryPage";

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
  it("renders the five header fields from shared data, not config copies", () => {
    renderAt("/use-case-diagrams/UC1");
    expect(screen.getByTestId("ucd-title").textContent).toBe("Delegated access (consent only)"); // from demoStepGuides
    expect(screen.getByTestId("ucd-desc").textContent.length).toBeGreaterThan(40);
    expect(screen.getByTestId("ucd-value").textContent.length).toBeGreaterThan(20);
    expect(screen.getByTestId("ucd-step").textContent).toMatch(/^\d+$/);
    expect(screen.getByTestId("ucd-result").textContent).toBe("PERMIT"); // from config result
  });

  it("cues the demo-script step and links back to Mission Control", () => {
    renderAt("/use-case-diagrams/UC1");
    const cue = screen.getByRole("link", { name: /step 2 of the demo script/i });
    expect(cue.getAttribute("href")).toBe("/dashboard");
  });

  it("always shows an explicit back-to-dashboard button in the header", () => {
    renderAt("/use-case-diagrams/UC1");
    const back = screen.getByTestId("ucd-back");
    expect(back.getAttribute("href")).toBe("/dashboard");
    expect(back.textContent).toMatch(/back to dashboard/i);
  });

  it("opens on hop 1 active-and-paused with the entry node ringed", () => {
    renderAt("/use-case-diagrams/UC1");
    expect(screen.getByTestId("ucd-hop-label").textContent).toContain("1 / 4");
    expect(document.querySelector(".sfd-node.step-hot")).toBeTruthy();
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

  it("node click opens the details panel with node detail", () => {
    renderAt("/use-case-diagrams/UC1");
    // StaticFlowDiagram testId is `ucd-uc1`, node cards are `${testId}-node-${id}`
    fireEvent.click(screen.getByTestId("ucd-uc1-node-gw"));
    expect(screen.getByTestId("ucd-panel").textContent).toContain("Agent gateway");
    expect(screen.getByTestId("ucd-panel").textContent).toContain("TOKEN");
    fireEvent.click(screen.getByTestId("ucd-uc1-node-gw")); // click again clears
    expect(screen.getByTestId("ucd-panel").textContent).not.toContain("Agent gateway");
  });

  it("Prev/Next step the walk while paused", () => {
    renderAt("/use-case-diagrams/UC1");
    const next = screen.getByRole("button", { name: "Next →" });
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByTestId("ucd-hop-label").textContent).toContain("2 / 4");
  });

  it("gallery lists every registered config with deep links", () => {
    renderAt("/use-case-diagrams");
    // card accessible name is the guide title text; assert deep-link hrefs instead
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/use-case-diagrams/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/use-case-diagrams/UC1", "/use-case-diagrams/UC7", "/use-case-diagrams/UC6"]));
  });
});
