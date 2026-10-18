/* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the "draggable" class is what shows they move */
import { describe, expect, it } from "vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import DigitalWorkerPage from "../DigitalWorkerPage";
import { INITIAL_EDGES } from "../digitalWorkerDiagram";

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

describe("DigitalWorkerPage diagram rule", () => {
  it("nodes are draggable and editing tools stay", () => {
    localStorage.clear();
    const { container } = render(<DigitalWorkerPage />);
    const nodes = container.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBeGreaterThan(0);
    nodes.forEach((n) => expect(n.classList.contains("draggable")).toBe(true));
    expect(screen.getByText("+ Add box")).toBeTruthy();
    expect(screen.getByText("Undo")).toBeTruthy();
  });

  it("Simulate walks the arrows at the chosen speed and Reset clears the walkthrough", () => {
    localStorage.clear();
    render(<DigitalWorkerPage />);
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
    render(<DigitalWorkerPage />);
    expect(screen.getByTestId("dw-steps").parentElement.classList.contains("dw-bar")).toBe(true);
  });
});
