/* eslint-disable testing-library/no-node-access, testing-library/no-container */
// pingStyle: numbered arrows + legend, and a box click that syncs the reel and step bar.
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FlowchartFlowDiagram from "../FlowchartFlowDiagram";
import { enrichReelStep } from "../../config/systemDiagramStandards";
import { ResizeObserverStub } from "./diagramControlsHelpers";

window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

const SRC = 'flowchart TD\n  Login["Login"] --> AuthRoutes["Auth routes"]\n  AuthRoutes -->|"code exchange"| OIDC_AS["Authorization Server"]\n  AuthRoutes -.->|"optional"| Vault["Vault"]\n';
const nodeByText = (text) => screen.getByText(text).closest(".react-flow__node");

async function setup() {
  const { container } = render(<FlowchartFlowDiagram source={SRC} pingStyle enrichStep={enrichReelStep} />);
  await screen.findByRole("button", { name: "Simulate" });
  // jsdom never measures the boxes, so React Flow draws no edges here: the badges themselves are checked by eye
  return container;
}

describe("FlowchartFlowDiagram pingStyle", () => {
  it("shows the legend and numbers the movie reel cards 1..n like the arrows", async () => {
    const container = await setup();
    expect([...container.querySelectorAll(".dreel-n")].map((n) => n.textContent)).toEqual(["1", "2", "3"]);
    expect(screen.getByTestId("pfd-legend").textContent).toMatch(/step n/);
    expect(container.querySelector(".fcd--ping")).toBeTruthy();
  });

  it("a box click jumps the reel and step bar to the box's first arrow, selects it and opens the step detail", async () => {
    const container = await setup();
    fireEvent.click(nodeByText("Authorization Server"));
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
    expect(container.querySelector(".react-flow__node.pfd-selected")).toBeTruthy();
    // step detail: request form and standards; box detail stays available beneath the reel
    expect(await screen.findByText("Request on the wire")).toBeTruthy();
    expect(screen.getByTestId("flowchart-flow-diagram-reel-refs")).toBeTruthy();
    expect(screen.getByTestId("flowchart-flow-diagram-node-detail")).toBeTruthy();
  });

  it("moving the step bar selects the step's box unless the selected box is part of the step", async () => {
    const container = await setup();
    fireEvent.click(nodeByText("Auth routes")); // first arrow into Auth routes is step 1
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 2 also touches Auth routes: stays selected
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
    expect(container.querySelector(".react-flow__node.pfd-selected").textContent).toMatch(/Auth routes/);
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 3 (Auth routes -> Vault) still includes it
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // already at the last step
    expect(container.querySelector(".react-flow__node.pfd-selected").textContent).toMatch(/Auth routes/);
    // pick the Vault box, then step back to 2: Vault is not part of step 2, so selection moves to its target
    fireEvent.click(nodeByText("Vault"));
    fireEvent.click(screen.getByRole("button", { name: /Prev/ }));
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
    expect(container.querySelector(".react-flow__node.pfd-selected").textContent).toMatch(/Authorization Server/);
  });
});
