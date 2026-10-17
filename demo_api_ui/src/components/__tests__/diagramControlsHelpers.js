import { waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

// The four controls every diagram owes the presenter: Simulate, Reset, a speed control and
// (unless it is a lifeline sequence) draggable boxes. `scope` is the element holding one diagram.
export async function expectDiagramControls(scope, { draggable = true } = {}) {
  const q = within(scope);
  await waitFor(() => expect(q.getAllByRole("button", { name: "Simulate" }).length).toBeGreaterThan(0));
  expect(q.getAllByRole("button", { name: /Reset/ }).length).toBeGreaterThan(0);
  expect(q.getAllByRole("combobox").length).toBeGreaterThan(0);
  if (draggable) {
    // React Flow marks movable nodes with a class only; there is no role to query.
    // eslint-disable-next-line testing-library/no-node-access
    await waitFor(() => expect(scope.querySelector(".react-flow__node.draggable")).toBeTruthy());
  }
}

export class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
