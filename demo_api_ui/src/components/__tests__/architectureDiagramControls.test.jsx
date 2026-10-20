// Every diagram carries the four controls: movable boxes, Simulate, Reset, speed.
// Sequence views (lifelines) are exempt from movable boxes.
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TokenChainArchitecturePage from "../TokenChainArchitecturePage";
import ObservabilityDiagramPage from "../ObservabilityDiagramPage";
import ArchitectureTokenFlowPage from "../ArchitectureTokenFlowPage";

const { flowProps } = vi.hoisted(() => ({ flowProps: [] }));
vi.mock("@xyflow/react", async (orig) => ({
  ...(await orig()),
  ReactFlow: (props) => {
    flowProps.push(props);
    return <div data-testid="rf-mock" />;
  },
}));
vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn().mockResolvedValue({ data: { events: [] } }) } }));

const page = (el) => render(<MemoryRouter>{el}</MemoryRouter>);

function expectStepControls() {
  expect(screen.getByRole("button", { name: "Simulate" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Reset$/ })).toBeInTheDocument();
  expect(within(screen.getByTitle(/Time each step takes/)).getByRole("combobox")).toBeInTheDocument();
}

function expectDraggable() {
  const last = flowProps[flowProps.length - 1];
  expect(last.nodesDraggable).toBe(true);
  expect(typeof last.onNodesChange).toBe("function");
}

beforeEach(() => {
  flowProps.length = 0;
});

describe("diagram controls", () => {
  it("/architecture/token-chain: movable boxes, Simulate, Reset, speed", () => {
    page(<TokenChainArchitecturePage user={null} />);
    expectStepControls();
    expectDraggable();
  });

  it("/architecture/observability: movable boxes, Simulate, Reset, speed", () => {
    page(<ObservabilityDiagramPage />);
    expectStepControls();
    expectDraggable();
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    const edges = flowProps[flowProps.length - 1].edges;
    expect(edges[0].data.active).toBe(true);
  });

  it("/architecture/token-flow (sequence view, exempt from movable): Simulate, Reset, speed", () => {
    page(<ArchitectureTokenFlowPage user={null} />);
    expectStepControls();
  });
});
