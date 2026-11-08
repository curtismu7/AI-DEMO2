// WhereEverythingRunsPage.reset.test.jsx - the boxes are movable and "Reset layout" puts them back. jsdom has no layout, so a
// real pointer drag cannot run; ReactFlow is stubbed to hand the test its props, and the test sends the same onNodesChange
// position change a drag sends. (The drag itself is checked in a real browser.)
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

let last = null;
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual("@xyflow/react");
  return {
    ...actual,
    ReactFlow: (props) => {
      last = props;
      return (
        <div data-testid="rf-stub">
          {props.nodes.map((n) => <i key={n.id} data-node={n.id} data-x={n.position.x} data-y={n.position.y} data-draggable={String(n.draggable !== false)} />)}
        </div>
      );
    },
    ReactFlowProvider: ({ children }) => <>{children}</>,
    useReactFlow: () => RF, // stable, as in the real library
  };
});
const RF = { fitView: async () => true, getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport: async () => true };

import WhereEverythingRunsPage from "../components/WhereEverythingRunsPage";

const pos = (id) => {
  const el = document.querySelector(`[data-node="${id}"]`);
  return [Number(el.getAttribute("data-x")), Number(el.getAttribute("data-y"))];
};

describe("WhereEverythingRunsPage Reset layout", () => {
  it("moves a box when dragged and restores every position on Reset", async () => {
    render(<MemoryRouter><WhereEverythingRunsPage /></MemoryRouter>);
    const region = "R:mac";
    const card = "mac::g-web-front-ends";
    const regionStart = pos(region);
    const cardStart = pos(card);
    expect(document.querySelector(`[data-node="${region}"]`).getAttribute("data-draggable")).toBe("true");

    await act(async () => {
      last.onNodesChange([
        { id: region, type: "position", position: { x: regionStart[0] + 300, y: regionStart[1] + 120 } },
        { id: card, type: "position", position: { x: cardStart[0] + 5, y: cardStart[1] + 5 } },
      ]);
    });
    expect(pos(region)).toEqual([regionStart[0] + 300, regionStart[1] + 120]);
    expect(pos(card)).toEqual([cardStart[0] + 5, cardStart[1] + 5]);

    fireEvent.click(screen.getByTestId("wr-reset"));
    await act(async () => { await Promise.resolve(); });
    expect(pos(region)).toEqual(regionStart);
    expect(pos(card)).toEqual(cardStart);
  });

  it("starts from the computed layout again when the view changes", async () => {
    render(<MemoryRouter><WhereEverythingRunsPage /></MemoryRouter>);
    const region = "R:mac";
    const start = pos(region);
    await act(async () => { last.onNodesChange([{ id: region, type: "position", position: { x: 777, y: 55 } }]); });
    expect(pos(region)).toEqual([777, 55]);
    fireEvent.click(screen.getByTestId("wr-view-after"));
    await act(async () => { await Promise.resolve(); });
    expect(pos(region)).toEqual(start);
  });
});
