import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import AuthorizationFlowPage from "../AuthorizationFlowPage";
import { LANES, MOMENTS, SLOTS } from "../authorizationFlowData";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlow: ({ nodes, edges }) => React.createElement("div", { "data-testid": "flow", "data-nodes": nodes.length, "data-edges": edges.length }),
    ReactFlowProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Left: "left", Right: "right" },
    ConnectionMode: { Loose: "loose" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    useNodesState: (init) => [init, () => {}, () => {}],
    useReactFlow: () => ({ fitView: () => {} }),
  };
});

describe("authorization flow data", () => {
  it("has the six moments, each arrow joining two real lanes, within the lane's slot count", () => {
    expect(MOMENTS).toHaveLength(6);
    const ids = new Set(LANES.map((l) => l.id));
    for (const mo of MOMENTS) {
      expect(mo.steps.length, mo.id).toBeLessThanOrEqual(SLOTS);
      for (const s of mo.steps) {
        expect(ids.has(s.from), `${mo.id} ${s.from}`).toBe(true);
        expect(ids.has(s.to), `${mo.id} ${s.to}`).toBe(true);
      }
    }
  });

  it("uses PingOne, not AIC, and dollars, not pounds", () => {
    const text = JSON.stringify([LANES, MOMENTS]);
    expect(text).toContain("PingOne");
    expect(text).not.toMatch(/\bAIC\b/);
    expect(text).not.toContain("£");
    expect(text).toContain("$50");
  });

  it("refuses the $60 payment before any device push", () => {
    const pay60 = MOMENTS.find((x) => x.id === "pay-60");
    expect(pay60.steps.some((s) => s.block)).toBe(true);
    expect(pay60.steps.some((s) => s.to === "ud")).toBe(false);
    const pay25 = MOMENTS.find((x) => x.id === "pay-25");
    expect(pay25.steps.some((s) => s.to === "ud")).toBe(true);
  });
});

describe("AuthorizationFlowPage", () => {
  it("shows six moments, starts with no arrows, and says it is scripted", () => {
    render(<AuthorizationFlowPage />);
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    expect(screen.getByTestId("flow").dataset.nodes).toBe(String(LANES.length));
    expect(screen.getByTestId("flow").dataset.edges).toBe("0");
    expect(screen.getByText(/scripted walkthrough/)).toBeTruthy();
  });

  it("reveals one arrow per step and fills the conversation and outcome as it walks", () => {
    render(<AuthorizationFlowPage />);
    const bar = screen.getByTestId("af-step-bar");
    fireEvent.click(within(bar).getByText("Simulate"));
    expect(screen.getByTestId("flow").dataset.edges).toBe("1");
    expect(screen.getByText("What’s my balance at Meridian Bank?")).toBeTruthy();
    const total = MOMENTS[0].steps.length;
    fireEvent.click(within(bar).getByText("Pause"));
    for (let i = 1; i < total; i += 1) fireEvent.click(within(bar).getByText(/Next/));
    expect(screen.getByTestId("flow").dataset.edges).toBe(String(total));
    expect(screen.getByRole("status").textContent).toMatch(/Refused at the edge/);
  });

  it("switching moment clears the walkthrough", () => {
    render(<AuthorizationFlowPage />);
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText("Simulate"));
    fireEvent.click(screen.getByRole("tab", { name: /Pay \$60/ }));
    expect(screen.getByTestId("flow").dataset.edges).toBe("0");
    expect(screen.getByText(/stops confirmation before the CIBA phone push/)).toBeTruthy();
  });
});

describe("AuthorizationFlowPage theme", () => {
  it("toggles the visualiser between dark and light", () => {
    document.documentElement.removeAttribute("data-theme");
    const { container } = render(<AuthorizationFlowPage />);
    const canvas = () => container.querySelector(".af-canvas");
    expect(canvas().dataset.afTheme).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));
    expect(canvas().dataset.afTheme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Light mode" }));
    expect(canvas().dataset.afTheme).toBe("light");
  });

  it("starts on the app theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const { container } = render(<AuthorizationFlowPage />);
    expect(container.querySelector(".af-canvas").dataset.afTheme).toBe("dark");
    document.documentElement.removeAttribute("data-theme");
  });
});
