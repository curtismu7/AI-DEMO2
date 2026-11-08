import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import SequenceFlowDiagram from "../SequenceFlowDiagram";
import StaticFlowDiagram from "../StaticFlowDiagram";

/**
 * The shared diagrams used to put every lifeline, anchor, payload note and arrow in the tab order: 16 to 123 unnamed or
 * off-screen stops that showed no focus. Now the only stops are boxes that DO something when picked, each named, and
 * Enter / Space do what the click does.
 */
beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  if (!globalThis.DOMMatrixReadOnly) {
    globalThis.DOMMatrixReadOnly = class { constructor() { this.m22 = 1; } };
  }
});
afterEach(cleanup);

const stops = (root) => [...root.querySelectorAll(".react-flow__node[tabindex], .react-flow__edge[tabindex]")];

describe("SequenceFlowDiagram tab stops", () => {
  const source = "sequenceDiagram\n  participant A as Browser\n  participant B as Gateway\n  A->>B: request\n  B-->>A: response";

  it("leaves lifelines, anchors and arrows out of the tab order; only the named participant boxes are stops", () => {
    const { container } = render(<SequenceFlowDiagram source={source} />);
    const found = stops(container);
    expect(found.length).toBeGreaterThan(0);
    for (const el of found) {
      expect(el.className, "only participant boxes may be tab stops").toMatch(/react-flow__node-part/);
      expect(el.getAttribute("aria-label")).toMatch(/Show details/);
    }
    expect(container.querySelectorAll(".react-flow__edge[tabindex]")).toHaveLength(0);
    expect(container.querySelectorAll(".react-flow__node-anchor[tabindex], .react-flow__node-lifeline[tabindex]")).toHaveLength(0);
  });

  it("opens a participant's details from the keyboard (Enter) like a click", () => {
    const { container } = render(<SequenceFlowDiagram source={source} />);
    const part = stops(container)[0];
    part.focus();
    expect(container.querySelector(".dreel-detail")).toBeNull();
    fireEvent.keyDown(part, { key: "Enter" });
    expect(container.querySelector(".dreel-detail")).not.toBeNull();
  });
});

describe("StaticFlowDiagram tab stops", () => {
  const NODES = [
    { id: "a", label: "Browser", x: 0, y: 0, group: "g" },
    { id: "b", label: "Gateway", x: 1, y: 0, group: "g" },
  ];
  const EDGES = [["a", "b", "call"]];

  it("has no stops when picking a box does nothing (a bare `step` paints the diagram, no reel, no handler)", () => {
    const { container } = render(<StaticFlowDiagram NODES={NODES} EDGES={EDGES} GROUPS={{ g: { bg: "#123456" } }} step={0} />);
    expect(stops(container)).toHaveLength(0);
  });

  it("makes a box a named stop, and Enter picks it, when the page handles node clicks", () => {
    const picked = [];
    const { container } = render(<StaticFlowDiagram NODES={NODES} EDGES={EDGES} GROUPS={{ g: { bg: "#123456" } }} step={0} onNodeClick={(n) => picked.push(n.id)} />);
    const found = stops(container);
    expect(found).toHaveLength(2);
    expect(found.every((el) => el.className.includes("react-flow__node"))).toBe(true);
    expect(found.map((el) => el.getAttribute("aria-label"))).toEqual(["Browser", "Gateway"]);
    fireEvent.keyDown(found[1], { key: " " });
    expect(picked).toEqual(["b"]);
    expect(container.querySelectorAll(".react-flow__edge[tabindex]")).toHaveLength(0);
  });
});
