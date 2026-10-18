// followSteps: the Full topology opens zoomed in on the flow's entry point and pans to each
// Simulate step; every other FlowchartFlowDiagram keeps fitting the whole drawing.
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FlowchartFlowDiagram from "../FlowchartFlowDiagram";
import { REFIT_EVENT } from "../../hooks/useFitOnResize";
import { ResizeObserverStub } from "./diagramControlsHelpers";

const { setCenter, fitView } = vi.hoisted(() => ({ setCenter: vi.fn(), fitView: vi.fn() }));
vi.mock("@xyflow/react", async (orig) => {
  const actual = await orig();
  return { ...actual, useReactFlow: () => ({ ...actual.useReactFlow(), setCenter, fitView }) };
});

window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

const SRC = "flowchart TD\n  U[User] --> B[BFF]\n  B --> M[MCP server]\n";

function setup(props) {
  setCenter.mockClear();
  fitView.mockClear();
  render(<FlowchartFlowDiagram source={SRC} {...props} />);
}

describe("FlowchartFlowDiagram followSteps", () => {
  it("opens centred on the entry node at a readable zoom instead of fitting", async () => {
    setup({ followSteps: true });
    await waitFor(() => expect(setCenter).toHaveBeenCalled());
    expect(setCenter.mock.calls.at(-1)[2].zoom).toBeGreaterThanOrEqual(0.7);
    act(() => window.dispatchEvent(new Event(REFIT_EVENT)));
    expect(fitView).not.toHaveBeenCalled();
  });

  it("pans to the active edge on Simulate and Next, and back to the opening view on Reset", async () => {
    setup({ followSteps: true });
    await waitFor(() => expect(setCenter).toHaveBeenCalled());
    const opening = setCenter.mock.calls.at(-1);

    fireEvent.click(await screen.findByRole("button", { name: "Simulate" }));
    await waitFor(() => expect(setCenter.mock.calls.at(-1)[1]).toBeGreaterThan(opening[1]));
    const step0 = setCenter.mock.calls.at(-1);
    expect(step0[2].zoom).toBeGreaterThanOrEqual(0.7);
    expect(step0[2].duration).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Pause/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(setCenter.mock.calls.at(-1)[1]).toBeGreaterThan(step0[1]));

    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    await waitFor(() => expect(setCenter.mock.calls.at(-1).slice(0, 2)).toEqual(opening.slice(0, 2)));
  });

  it("without the prop it never calls setCenter and still refits the whole drawing", async () => {
    setup({});
    await screen.findByRole("button", { name: "Simulate" });
    act(() => window.dispatchEvent(new Event(REFIT_EVENT)));
    expect(fitView).toHaveBeenCalled();
    expect(setCenter).not.toHaveBeenCalled();
  });
});
